'use strict';
// The server browser: pings Java Edition servers the way the game's multiplayer screen does
// (Server List Ping: handshake, status request, then a ping for the latency), keeps your
// favourite servers, and reads the ones you already added in game from each instance's
// servers.dat.
const net = require('net');
const dns = require('dns').promises;
const fsp = require('fs').promises;
const path = require('path');
const { readJson, writeJson } = require('./util');

/** Big public servers that are nice to have one click away. Pinged live, so a dead one just shows offline. */
const POPULAR = [
  { name: 'Hypixel', address: 'mc.hypixel.net', tags: ['Minigames', 'SkyBlock', 'Bed Wars'] },
  { name: 'CubeCraft', address: 'play.cubecraft.net', tags: ['Minigames', 'SkyWars', 'EggWars'] },
  { name: 'Wynncraft', address: 'play.wynncraft.com', tags: ['MMORPG', 'Quests'] },
  { name: 'Minehut', address: 'minehut.com', tags: ['Player servers'] },
  { name: 'Complex Gaming', address: 'org.mc-complex.com', tags: ['Pixelmon', 'Survival', 'Prison'] },
  { name: 'PikaNetwork', address: 'play.pikanetwork.net', tags: ['Bed Wars', 'Survival', 'Skyblock'] },
  { name: 'ManaCube', address: 'play.manacube.com', tags: ['Parkour', 'Skyblock', 'Survival'] },
  { name: 'BlocksMC', address: 'blocksmc.com', tags: ['Bed Wars', 'SkyWars'] },
];

// ------------------------------------------------------------------ protocol bits

function varint(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

function readVarint(buf, at) {
  let n = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    if (at + i >= buf.length) return null;
    const b = buf[at + i];
    n |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: n, size: i + 1 };
    shift += 7;
  }
  throw new Error('Bad varint from the server');
}

function packet(id, ...parts) {
  const body = Buffer.concat([varint(id), ...parts]);
  return Buffer.concat([varint(body.length), body]);
}

const str = (s) => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(b.length), b]);
};

/** "host", "host:port" or "[v6]:port" to {host, port, explicitPort}. */
function parseAddress(address) {
  const a = String(address || '').trim();
  if (!a) throw new Error('No server address.');
  let host = a;
  let port = null;
  const v6 = a.match(/^\[(.+)\](?::(\d+))?$/);
  if (v6) {
    host = v6[1];
    port = v6[2] ? Number(v6[2]) : null;
  } else if (/^[^:]+:\d+$/.test(a)) {
    [host, port] = a.split(':');
    port = Number(port);
  }
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('That port is not valid.');
  return { host: host.toLowerCase(), port: port || 25565, explicitPort: port !== null };
}

/** Where to actually connect: a _minecraft._tcp SRV record wins when no port was given. */
async function resolveTarget(address, lookupSrv = dns.resolveSrv) {
  const t = parseAddress(address);
  if (!t.explicitPort && !net.isIP(t.host) && t.host !== 'localhost') {
    try {
      const recs = await lookupSrv(`_minecraft._tcp.${t.host}`);
      if (recs?.length) {
        recs.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
        return { host: recs[0].name, port: recs[0].port, shown: t.host };
      }
    } catch { /* no SRV record: the plain address it is */ }
  }
  return { host: t.host, port: t.port, shown: t.host };
}

// ------------------------------------------------------------------ the message of the day

const COLOURS = { black: '#000000', dark_blue: '#0000aa', dark_green: '#00aa00', dark_aqua: '#00aaaa', dark_red: '#aa0000', dark_purple: '#aa00aa', gold: '#ffaa00', gray: '#aaaaaa', dark_gray: '#555555', blue: '#5555ff', green: '#55ff55', aqua: '#55ffff', red: '#ff5555', light_purple: '#ff55ff', yellow: '#ffff55', white: '#ffffff' };
const CODES = '0123456789abcdef';
const CODE_NAMES = ['black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold', 'gray', 'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white'];

/**
 * The MOTD as coloured runs [{text, color, bold, italic}], from either a chat component or a
 * string with § codes. Obfuscated text is shown plainly.
 */
