'use strict';
// Switches on resource packs and shader packs that are new to an instance, so a pack you
// add (from Browse, from a file, or by dropping it into the folder) is simply there when
// the game starts. Minecraft itself never enables a new pack on its own. Only packs we
// have not seen before are touched: one you switch off in game stays off.
const fsp = require('fs').promises;
const path = require('path');
const { readJson, writeJson, exists } = require('./util');

/**
 * The resource pack format this game jar expects, from its version.json:
 * a number (1.14-1.17), {resource} (1.18-1.21.8), or {resource_major, resource_minor} (1.21.9+).
 */
function gameFormat(clientJar) {
  try {
    const AdmZip = require('adm-zip');
    const json = JSON.parse(new AdmZip(clientJar).readAsText('version.json'));
    const v = json.pack_version;
    if (typeof v === 'number') return { major: v, minor: 0 };
    if (v && typeof v.resource === 'number') return { major: v.resource, minor: 0 };
    if (v && typeof v.resource_major === 'number') return { major: v.resource_major, minor: v.resource_minor || 0 };
  } catch { /* no jar yet, or an old one without version.json */ }
  return null;
}

async function readMcmeta(dir, name) {
  try {
    const file = path.join(dir, name);
    const text = (await fsp.stat(file)).isDirectory()
      ? await fsp.readFile(path.join(file, 'pack.mcmeta'), 'utf8')
      : new (require('adm-zip'))(file).readAsText('pack.mcmeta');
    return JSON.parse(text.replace(/^\uFEFF/, '')).pack || null;
  } catch {
    return null;
  }
}

const asVersion = (v) => (Array.isArray(v) ? { major: Number(v[0]) || 0, minor: Number(v[1]) || 0 } : { major: Number(v) || 0, minor: 0 });
const cmp = (a, b) => a.major - b.major || a.minor - b.minor;

/** true / false when we can tell whether the pack suits the game, null when we can't. */
function packFits(meta, game) {
  if (!meta || !game) return null;
  if (meta.min_format !== undefined || meta.max_format !== undefined) {
    const lo = asVersion(meta.min_format ?? meta.max_format);
    const hi = asVersion(meta.max_format ?? meta.min_format);
    return cmp(lo, game) <= 0 && cmp(game, hi) <= 0;
  }
  const range = meta.supported_formats;
  if (range !== undefined) {
    const [lo, hi] = Array.isArray(range) ? range : typeof range === 'number' ? [range, range] : [range.min_inclusive, range.max_inclusive];
    return Number(lo) <= game.major && game.major <= Number(hi);
  }
  if (typeof meta.pack_format === 'number') return meta.pack_format === game.major;
  return null;
}

/** How this version writes enabled packs in options.txt, or null when we leave it alone. */
function packStyle(mcVersion = '') {
  const v = String(mcVersion);
  if (/^\d{2}\.\d+/.test(v) && Number(v.split('.')[0]) >= 26) return 'modern';
  const m = /^1\.(\d+)/.exec(v);
  if (m) {
    const minor = Number(m[1]);
    if (minor >= 13) return 'modern';
    if (minor >= 6) return 'legacy';
    return null;
  }
  // snapshots like 24w14a are modern; alpha/beta and older are not
  if (/^\d{2}w\d{2}[a-z]$/.test(v)) return 'modern';
  return null;
}

async function listPacks(dir) {
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => !e.name.endsWith('.disabled') && !e.name.startsWith('.') && (e.isDirectory() || /\.zip$/i.test(e.name)))
    .map((e) => e.name)
    .sort();
}

