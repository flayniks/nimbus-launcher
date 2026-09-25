'use strict';
// A stand-in for api.minecraftservices.com's profile, skin and cape endpoints, Mojang's
// name lookup and session profiles, and the MineSkin gallery, for tests.
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A width x height RGBA PNG whose pixels come from fn(x, y) -> [r, g, b, a]. */
function png(width, height, fn) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fn(x, y);
      raw.set([r, g, b, a], y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const solid = (rgb) => png(64, 64, () => [...rgb, 255]);

function readBody(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => resolve(Buffer.concat(parts)));
  });
}

/** Pulls the fields out of a multipart/form-data body. */
function multipart(body, type) {
  const boundary = `--${/boundary=(.+)$/.exec(type)[1]}`;
  const out = {};
  let at = body.indexOf(boundary);
  while (at !== -1) {
    const next = body.indexOf(boundary, at + boundary.length);
    if (next === -1) break;
    const part = body.subarray(at + boundary.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString();
    const name = /name="([^"]+)"/.exec(head)?.[1];
    if (name) out[name] = part.subarray(split + 4);
    at = next;
  }
  return out;
}

/**
 * Starts the mock. `skins`/`capes` may be real textures; otherwise solid colours are used.
 * Returns { url, state, close() }.
 */
function start({ token = 'mock-token', name = 'Tester', skin, capes, gallery, players } = {}) {
  const textures = new Map();
  const put = (buf) => {
    const id = crypto.createHash('sha1').update(buf).digest('hex');
    textures.set(id, buf);
    return id;
  };
  const state = {
    uploads: [],
    skin: { id: 'skin-1', tex: put(skin || solid([80, 120, 200])), variant: 'CLASSIC' },
    capes: (capes || [png(64, 32, (x) => [200, 40 + x * 3, 60, 255]), png(64, 32, (x, y) => [30, 60 + y * 5, 200, 255])])
      .map((buf, i) => ({ id: `cape-${i + 1}`, alias: ['Migrator', 'Vanilla'][i] || `Cape ${i + 1}`, tex: put(buf), active: i === 0 })),
  };
  // gallery: [{ name, png }]; players: { Name: { png, slim } }
  state.gallery = (gallery || [
    { name: 'Red knight', png: solid([200, 40, 40]) },
    { name: 'Blue knight', png: solid([40, 60, 200]) },
    { name: 'Green wizard', png: solid([40, 180, 60]) },
    { name: null, png: solid([90, 90, 90]) },
    { name: 'Red knight', png: solid([200, 40, 40]) },
  ]).map((g, i) => ({ uuid: `g${String(i).padStart(31, '0')}`, name: g.name, texture: put(g.png) }));
  state.players = Object.entries(players || { Notch: { png: solid([120, 80, 40]) } })
    .map(([pname, p], i) => ({ id: `p${String(i).padStart(31, '0')}`, name: pname, slim: Boolean(p.slim), texture: put(p.png) }));
  state.searches = [];
  let base = '';
  const profile = () => ({
    id: '00000000000000000000000000000abc',
    name,
    skins: [{ id: state.skin.id, state: 'ACTIVE', url: `${base}/texture/${state.skin.tex}`, variant: state.skin.variant }],
    capes: state.capes.map((c) => ({ id: c.id, state: c.active ? 'ACTIVE' : 'INACTIVE', url: `${base}/texture/${c.tex}`, alias: c.alias })),
  });

  const server = http.createServer(async (req, res) => {
    const send = (code, obj, headers = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    const url = req.url.split('?')[0];
    if (url.startsWith('/texture/')) {
      const buf = textures.get(url.slice(9));
      if (!buf) return send(404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(buf);
    }
    const query = new URL(req.url, 'http://mock').searchParams;
    if (req.method === 'GET' && url === '/v2/skins') {
      const filter = (query.get('filter') || '').toLowerCase();
      state.searches.push(filter);
      const size = Number(query.get('size') || 16);
      // like the real one, nameless skins sometimes match too
      let list = state.gallery.filter((g) => !filter || !g.name || g.name.toLowerCase().includes(filter));
      const after = query.get('after');
      if (after) list = list.slice(list.findIndex((g) => g.uuid === after) + 1);
      const page = list.slice(0, size);
      const more = list.length > size;
      return send(200, { success: true, skins: page.map((g) => ({ uuid: g.uuid, name: g.name, texture: g.texture })), pagination: { current: {}, next: more ? { after: page[page.length - 1].uuid } : {} } });
    }
    if (req.method === 'GET' && url.startsWith('/users/profiles/minecraft/')) {
      const who = state.players.find((p) => p.name.toLowerCase() === decodeURIComponent(url.slice(26)).toLowerCase());
      return who ? send(200, { id: who.id, name: who.name }) : send(404, { errorMessage: 'Couldn\'t find any profile with that name' });
    }
    if (req.method === 'GET' && url.startsWith('/session/minecraft/profile/')) {
      const who = state.players.find((p) => p.id === url.slice(27));
      if (!who) return send(204);
      const skinInfo = { url: `${base}/texture/${who.texture}` };
      if (who.slim) skinInfo.metadata = { model: 'slim' };
      const value = Buffer.from(JSON.stringify({ profileId: who.id, profileName: who.name, textures: { SKIN: skinInfo } })).toString('base64');
      return send(200, { id: who.id, name: who.name, properties: [{ name: 'textures', value }] });
    }
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { path: url, errorType: 'UNAUTHORIZED' });
    const body = await readBody(req);
    if (req.method === 'GET' && url === '/minecraft/profile') return send(200, profile());
    if (req.method === 'POST' && url === '/minecraft/profile/skins') {
      const form = multipart(body, req.headers['content-type'] || '');
      const file = form.file;
      if (!file || file.subarray(1, 4).toString() !== 'PNG') return send(400, { errorMessage: 'Invalid skin file' });
      const variant = String(form.variant || '').toUpperCase();
      if (!['CLASSIC', 'SLIM'].includes(variant)) return send(400, { errorMessage: 'Invalid variant' });
      state.uploads.push({ variant, bytes: file.length });
      state.skin = { id: `skin-${state.uploads.length + 1}`, tex: put(file), variant };
      return send(200, profile());
    }
    if (req.method === 'DELETE' && url === '/minecraft/profile/skins/active') {
      state.skin = { id: 'default', tex: put(solid([60, 160, 90])), variant: 'CLASSIC' };
      return send(200, profile());
    }
    if (req.method === 'PUT' && url === '/minecraft/profile/capes/active') {
      const { capeId } = JSON.parse(body.toString() || '{}');
      if (!state.capes.some((c) => c.id === capeId)) return send(400, { errorMessage: 'Cape not owned' });
      state.capes.forEach((c) => { c.active = c.id === capeId; });
      return send(200, profile());
    }
    if (req.method === 'DELETE' && url === '/minecraft/profile/capes/active') {
      state.capes.forEach((c) => { c.active = false; });
      return send(200, profile());
    }
    return send(404, { error: `no route ${req.method} ${url}` });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve({ url: base, state, token, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { start, png, solid };

// `node test/mock-services.js [port]` runs it on its own, for poking at the UI by hand
if (require.main === module) {
  start({}).then((m) => console.log(`mock Mojang services on ${m.url}`));
}