function motdRuns(desc) {
  const runs = [];
  const fromLegacy = (text, base = {}) => {
    let cur = { ...base };
    let buf = '';
    const push = () => { if (buf) runs.push({ text: buf, ...cur }); buf = ''; };
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '§' && i + 1 < text.length) {
        push();
        const c = text[++i].toLowerCase();
        const k = CODES.indexOf(c);
        if (k >= 0) cur = { color: COLOURS[CODE_NAMES[k]] };
        else if (c === 'l') cur = { ...cur, bold: true };
        else if (c === 'o') cur = { ...cur, italic: true };
        else if (c === 'r') cur = { ...base };
        continue;
      }
      buf += text[i];
    }
    push();
  };
  const walk = (node, inherited = {}) => {
    if (node == null) return;
    if (typeof node === 'string') { fromLegacy(node, inherited); return; }
    if (Array.isArray(node)) { node.forEach((n) => walk(n, inherited)); return; }
    const style = { ...inherited };
    if (node.color) style.color = node.color.startsWith('#') ? node.color : COLOURS[node.color] || style.color;
    if (node.bold !== undefined) style.bold = Boolean(node.bold);
    if (node.italic !== undefined) style.italic = Boolean(node.italic);
    if (typeof node.text === 'string') fromLegacy(node.text, style);
    else if (typeof node.translate === 'string') fromLegacy(node.translate, style);
    if (Array.isArray(node.extra)) node.extra.forEach((n) => walk(n, style));
  };
  walk(desc);
  return runs;
}

// ------------------------------------------------------------------ ping

/**
 * Asks a server for its status. Resolves {online, address, players:{online,max,sample}, version,
 * protocol, motd:[runs], favicon, latency}; offline servers resolve {online:false, error}.
 */
async function ping(address, { timeout = 6000, connect = net.connect, lookupSrv } = {}) {
  let target;
  try {
    target = await resolveTarget(address, lookupSrv);
  } catch (err) {
    return { online: false, address, error: err.message };
  }
  return new Promise((resolve) => {
    const started = Date.now();
    let buf = Buffer.alloc(0);
    let status = null;
    let pingSent = 0;
    let done = false;
    const sock = connect({ host: target.host, port: target.port });
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ address, ...result });
    };
    const timer = setTimeout(() => finish(status ? { ...status, latency: null } : { online: false, error: 'No answer (timed out).' }), timeout);
    sock.setNoDelay?.(true);
    sock.on('connect', () => {
      // handshake (protocol -1 means "just asking"), then the status request
      const port = Buffer.alloc(2);
      port.writeUInt16BE(target.port);
      sock.write(Buffer.concat([
        packet(0x00, varint(-1 >>> 0), str(target.shown), port, varint(1)),
        packet(0x00),
      ]));
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        const body = buf.subarray(len.size, len.size + len.value);
        buf = buf.subarray(len.size + len.value);
        const id = readVarint(body, 0);
        if (!id) return;
        if (id.value === 0x00 && !status) {
          const n = readVarint(body, id.size);
          let json;
          try { json = JSON.parse(body.subarray(id.size + n.size, id.size + n.size + n.value).toString('utf8')); } catch { finish({ online: false, error: 'The server sent something that is not a status.' }); return; }
          status = {
            online: true,
            players: { online: json.players?.online ?? 0, max: json.players?.max ?? 0, sample: (json.players?.sample || []).map((p) => String(p.name || '')).slice(0, 12) },
            version: String(json.version?.name || ''),
            protocol: json.version?.protocol ?? null,
            motd: motdRuns(json.description),
            favicon: typeof json.favicon === 'string' && json.favicon.startsWith('data:image/png;base64,') ? json.favicon : null,
          };
          const t = Buffer.alloc(8);
          t.writeBigInt64BE(BigInt(Date.now()));
          pingSent = Date.now();
          sock.write(packet(0x01, t));
        } else if (id.value === 0x01 && status) {
          finish({ ...status, latency: Date.now() - pingSent });
          return;
        }
      }
    });
    sock.on('error', (err) => finish(status ? { ...status, latency: Date.now() - started } : { online: false, error: err.code === 'ENOTFOUND' ? 'That address does not exist.' : err.code === 'ECONNREFUSED' ? 'The server is offline.' : err.message }));
    sock.on('close', () => finish(status ? { ...status, latency: null } : { online: false, error: 'The server closed the connection.' }));
  });
}

