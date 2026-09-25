'use strict';
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { request, getJson, HttpError } = require('./http');
const { readJson, writeJson } = require('./util');

// Tests point these at local stand-ins.
const services = () => process.env.NIMBUS_SERVICES_URL || 'https://api.minecraftservices.com';
const mojang = () => process.env.NIMBUS_MOJANG_URL || 'https://api.mojang.com';
const sessions = () => process.env.NIMBUS_MOJANG_URL || 'https://sessionserver.mojang.com';
const gallery = () => process.env.NIMBUS_GALLERY_URL || 'https://api.mineskin.org';
const textures = () => process.env.NIMBUS_TEXTURES_URL || 'https://textures.minecraft.net';

/** Checks a PNG is a Minecraft skin (64x64, or the old 64x32) and returns its size. */
function pngSize(buf) {
  const sig = '89504e470d0a1a0a';
  if (!Buffer.isBuffer(buf) || buf.length < 24 || buf.subarray(0, 8).toString('hex') !== sig) {
    throw new Error('That file is not a PNG image.');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function checkSkin(buf) {
  const { width, height } = pngSize(buf);
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`Minecraft skins are 64×64 (or 64×32) pixels — this one is ${width}×${height}.`);
  }
  return { width, height };
}

function toDataUrl(buf) {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function fromDataUrl(url) {
  const m = /^data:image\/png;base64,(.+)$/.exec(url || '');
  if (!m) throw new Error('Expected a PNG image.');
  return Buffer.from(m[1], 'base64');
}

/** Mojang still hands out http:// texture links; the same files are served over https. */
function secureTextureUrl(url) {
  return String(url || '').replace(/^http:\/\/textures\.minecraft\.net\//, 'https://textures.minecraft.net/');
}

function friendly(err) {
  if (err instanceof HttpError) {
    if (err.status === 401) {
      const e = new Error('Your Minecraft sign-in expired. Sign in again on the Accounts page.');
      e.code = 'REAUTH';
      return e;
    }
    if (err.status === 429) return new Error('Mojang only allows a few skin changes a minute. Wait a moment and try again.');
    if (err.status === 400) {
      let msg = '';
      try { msg = JSON.parse(err.body).errorMessage || ''; } catch { /* keep generic */ }
      return new Error(msg ? `Mojang refused that: ${msg}` : 'Mojang refused that skin.');
    }
    if (err.status === 404) return new Error('That account does not own Minecraft: Java Edition.');
  }
  return err;
}

async function call(token, pathname, { method = 'GET', body, json } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload = body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  }
  try {
    const res = await request(`${services()}${pathname}`, { method, headers, body: payload, retries: method === 'GET' ? 2 : 0 });
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    throw friendly(err);
  }
}

/** The signed-in player's skins and capes. */
function getProfile(token) {
  return call(token, '/minecraft/profile');
}

/** Uploads a PNG as the active skin. `variant` is "classic" (Steve arms) or "slim" (Alex arms). */
async function uploadSkin(token, png, variant) {
  checkSkin(png);
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([png], { type: 'image/png' }), 'skin.png');
  // Mojang answers with the updated profile; fetch it again if it does not
  const res = await call(token, '/minecraft/profile/skins', { method: 'POST', body: form });
  return res && res.skins ? res : getProfile(token);
}

async function resetSkin(token) {
  await call(token, '/minecraft/profile/skins/active', { method: 'DELETE' });
  return getProfile(token);
}

async function showCape(token, capeId) {
  if (capeId) await call(token, '/minecraft/profile/capes/active', { method: 'PUT', json: { capeId } });
  else await call(token, '/minecraft/profile/capes/active', { method: 'DELETE' });
  return getProfile(token);
}

const textureCache = new Map();
const TEXTURE_CACHE_MAX = 400;

