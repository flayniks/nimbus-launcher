'use strict';
// Worlds (maps): what's in an instance's saves folder, and putting a map from a .zip there.
// Map zips come in every shape: the world at the top, inside a folder, several worlds in one
// zip, or wrapped in an extra folder or two. A world is wherever a level.dat is.
const fsp = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const AdmZip = require('adm-zip');
const { readNbt } = require('./servers');

const MAX_ENTRIES = 50_000;
const MAX_BYTES = 8 * 1024 ** 3; // 8 GB unpacked: big adventure maps are a few GB at most
const MARK = 'nimbus-map.json';

/** A folder name every system accepts. */
function safeFolder(name) {
  const clean = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '')
    .replace(/^[. ]+/g, '')
    .trim()
    .slice(0, 60);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) || !clean ? 'Map' : clean;
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** "Skyblock", or "Skyblock (2)" when that's taken. */
async function freeFolder(savesDir, name) {
  const base = safeFolder(name);
  let folder = base;
  for (let n = 2; await exists(path.join(savesDir, folder)); n++) folder = `${base} (${n})`;
  return folder;
}

/** The world's own name, from its level.dat (null when it can't be read). */
function levelName(buf) {
  try {
    const nbt = readNbt(zlib.gunzipSync(buf));
    const name = nbt.Data?.LevelName;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The same level.dat with its LevelName (the name in Minecraft's world list) changed. Only that
 * string is touched; null when it isn't there.
 */
function withLevelName(buf, name) {
  let raw;
  try {
    raw = zlib.gunzipSync(buf);
  } catch {
    return null;
  }
  const key = Buffer.from([8, 0, 9, ...Buffer.from('LevelName')]);
  const at = raw.indexOf(key);
  if (at < 0) return null;
  const start = at + key.length;
  const oldLen = raw.readUInt16BE(start);
  // NBT writes Java's modified UTF-8: plain UTF-8 is the same for names without NUL or emoji
  const value = Buffer.from(String(name).replace(/[\u0000\u{10000}-\u{10FFFF}]/gu, '').slice(0, 80), 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(value.length);
  return zlib.gzipSync(Buffer.concat([raw.subarray(0, start), len, value, raw.subarray(start + 2 + oldLen)]));
}

/**
 * Unpacks the world(s) in a map zip into `savesDir`. Returns [{folder, name}]. `name` (the map's
 * title) names the folder when the zip has one world, else its folder in the zip, else
 * `fallback` (the zip's file name); `mark` is saved next to it, so the launcher knows later
 * where the world came from.
 */
async function installMap(zipFile, savesDir, { name = null, fallback = null, mark = null, rename = false } = {}) {
  let entries;
  try {
    entries = new AdmZip(zipFile).getEntries();
  } catch {
    throw new Error('That file is not a zip, so it can\'t be a map.');
  }
  if (entries.length > MAX_ENTRIES) throw new Error('That zip has too many files to be a map.');
  let total = 0;
  const files = [];
  for (const e of entries) {
    const rel = e.entryName.replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    // junk from macOS, and anything that tries to leave the folder it's unpacked into
    if (!parts.length || parts[0] === '__MACOSX' || parts.some((p) => p === '..' || p === '.') || /^[a-z]:/i.test(rel) || rel.startsWith('/')) continue;
    if (parts[parts.length - 1] === '.DS_Store') continue;
    if (!e.isDirectory) {
      total += e.header.size;
      if (total > MAX_BYTES) throw new Error('That map is too big to unpack (over 8 GB).');
    }
    files.push({ e, parts });
  }
  // every folder holding a level.dat is a world; a world inside another world's folder isn't
  let roots = files.filter((f) => !f.e.isDirectory && f.parts[f.parts.length - 1].toLowerCase() === 'level.dat').map((f) => f.parts.slice(0, -1));
  roots.sort((a, b) => a.length - b.length);
  roots = roots.filter((r, i) => !roots.slice(0, i).some((o) => o.length < r.length && o.every((p, k) => r[k] === p)));
  if (!roots.length) throw new Error('There is no Minecraft world in that zip (no level.dat).');

  await fsp.mkdir(savesDir, { recursive: true });
  const out = [];
  for (const root of roots) {
    const inRoot = files.filter((f) => f.parts.length > root.length && root.every((p, k) => f.parts[k] === p));
    const levelEntry = inRoot.find((f) => f.parts.length === root.length + 1 && f.parts[root.length].toLowerCase() === 'level.dat');
    const worldName = levelName(levelEntry.e.getData());
    // one world: the map's title, else its folder in the zip; several: each by its own folder
    const label = roots.length === 1 ? name || root[root.length - 1] || fallback || worldName : root[root.length - 1] || worldName || name || fallback;
    const folder = await freeFolder(savesDir, label || 'Map');
    const dest = path.join(savesDir, folder);
    const resolvedDest = path.resolve(dest);
    for (const f of inRoot) {
      const target = path.resolve(dest, ...f.parts.slice(root.length));
      if (target !== resolvedDest && !target.startsWith(resolvedDest + path.sep)) continue;
      if (f.e.isDirectory) {
        await fsp.mkdir(target, { recursive: true });
      } else {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, f.e.getData());
      }
    }
    if (mark) await fsp.writeFile(path.join(dest, MARK), JSON.stringify({ ...mark, installed: Date.now() }, null, 2));
    // the world list shows LevelName, and many maps leave it at "New World": a map from
    // CurseForge is named after itself, one from a file after its folder when it has no name
    let shown = worldName || folder;
    const wanted = roots.length === 1 && rename && name ? name : (!worldName || /^new world$/i.test(worldName)) ? folder : null;
    if (wanted && wanted !== worldName) {
      const file = path.join(dest, levelEntry.parts[root.length]);
      const patched = withLevelName(await fsp.readFile(file), wanted);
      if (patched) {
        await fsp.writeFile(file, patched);
        shown = wanted;
      }
    }
    out.push({ folder, name: shown });
  }
  return out;
}

/** The worlds in a saves folder: [{folder, name, lastPlayed, map}] (map: where it came from, if Nimbus installed it). */
async function listWorlds(savesDir) {
  let dirs = [];
  try {
    dirs = (await fsp.readdir(savesDir, { withFileTypes: true })).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  const out = [];
  for (const d of dirs) {
    const dir = path.join(savesDir, d.name);
    let buf;
    try {
      buf = await fsp.readFile(path.join(dir, 'level.dat'));
    } catch {
      continue;
    }
    let map = null;
    try { map = JSON.parse(await fsp.readFile(path.join(dir, MARK), 'utf8')); } catch { /* not from Nimbus */ }
    const st = await fsp.stat(path.join(dir, 'level.dat')).catch(() => null);
    out.push({ folder: d.name, name: levelName(buf) || d.name, lastPlayed: st ? st.mtimeMs : 0, map });
  }
  return out.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

module.exports = { installMap, listWorlds, safeFolder, levelName, withLevelName };
