'use strict';
// Switches on resource packs and shader packs that are new to an instance, so a pack you
// add (from Browse, from a file, or by dropping it into the folder) is simply there when
// the game starts. Minecraft itself never enables a new pack on its own. Only packs we
// have not seen before are touched: one you switch off in game stays off.
const fsp = require('fs').promises;
const path = require('path');
const { readJson, writeJson, exists } = require('./util');

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
 */
async function enableNewPacks({ gameDir, mcVersion, stateFile }) {
  const seen = await readJson(stateFile, null);
  const resourcepacks = await listPacks(path.join(gameDir, 'resourcepacks'));
  const shaderpacks = await listPacks(path.join(gameDir, 'shaderpacks'));
  const known = new Set(seen?.resourcepacks || []);
  const knownShaders = new Set(seen?.shaderpacks || []);
  const freshPacks = resourcepacks.filter((p) => !known.has(p));
  const freshShaders = shaderpacks.filter((p) => !knownShaders.has(p));
  const result = { resourcepacks: [], shader: null };

  const style = packStyle(mcVersion);
  if (freshPacks.length && style) {
    const file = path.join(gameDir, 'options.txt');
    const opts = await readKeyValues(file);
    const name = (p) => (style === 'modern' ? `file/${p}` : p);
    const enabled = opts.get('resourcePacks') !== undefined ? parseList(opts.get('resourcePacks')) : (style === 'modern' ? ['vanilla'] : []);
    const allowed = parseList(opts.get('incompatibleResourcePacks') || '[]');
    for (const p of freshPacks) {
      if (!enabled.includes(name(p))) enabled.push(name(p)); // last = on top
      // listed as accepted too, so a pack made for another version still loads instead of being dropped
      if (style === 'modern' && !allowed.includes(name(p))) allowed.push(name(p));
      result.resourcepacks.push(p);
    }
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

  await writeJson(stateFile, { resourcepacks, shaderpacks });
  return result;
}

module.exports = { enableNewPacks, packStyle, shaderLoader };