/** Downloads a skin or cape texture as a data URL, so the UI never needs to reach Mojang itself. */
async function textureDataUrl(url) {
  const src = secureTextureUrl(url);
  if (!src) return null;
  if (!textureCache.has(src)) {
    const job = request(src, { timeout: 15000 })
      .then(async (res) => toDataUrl(Buffer.from(await res.arrayBuffer())))
      .catch((err) => { textureCache.delete(src); throw err; });
    textureCache.set(src, job);
    // search results pull in lots of textures: forget the oldest
    if (textureCache.size > TEXTURE_CACHE_MAX) textureCache.delete(textureCache.keys().next().value);
  }
  return textureCache.get(src);
}

/** The worn skin of any player, by name — for copying a look into your wardrobe. */
async function lookupPlayer(name) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{2,16}$/.test(clean)) throw new Error('Minecraft names are 2–16 letters, numbers or underscores.');
  let id = null;
  try {
    const res = await request(`${mojang()}/users/profiles/minecraft/${clean}`);
    const text = await res.text();
    id = text ? JSON.parse(text).id : null;
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
  }
  if (!id) throw new Error(`No player called ${clean}.`);
  const profile = await getJson(`${sessions()}/session/minecraft/profile/${id}`);
  const prop = (profile.properties || []).find((p) => p.name === 'textures');
  const textures = prop ? JSON.parse(Buffer.from(prop.value, 'base64').toString()).textures : {};
  const skin = textures.SKIN;
  return {
    name: profile.name,
    uuid: profile.id,
    variant: skin?.metadata?.model === 'slim' ? 'slim' : 'classic',
    skin: skin ? await textureDataUrl(skin.url) : null,
  };
}

/** Runs `fn` over `items`, at most `limit` at a time, keeping the order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/;

/**
 * Searches the MineSkin gallery (skins people have shared) by name; an empty
 * query lists the newest ones. `after` continues a previous page.
 */
async function searchGallery(query = '', after = null, size = 24) {
  const url = new URL(`${gallery()}/v2/skins`);
  url.searchParams.set('size', String(size));
  const q = String(query || '').trim().slice(0, 40);
  if (q) url.searchParams.set('filter', q);
  if (after) url.searchParams.set('after', after);
  const res = await getJson(url.toString(), { timeout: 15000 });
  // the gallery repeats textures, and nameless entries only match a search by accident
  const seen = new Set();
  const found = (res.skins || []).filter((sk) => /^[0-9a-f]{20,80}$/i.test(sk.texture || '')
    && (!q || (sk.name || '').trim()) && !seen.has(sk.texture) && seen.add(sk.texture));
  const skins = await mapLimit(found, 8, async (sk) => ({
    id: `mineskin:${sk.uuid}`,
    name: (sk.name || '').trim() || 'Untitled skin',
    source: 'gallery',
    texture: await textureDataUrl(`${textures()}/texture/${sk.texture}`).catch(() => null),
  }));
  return { skins: skins.filter((sk) => sk.texture), next: res.pagination?.next?.after || null };
}

/**
 * One search box for everything: a player with that exact name (when it could be one)
 * comes first, followed by gallery skins whose name matches.
 */
async function searchSkins(query = '', after = null) {
  const q = String(query || '').trim();
  const wantPlayer = !after && PLAYER_NAME.test(q);
  const [player, results] = await Promise.all([
    wantPlayer ? lookupPlayer(q).catch(() => null) : null,
    searchGallery(q, after).catch((err) => ({ skins: [], next: null, error: err.message })),
  ]);
  const skins = results.skins;
  if (player?.skin) skins.unshift({ id: `player:${player.uuid}`, name: player.name, source: 'player', variant: player.variant, texture: player.skin });
  if (!skins.length && results.error) throw new Error(`Couldn't reach the skin gallery: ${results.error}`);
  return { skins, next: results.next };
}

