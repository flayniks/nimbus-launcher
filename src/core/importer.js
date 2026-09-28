'use strict';
// Imports instances from other launchers: CurseForge, Prism Launcher, MultiMC, ATLauncher and the
// Modrinth App. Each one keeps the Minecraft version and mod loader somewhere different; the game
// folder (mods, configs, worlds, packs, options) is copied as it is.
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const { exists, readJson } = require('./util');

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const LOCAL = process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share');
const MAC = path.join(HOME, 'Library', 'Application Support');

/** Where each launcher keeps its instances, on every system. */
const SOURCES = [
  { id: 'curseforge', name: 'CurseForge', dirs: [path.join(HOME, 'curseforge', 'minecraft', 'Instances'), path.join(HOME, 'Documents', 'Curse', 'Minecraft', 'Instances')] },
  { id: 'prism', name: 'Prism Launcher', dirs: [path.join(APPDATA, 'PrismLauncher', 'instances'), path.join(LOCAL, 'PrismLauncher', 'instances'), path.join(MAC, 'PrismLauncher', 'instances'), path.join(HOME, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher', 'instances')] },
  { id: 'multimc', name: 'MultiMC', dirs: [path.join(HOME, 'MultiMC', 'instances'), path.join(HOME, 'Desktop', 'MultiMC', 'instances'), 'C:\\MultiMC\\instances', path.join(LOCAL, 'multimc', 'instances'), path.join(MAC, 'MultiMC', 'instances')] },
  { id: 'atlauncher', name: 'ATLauncher', dirs: [path.join(APPDATA, 'ATLauncher', 'instances'), path.join(LOCAL, 'atlauncher', 'instances'), path.join(MAC, 'ATLauncher', 'instances')] },
  { id: 'modrinth', name: 'Modrinth App', dirs: [path.join(APPDATA, 'com.modrinth.theseus', 'profiles'), path.join(APPDATA, 'ModrinthApp', 'profiles'), path.join(LOCAL, 'com.modrinth.theseus', 'profiles'), path.join(LOCAL, 'ModrinthApp', 'profiles'), path.join(MAC, 'com.modrinth.theseus', 'profiles')] },
];

// launcher bookkeeping and things Minecraft makes again by itself
const SKIP = new Set(['logs', 'crash-reports', '.fabric', '.quilt', '.mixin.out', 'natives', 'assets', 'libraries', 'versions', '.cache', 'cache', 'downloads', 'webcache', 'webcache2', 'debug', '.index',
  'minecraftinstance.json', 'instance.cfg', 'mmc-pack.json', 'profile.json', 'instance.json', 'launcher_profiles.json', 'usercache.json', 'usernamecache.json', 'patches', '.minecraft.lock', 'icon.png']);

const LOADER_UIDS = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.minecraftforge': 'forge',
  'net.neoforged': 'neoforge',
};

/** Nimbus keeps Forge versions as "<minecraft>-<forge>". */
function loaderVersionFor(loader, mc, v) {
  if (!v) return null;
  if (loader === 'forge') return v.startsWith(`${mc}-`) ? v : `${mc}-${v}`;
  return v;
}

function iniValue(text, key) {
  const m = String(text || '').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

/**
 * What an instance folder is: {source, name, mcVersion, loader, loaderVersion, gameDir} or null.
 * Works out the format from the files in it.
 */
async function readInstance(dir) {
  // CurseForge: minecraftinstance.json, the folder itself is the game folder
  const cf = await readJson(path.join(dir, 'minecraftinstance.json'), null);
  if (cf && (cf.gameVersion || cf.baseModLoader)) {
    const mc = cf.baseModLoader?.minecraftVersion || cf.gameVersion;
    const raw = String(cf.baseModLoader?.name || '');
    const kind = raw.split('-')[0].toLowerCase();
    const loader = ['forge', 'fabric', 'quilt', 'neoforge'].includes(kind) ? kind : 'vanilla';
    let v = null;
    if (loader === 'forge') v = cf.baseModLoader?.forgeVersion || raw.slice(6);
    else if (loader !== 'vanilla') v = raw.slice(kind.length + 1).replace(new RegExp(`-${mc?.replace(/\./g, '\\.')}$`), '');
    return { source: 'curseforge', name: cf.name || path.basename(dir), mcVersion: mc, loader, loaderVersion: loaderVersionFor(loader, mc, v), gameDir: dir };
  }
  // Prism and MultiMC: instance.cfg + mmc-pack.json, the game in .minecraft (or minecraft)
  const cfg = await fsp.readFile(path.join(dir, 'instance.cfg'), 'utf8').catch(() => null);
  const pack = await readJson(path.join(dir, 'mmc-pack.json'), null);
  if (pack?.components) {
    const mc = pack.components.find((c) => c.uid === 'net.minecraft')?.version;
    const lc = pack.components.find((c) => LOADER_UIDS[c.uid]);
    const loader = lc ? LOADER_UIDS[lc.uid] : 'vanilla';
    let gameDir = path.join(dir, '.minecraft');
    if (!(await exists(gameDir)) && (await exists(path.join(dir, 'minecraft')))) gameDir = path.join(dir, 'minecraft');
    return { source: 'prism', name: iniValue(cfg, 'name') || path.basename(dir), mcVersion: mc, loader, loaderVersion: loaderVersionFor(loader, mc, lc?.version), gameDir };
  }
  // ATLauncher: instance.json with a "launcher" block
  const at = await readJson(path.join(dir, 'instance.json'), null);
  if (at?.launcher && (at.id || at.minecraftVersion)) {
    const mc = at.id || at.minecraftVersion;
    const type = String(at.launcher.loaderVersion?.type || '').toLowerCase();
    const loader = ['forge', 'fabric', 'quilt', 'neoforge'].includes(type) ? type : 'vanilla';
    return { source: 'atlauncher', name: at.launcher.name || path.basename(dir), mcVersion: mc, loader, loaderVersion: loaderVersionFor(loader, mc, at.launcher.loaderVersion?.version), gameDir: dir };
  }
  // the Modrinth App (older versions kept a profile.json per profile)
  const mr = await readJson(path.join(dir, 'profile.json'), null);
  if (mr?.metadata?.game_version) {
    const m = mr.metadata;
    const loader = ['forge', 'fabric', 'quilt', 'neoforge'].includes(m.loader) ? m.loader : 'vanilla';
    return { source: 'modrinth', name: m.name || path.basename(dir), mcVersion: m.game_version, loader, loaderVersion: loaderVersionFor(loader, m.game_version, m.loader_version?.id), gameDir: dir };
  }
  return null;
}

async function countFiles(dir, re) {
  try { return (await fsp.readdir(dir)).filter((f) => re.test(f)).length; } catch { return 0; }
}

/** Everything found in a folder of instances (or the folder itself, if it is one). */
async function scanFolder(root, sourceName = null) {
  const out = [];
  const one = await readInstance(root);
  const dirs = one ? [root] : (await fsp.readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name));
  for (const dir of dirs) {
    const info = dir === root ? one : await readInstance(dir);
    if (!info || !info.mcVersion) continue;
    const mods = await countFiles(path.join(info.gameDir, 'mods'), /\.jar$/i);
    const worlds = (await fsp.readdir(path.join(info.gameDir, 'saves'), { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).length;
    out.push({ ...info, sourceName: sourceName || SOURCES.find((s) => s.id === info.source)?.name || info.source, path: dir, mods, worlds });
  }
  return out;
}

/** Instances of every launcher found on this computer. */
async function scan({ sources = SOURCES } = {}) {
  const out = [];
  for (const src of sources) {
    for (const dir of src.dirs) {
      if (!(await exists(dir))) continue;
      for (const found of await scanFolder(dir, src.name)) out.push(found);
    }
  }
  return out;
}

/** Copies a game folder into a Nimbus instance, leaving out launcher bookkeeping. */
async function copyGame(from, to, onFile = () => {}) {
  await fsp.mkdir(to, { recursive: true });
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('hs_err_pid')) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    onFile(entry.name);
    if (entry.isDirectory()) await fsp.cp(src, dest, { recursive: true, force: true, errorOnExist: false });
    else if (entry.isFile()) await fsp.copyFile(src, dest);
  }
}

module.exports = { SOURCES, readInstance, scanFolder, scan, copyGame, loaderVersionFor };
