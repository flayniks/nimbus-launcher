'use strict';
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { request, getJson, HttpError } = require('./http');
const { readJson, writeJson } = require('./util');

// Tests point this at a local stand-in for Mojang's API.
const services = () => process.env.NIMBUS_SERVICES_URL || 'https://api.minecraftservices.com';

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

/** Downloads a skin or cape texture as a data URL, so the UI never needs to reach Mojang itself. */
async function textureDataUrl(url) {
  const src = secureTextureUrl(url);
  if (!src) return null;
  if (!textureCache.has(src)) {
    const job = request(src, { timeout: 15000 })
      .then(async (res) => toDataUrl(Buffer.from(await res.arrayBuffer())))
      .catch((err) => { textureCache.delete(src); throw err; });
    textureCache.set(src, job);
  }
  return textureCache.get(src);
}

/** The worn skin of any player, by name — for copying a look into your wardrobe. */
async function lookupPlayer(name) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{2,16}$/.test(clean)) throw new Error('Minecraft names are 2–16 letters, numbers or underscores.');
  let id = null;
  try {
    const res = await request(`https://api.mojang.com/users/profiles/minecraft/${clean}`);
    const text = await res.text();
    id = text ? JSON.parse(text).id : null;
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
  }
  if (!id) throw new Error(`No player called ${clean}.`);
  const profile = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
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
  getProfile, uploadSkin, resetSkin, showCape, textureDataUrl, lookupPlayer, describe, Wardrobe,
};