/** The UI-friendly view of a profile: what is worn now, and every cape owned. */
async function describe(profile) {
  const skin = (profile.skins || []).find((s) => s.state === 'ACTIVE') || null;
  const capes = await Promise.all((profile.capes || []).map(async (c) => ({
    id: c.id,
    name: c.alias || 'Cape',
    active: c.state === 'ACTIVE',
    texture: await textureDataUrl(c.url).catch(() => null),
  })));
  return {
    name: profile.name,
    uuid: profile.id,
    skin: skin ? { url: skin.url, variant: (skin.variant || 'CLASSIC').toLowerCase(), texture: await textureDataUrl(skin.url).catch(() => null) } : null,
    capes,
  };
}

/**
 * The wardrobe: skins kept on this computer so you can switch back and forth.
 * Each one is a PNG next to an index.json holding its name and arm model.
 */
class Wardrobe {
  constructor(dir) {
    this.dir = dir;
    this.index = path.join(dir, 'index.json');
    this.wornFile = path.join(dir, 'worn.json');
  }

  /** Remembers which wardrobe skin an account put on, tied to the texture Mojang gave back. */
  async setWorn(uuid, id, url) {
    const worn = await readJson(this.wornFile, {});
    if (id) worn[uuid] = { id, url };
    else delete worn[uuid];
    await fsp.mkdir(this.dir, { recursive: true });
    await writeJson(this.wornFile, worn);
  }

  /** The wardrobe id being worn, as long as nothing changed the skin since. */
  async wornId(uuid, currentUrl) {
    const w = (await readJson(this.wornFile, {}))[uuid];
    return w && currentUrl && w.url === currentUrl ? w.id : null;
  }

  async list() {
    const items = await readJson(this.index, []);
    const out = [];
    for (const item of items) {
      try {
        out.push({ ...item, texture: toDataUrl(await fsp.readFile(path.join(this.dir, `${item.id}.png`))) });
      } catch { /* file removed by hand */ }
    }
    return out;
  }

  /** Adds a skin unless the exact same image is already there; returns the entry. */
  async add({ name, variant, png, source }) {
    checkSkin(png);
    const hash = crypto.createHash('sha1').update(png).digest('hex');
    const items = await readJson(this.index, []);
    const existing = items.find((i) => i.hash === hash);
    if (existing) {
      if (variant && existing.variant !== variant) {
        existing.variant = variant;
        await writeJson(this.index, items);
      }
      return existing;
    }
    const entry = {
      id: hash.slice(0, 12),
      hash,
      name: String(name || 'Skin').slice(0, 40),
      variant: variant === 'slim' ? 'slim' : 'classic',
      source: source || 'file',
      added: Date.now(),
    };
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(path.join(this.dir, `${entry.id}.png`), png);
    items.unshift(entry);
    await writeJson(this.index, items);
    return entry;
  }

  async get(id) {
    const items = await readJson(this.index, []);
    const entry = items.find((i) => i.id === id);
    if (!entry) throw new Error('That skin is no longer in your wardrobe.');
    return { ...entry, png: await fsp.readFile(path.join(this.dir, `${entry.id}.png`)) };
  }

  async update(id, patch) {
    const items = await readJson(this.index, []);
    const entry = items.find((i) => i.id === id);
    if (!entry) return null;
    if (patch.name) entry.name = String(patch.name).slice(0, 40);
    if (patch.variant) entry.variant = patch.variant === 'slim' ? 'slim' : 'classic';
    await writeJson(this.index, items);
    return entry;
  }

  async remove(id) {
    const items = await readJson(this.index, []);
    await writeJson(this.index, items.filter((i) => i.id !== id));
    await fsp.rm(path.join(this.dir, `${id}.png`), { force: true });
  }
}

module.exports = {
  pngSize, checkSkin, toDataUrl, fromDataUrl, secureTextureUrl,
  getProfile, uploadSkin, resetSkin, showCape, textureDataUrl, lookupPlayer, searchGallery, searchSkins, describe, Wardrobe,
};
