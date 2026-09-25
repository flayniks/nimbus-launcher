'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const AdmZip = require('adm-zip');
const { isValid, downloadFile } = require('./http');
const { osName, archBits, mavenPath, libraryKey, rulesAllow, exists, readJson, writeJson, pool } = require('./util');

const MOJANG_LIBRARIES = 'https://libraries.minecraft.net/';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/';
const MAVEN_CENTRAL = 'https://repo1.maven.org/maven2/';
const RESOURCES = 'https://resources.download.minecraft.net/';

function normalizeBase(url) {
  let base = url || MOJANG_LIBRARIES;
  // old Forge profiles still point at the long-dead files.minecraftforge.net/maven over http
  base = base.replace(/^https?:\/\/files\.minecraftforge\.net\/maven\/?/, FORGE_MAVEN);
  base = base.replace(/^http:\/\//, 'https://');
  return base.endsWith('/') ? base : `${base}/`;
}

/** Where a library's main jar lives and where to fetch it. `url === ''` means an installer generates it. */
function libraryArtifact(lib) {
  const art = lib.downloads?.artifact;
  if (art) {
    const rel = art.path || mavenPath(lib.name);
    return { rel, url: art.url, sha1: art.sha1, size: art.size };
  }
  if (lib.natives) return null; // natives-only entry (old profiles have no downloads block at all)
  if (!lib.name) return null;
  const rel = mavenPath(lib.name);
  const base = normalizeBase(lib.url);
  const fallbacks = [FORGE_MAVEN, MOJANG_LIBRARIES, MAVEN_CENTRAL].filter((b) => b !== base).map((b) => b + rel);
  const sums = lib.checksums;
  return {
    rel,
    url: base + rel,
    fallbacks,
    sha1: lib.sha1 || (sums && sums.length === 1 ? sums[0] : undefined),
    size: lib.size,
  };
}

/** The per-OS natives jar of an old-style (LWJGL 2 / early LWJGL 3) library. */
function nativeArtifact(lib) {
  if (!lib.natives) return null;
  let classifier = lib.natives[osName()];
  if (!classifier) return null;
  classifier = classifier.replace('${arch}', archBits());
  const art = lib.downloads?.classifiers?.[classifier];
  const exclude = lib.extract?.exclude || ['META-INF/'];
  if (art) return { rel: art.path, url: art.url, sha1: art.sha1, size: art.size, exclude };
  const rel = mavenPath(`${lib.name}:${classifier}`);
  return { rel, url: normalizeBase(lib.url) + rel, exclude };
}

/** Works out the classpath, natives and download list for a fully merged version. */
function planLibraries(paths, version) {
  const classpath = [];
  const natives = [];
  const tasks = [];
  const generated = [];
  const seen = new Set();
  for (const lib of version.libraries || []) {
    // clientreq/serverreq in old Forge profiles only told the installer what to fetch; the launcher needs them all
    if (!rulesAllow(lib.rules)) continue;

    const nat = nativeArtifact(lib);
    if (nat) {
      const abs = paths.library(nat.rel);
      if (!natives.some((n) => n.path === abs)) {
        natives.push({ path: abs, exclude: nat.exclude });
        tasks.push({ url: nat.url, path: abs, sha1: nat.sha1, size: nat.size });
      }
    }

    const art = libraryArtifact(lib);
    if (!art) continue;
    const key = lib.name ? libraryKey(lib.name) : art.rel;
    if (seen.has(key)) continue;
    seen.add(key);
    const abs = paths.library(art.rel);
    classpath.push(abs);
    if (art.url) tasks.push({ url: art.url, fallbacks: art.fallbacks, path: abs, sha1: art.sha1, size: art.size });
    else generated.push(abs);
  }
  return { classpath, natives, tasks, generated };
}

/**
 * Forge/NeoForge put `${version_name}.jar` on their ignore list, which only works when the
 * game jar is named after the loader version the way the official launcher does it.
 */
function clientJarId(version) {
  const jvm = version.arguments?.jvm || [];
  const wantsOwnName = jvm.some((a) => typeof a === 'string' && a.includes('${version_name}.jar'));
  return wantsOwnName ? version.id : version.jar || version.id;
}

async function assetPlan(paths, version) {
  const idx = version.assetIndex;
  if (!idx) return { index: null, tasks: [] };
  const file = path.join(paths.assets, 'indexes', `${idx.id}.json`);
  if (!(await isValid(file, idx))) await downloadFile(idx.url, file, { sha1: idx.sha1 });
  const index = await readJson(file);
  const tasks = [];
  for (const obj of Object.values(index.objects || {})) {
    const sub = obj.hash.slice(0, 2);
    tasks.push({
      url: `${RESOURCES}${sub}/${obj.hash}`,
      path: path.join(paths.assets, 'objects', sub, obj.hash),
      sha1: obj.hash,
      size: obj.size,
    });
  }
  return { index, tasks };
}

/**
 * Pre-1.7.3 games read assets from loose files rather than the hashed object store.
 * Returns the directory to hand the game as ${game_assets}.
 */
async function prepareLegacyAssets(paths, version, gameDir) {
  const idx = version.assetIndex;
  if (!idx) return paths.assets;
  const index = await readJson(path.join(paths.assets, 'indexes', `${idx.id}.json`), null);
  if (!index || (!index.map_to_resources && !index.virtual)) return paths.assets;
  const target = index.map_to_resources
    ? path.join(gameDir, 'resources')
    : path.join(paths.assets, 'virtual', idx.id);
  await pool(Object.entries(index.objects || {}), 32, async ([name, obj]) => {
    const dest = path.join(target, ...name.split('/'));
    if (await isValid(dest, { size: obj.size })) return;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(path.join(paths.assets, 'objects', obj.hash.slice(0, 2), obj.hash), dest);
  });
  return target;
}

async function extractNatives(nativesDir, natives) {
  const marker = path.join(nativesDir, '.nimbus-natives.json');
  const want = natives.map((n) => path.basename(n.path)).sort();
  const had = await readJson(marker, null);
  if (had && JSON.stringify(had) === JSON.stringify(want)) return;
  await fsp.rm(nativesDir, { recursive: true, force: true });
  await fsp.mkdir(nativesDir, { recursive: true });
  for (const n of natives) {
    const zip = new AdmZip(n.path);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (n.exclude.some((ex) => entry.entryName.startsWith(ex))) continue;
      const dest = path.join(nativesDir, ...entry.entryName.split('/'));
      if (!dest.startsWith(nativesDir)) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, entry.getData());
    }
  }
  await writeJson(marker, want);
}