function parseList(value) {
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

/** Reads a key: value file into ordered lines and a lookup. */
async function readKeyValues(file, sep = ':') {
  if (!(await exists(file))) return { lines: [], get: () => undefined };
  const lines = (await fsp.readFile(file, 'utf8')).split(/\r?\n/).filter((l) => l.length);
  return {
    lines,
    get(key) {
      for (const l of lines) {
        const i = l.indexOf(sep);
        if (i !== -1 && l.slice(0, i).trim() === key) return l.slice(i + 1).trim();
      }
      return undefined;
    },
  };
}

async function writeKeyValues(file, lines, values, sep = ':') {
  const left = { ...values };
  const out = lines.map((line) => {
    const i = line.indexOf(sep);
    const key = i === -1 ? line : line.slice(0, i).trim();
    if (key in left) {
      const v = left[key];
      delete left[key];
      return `${key}${sep}${v}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(left)) out.push(`${k}${sep}${v}`);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${out.join('\n')}\n`);
}

/** The shader loader in this instance, from the mods folder: iris, oculus, optifine or null. */
async function shaderLoader(gameDir) {
  let files = [];
  try { files = await fsp.readdir(path.join(gameDir, 'mods')); } catch { return null; }
  const on = files.filter((f) => /\.jar$/i.test(f)).map((f) => f.toLowerCase());
  if (on.some((f) => f.includes('oculus'))) return 'oculus';
  if (on.some((f) => f.includes('iris'))) return 'iris';
  if (on.some((f) => f.includes('optifine'))) return 'optifine';
  return null;
}

/**
 * Turns on packs added since the last launch. `stateFile` remembers which packs were
 * already there. Returns { resourcepacks: [...enabled], shader: name|null }.
 *
 * A pack only goes on Minecraft's "incompatibleResourcePacks" list (which lets a pack for
 * another version load) when it really is for another version: the game quietly skips a
 * compatible pack that is on that list, for that whole session.
 */
async function enableNewPacks({ gameDir, mcVersion, stateFile, clientJar }) {
  const seen = await readJson(stateFile, null);
  const packDir = path.join(gameDir, 'resourcepacks');
  const resourcepacks = await listPacks(packDir);
  const shaderpacks = await listPacks(path.join(gameDir, 'shaderpacks'));
  const known = new Set(seen?.resourcepacks || []);
  const knownShaders = new Set(seen?.shaderpacks || []);
  const result = { resourcepacks: [], shader: null };
  const style = packStyle(mcVersion);
  const game = style === 'modern' && clientJar ? gameFormat(clientJar) : null;
  const file = path.join(gameDir, 'options.txt');
  const opts = await readKeyValues(file);
  const name = (p) => (style === 'modern' ? `file/${p}` : p);
  const enabled = opts.get('resourcePacks') !== undefined ? parseList(opts.get('resourcePacks')) : (style === 'modern' ? ['vanilla'] : []);
  const allowed = parseList(opts.get('incompatibleResourcePacks') || '[]');

  // Before 1.4.4 every new pack was put on the incompatible list, so compatible ones were
  // dropped by the game. Packs seen back then that are now off get one more go.
  const repairing = seen && seen.v !== 2;
  const fresh = resourcepacks.filter((p) => !known.has(p) || (repairing && !enabled.includes(name(p))));
  const freshShaders = shaderpacks.filter((p) => !knownShaders.has(p));

  let changed = false;
  if (style === 'modern' && game) {
    // take compatible packs back off the incompatible list, or the game skips them
    for (const id of [...allowed]) {
      if (!id.startsWith('file/')) continue;
      const pack = id.slice(5);
      if (!resourcepacks.includes(pack)) continue;
      if (packFits(await readMcmeta(packDir, pack), game) === true) {
        allowed.splice(allowed.indexOf(id), 1);
        changed = true;
      }
    }
  }
  if (fresh.length && style) {
    for (const p of fresh) {
      if (!enabled.includes(name(p))) enabled.push(name(p)); // last = on top
      if (style === 'modern' && game && packFits(await readMcmeta(packDir, p), game) === false && !allowed.includes(name(p))) allowed.push(name(p));
      result.resourcepacks.push(p);
    }
    changed = true;
  }
  if (changed) {
    const values = { resourcePacks: JSON.stringify(enabled) };
    if (style === 'modern') values.incompatibleResourcePacks = JSON.stringify(allowed);
    await writeKeyValues(file, opts.lines, values);
  }

  if (freshShaders.length) {
    const loader = await shaderLoader(gameDir);
    const pick = freshShaders[freshShaders.length - 1];
    if (loader === 'iris' || loader === 'oculus') {
      const file = path.join(gameDir, 'config', `${loader}.properties`);
      const props = await readKeyValues(file, '=');
      await writeKeyValues(file, props.lines, { shaderPack: pick, enableShaders: 'true' }, '=');
      result.shader = pick;
    } else if (loader === 'optifine') {
      const file = path.join(gameDir, 'optionsshaders.txt');
      const props = await readKeyValues(file, '=');
      await writeKeyValues(file, props.lines, { shaderPack: pick }, '=');
      result.shader = pick;
    }
  }

  await writeJson(stateFile, { v: 2, resourcepacks, shaderpacks });
  return result;
}

module.exports = { enableNewPacks, packStyle, shaderLoader, packFits, gameFormat };