// ------------------------------------------------------------------ servers.dat (uncompressed NBT)

/** Just enough NBT to read servers.dat: a compound with a list of compounds of strings. */
function readNbt(buf) {
  let at = 0;
  const u8 = () => buf[at++];
  const i16 = () => { const v = buf.readInt16BE(at); at += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(at); at += 4; return v; };
  const s = () => { const n = buf.readUInt16BE(at); at += 2; const v = buf.toString('utf8', at, at + n); at += n; return v; };
  const payload = (type) => {
    switch (type) {
      case 1: return buf.readInt8(at++);
      case 2: return i16();
      case 3: return i32();
      case 4: { const v = buf.readBigInt64BE(at); at += 8; return v; }
      case 5: { const v = buf.readFloatBE(at); at += 4; return v; }
      case 6: { const v = buf.readDoubleBE(at); at += 8; return v; }
      case 7: { const n = i32(); const v = buf.subarray(at, at + n); at += n; return v; }
      case 8: return s();
      case 9: { const t = u8(); const n = i32(); const out = []; for (let i = 0; i < n; i++) out.push(payload(t)); return out; }
      case 10: {
        const out = {};
        for (;;) {
          const t = u8();
          if (t === 0) return out;
          const name = s();
          out[name] = payload(t);
        }
      }
      case 11: { const n = i32(); const out = []; for (let i = 0; i < n; i++) out.push(i32()); return out; }
      case 12: { const n = i32(); at += n * 8; return []; }
      default: throw new Error(`Unknown NBT tag ${type}`);
    }
  };
  if (u8() !== 10) throw new Error('Not an NBT compound');
  s();
  return payload(10);
}

/** The servers listed in an instance's multiplayer screen. */
async function readServersDat(file) {
  try {
    const root = readNbt(await fsp.readFile(file));
    return (root.servers || []).filter((x) => x && typeof x.ip === 'string' && x.ip.trim()).map((x) => ({ name: String(x.name || x.ip), address: x.ip.trim() }));
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ favourites

class Servers {
  /** @param {{paths: object, instances: object}} launcher */
  constructor(launcher) {
    this.launcher = launcher;
    this.file = path.join(launcher.paths.root, 'servers.json');
  }

  async favourites() {
    const saved = await readJson(this.file, {});
    return Array.isArray(saved.favourites) ? saved.favourites : [];
  }

  async addFavourite({ name, address }) {
    const { host, port, explicitPort } = parseAddress(address);
    const clean = explicitPort ? `${host}:${port}` : host;
    const list = await this.favourites();
    if (list.some((f) => f.address === clean)) throw new Error('That server is already in your favourites.');
    list.unshift({ name: String(name || '').trim().slice(0, 40) || host, address: clean, added: Date.now() });
    await writeJson(this.file, { favourites: list });
    return list;
  }

  async removeFavourite(address) {
    const list = (await this.favourites()).filter((f) => f.address !== address);
    await writeJson(this.file, { favourites: list });
    return list;
  }

  /** Favourites, the servers in each instance's servers.dat (deduplicated) and the popular list. */
  async list() {
    const favourites = await this.favourites();
    const seen = new Set(favourites.map((f) => f.address.toLowerCase()));
    const fromGame = [];
    for (const inst of await this.launcher.instances.list()) {
      for (const s of await readServersDat(path.join(this.launcher.paths.gameDir(inst.id), 'servers.dat'))) {
        const key = s.address.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        fromGame.push({ ...s, instance: inst.name });
      }
    }
    return { favourites, fromGame, popular: POPULAR };
  }
}

module.exports = { Servers, ping, parseAddress, resolveTarget, motdRuns, readNbt, readServersDat, POPULAR, varint, readVarint };