/**
 * Downloads everything a merged version needs to run: game jar, libraries, natives,
 * assets and the logging config. Anything already on disk and the right size is skipped.
 */
async function installVersion(ctx, version, { deep = false, skipAssets = false, label } = {}) {
  const { paths, downloader } = ctx;
  const tasks = [];

  const jarId = clientJarId(version);
  const clientJar = paths.versionJar(jarId);
  const client = version.downloads?.client;
  if (client) {
    const parentJar = paths.versionJar(version.jar || version.vanilla || jarId);
    if (parentJar !== clientJar && !(await exists(clientJar)) && (await isValid(parentJar, client))) {
      await fsp.mkdir(path.dirname(clientJar), { recursive: true });
      await fsp.copyFile(parentJar, clientJar);
    }
    tasks.push({ url: client.url, path: clientJar, sha1: client.sha1, size: client.size });
  } else if (!(await exists(clientJar))) {
    throw new Error(`Version ${version.id} has no game jar to download`);
  }

  const libs = planLibraries(paths, version);
  tasks.push(...libs.tasks);

  let logConfig = null;
  const logging = version.logging?.client;
  if (logging?.file) {
    logConfig = { path: path.join(paths.assets, 'log_configs', logging.file.id), argument: logging.argument };
    tasks.push({ url: logging.file.url, path: logConfig.path, sha1: logging.file.sha1, size: logging.file.size });
  }

  if (!skipAssets) {
    const assets = await assetPlan(paths, version);
    tasks.push(...assets.tasks);
  }

  await downloader.run(tasks, { deep, label: label || `Minecraft ${version.id}` });

  const missing = [];
  for (const g of libs.generated) if (!(await exists(g))) missing.push(path.basename(g));
  if (missing.length) {
    const err = new Error(`Loader files are missing (${missing.slice(0, 3).join(', ')}). Use Repair on the instance to reinstall the loader.`);
    err.code = 'LOADER_INCOMPLETE';
    throw err;
  }

  const nativesDir = paths.nativesDir(version.id);
  await extractNatives(nativesDir, libs.natives);

  return { classpath: [...libs.classpath, clientJar], clientJar, nativesDir, logConfig };
}

module.exports = {
  MOJANG_LIBRARIES, FORGE_MAVEN, MAVEN_CENTRAL,
  libraryArtifact, nativeArtifact, planLibraries, clientJarId, installVersion, prepareLegacyAssets, extractNatives,
};
