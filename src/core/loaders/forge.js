'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { getJson, getText, downloadFile, isValid } = require('../http');
const { mavenPath, writeJson, exists, sha1File } = require('../util');
const { libraryArtifact } = require('../install');

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEO_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged';

function compareNatural(a, b) {
  const pa = a.split(/[.\-_+]/);
  const pb = b.split(/[.\-_+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d) return d;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

let forgeIndex = null;
async function forgeVersions() {
  if (!forgeIndex) {
    forgeIndex = (async () => {
      const [xml, promos] = await Promise.all([
        getText(`${FORGE_MAVEN}/maven-metadata.xml`),
        getJson(FORGE_PROMOS).catch(() => ({ promos: {} })),
      ]);
      const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
      return { all, promos: promos.promos || {} };
    })().catch((err) => { forgeIndex = null; throw err; });
  }
  return forgeIndex;
}

/** NeoForge 21.1.77 is for 1.21.1; from 2026 it follows the game directly (26.1.0.x → 26.1). */
function neoToMinecraft(v) {
  if (v.startsWith('0.') || v.includes('+')) return null; // April Fools and snapshot builds
  const parts = v.split('-')[0].split('.');
  const [a, b, c] = parts;
  if (parseInt(a, 10) >= 25) return c === '0' || c == null ? `${a}.${b}` : `${a}.${b}.${c}`;
  return b === '0' ? `1.${a}` : `1.${a}.${b}`;
}

let neoIndex = null;
async function neoVersions() {
  if (!neoIndex) {
    neoIndex = (async () => {
      const [neo, legacy] = await Promise.all([
        getJson(`${NEO_API}/neoforge`),
        getJson(`${NEO_API}/forge`).catch(() => ({ versions: [] })),
      ]);
      const byMc = new Map();
      const add = (mc, version, artifact) => {
        if (!mc) return;
        if (!byMc.has(mc)) byMc.set(mc, []);
        byMc.get(mc).push({ version, artifact });
      };
      for (const v of neo.versions || []) add(neoToMinecraft(v), v, 'neoforge');
      // NeoForge's first release was a Forge fork for 1.20.1, published as net.neoforged:forge
      for (const v of legacy.versions || []) add(v.split('-')[0], v, 'forge');
      return byMc;
    })().catch((err) => { neoIndex = null; throw err; });
  }
  return neoIndex;
}

async function supportedGameVersions(kind) {
  if (kind === 'neoforge') return new Set((await neoVersions()).keys());
  const { all } = await forgeVersions();
  // Forge before 1.6 was a jar mod with no launcher profile to install
  return new Set(all.map((v) => v.split('-')[0]).filter((mc) => !/^1\.[0-5](\.|_|$)/.test(mc)));
}

async function listLoaderVersions(kind, mc) {
  if (kind === 'neoforge') {
    const list = ((await neoVersions()).get(mc) || []).slice();
    list.sort((x, y) => compareNatural(y.version, x.version));
    return list.map((x) => ({ version: x.version, stable: !/beta|alpha/i.test(x.version) }));
  }
  const { all, promos } = await forgeVersions();
  const list = all.filter((v) => v.startsWith(`${mc}-`)).sort((x, y) => compareNatural(y, x));
  const rec = promos[`${mc}-recommended`];
  const latest = promos[`${mc}-latest`];
  return list.map((v) => ({
    version: v,
    stable: true,
    recommended: Boolean(rec && v.startsWith(`${mc}-${rec}`)),
    latest: Boolean(latest && v.startsWith(`${mc}-${latest}`)),
  }));
}

async function installerUrl(kind, version) {
  if (kind === 'neoforge') {
    const legacy = /^1\.20\.1-/.test(version);
    const artifact = legacy ? 'forge' : 'neoforge';
    return `${NEO_MAVEN}/${artifact}/${version}/${artifact}-${version}-installer.jar`;
  }
  return `${FORGE_MAVEN}/${version}/forge-${version}-installer.jar`;
}

function readManifestMain(jarPath) {
  const zip = new AdmZip(jarPath);
  const manifest = zip.readAsText('META-INF/MANIFEST.MF');
  const m = manifest.match(/^Main-Class:\s*(.+?)\s*$/m);
  if (!m) throw new Error(`${path.basename(jarPath)} has no Main-Class`);
  return m[1];
}

function runJava(java, args, cwd, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(java, args, { cwd, windowsHide: true });
    const tail = [];
    const push = (buf) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        if (onLog) onLog(line);
      }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Installer step exited with ${code}:\n${tail.slice(-8).join('\n')}`));
    });
  });
}

/**
 * Installs Forge or NeoForge from its official installer without running the installer UI:
 * we read install_profile.json ourselves, fetch the libraries, and run the processors
 * (which patch the game jar) with the same Java the game will use.
 * Returns the id of the version JSON it wrote.
 */
async function install(ctx, kind, mc, loaderVersion, { java, onStatus = () => {}, onLog } = {}) {
  const { paths, downloader } = ctx;
  const url = await installerUrl(kind, loaderVersion);
  const installer = path.join(paths.cache, 'installers', path.basename(url));
  if (!(await exists(installer))) {
    onStatus('Downloading installer');
    await downloadFile(url, installer).catch((err) => {
      if (err.status === 404) throw new Error(`${kind === 'neoforge' ? 'NeoForge' : 'Forge'} ${loaderVersion} has no installer — pick a newer build.`);
      throw err;
    });
  }
  const zip = new AdmZip(installer);
  const profileText = zip.readAsText('install_profile.json');
  if (!profileText) throw new Error('Installer has no install_profile.json');
  const profile = JSON.parse(profileText);

  if (profile.install && profile.versionInfo) return installLegacy(ctx, zip, profile, onStatus);

  const version = JSON.parse(zip.readAsText((profile.json || '/version.json').replace(/^\//, '')));
  await writeJson(paths.versionJson(version.id), version);

  onStatus('Downloading loader libraries');
  const tasks = [];
  for (const lib of [...(profile.libraries || []), ...(version.libraries || [])]) {
    const art = libraryArtifact(lib);
    if (!art) continue;
    const dest = paths.library(art.rel);
    if (art.url) {
      tasks.push({ url: art.url, fallbacks: art.fallbacks, path: dest, sha1: art.sha1, size: art.size });
    } else {
      const entry = zip.getEntry(`maven/${art.rel}`);
      if (entry && !(await isValid(dest, art))) {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, entry.getData());
      }
    }
  }
  await downloader.run(tasks, { label: `${kind === 'neoforge' ? 'NeoForge' : 'Forge'} libraries` });

  const work = path.join(paths.cache, 'installers', `${version.id}-work`);
  const data = {
    SIDE: 'client',
    MINECRAFT_JAR: paths.versionJar(profile.minecraft || mc),
    MINECRAFT_VERSION: profile.minecraft || mc,
    ROOT: paths.root,
    INSTALLER: installer,
    LIBRARY_DIR: paths.libraries,
  };
  for (const [key, value] of Object.entries(profile.data || {})) {
    const v = value.client;
    if (v == null) continue;
    if (/^\[.+\]$/.test(v)) data[key] = paths.library(mavenPath(v.slice(1, -1)));
    else if (/^'.*'$/.test(v)) data[key] = v.slice(1, -1);
    else if (v.startsWith('/')) {
      const out = path.join(work, ...v.slice(1).split('/'));
      const entry = zip.getEntry(v.slice(1));
      if (!entry) throw new Error(`Installer is missing ${v}`);
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.writeFile(out, entry.getData());
      data[key] = out;
    } else data[key] = v;
  }

  const resolve = (arg) => {
    if (/^\[.+\]$/.test(arg)) return paths.library(mavenPath(arg.slice(1, -1)));
    return arg.replace(/\{([A-Z0-9_]+)\}/g, (whole, key) => {
      if (!(key in data)) throw new Error(`Installer asked for unknown value ${key}`);
      return data[key];
    });
  };

  const processors = (profile.processors || []).filter((p) => !p.sides || p.sides.includes('client'));
  for (let i = 0; i < processors.length; i++) {
    const p = processors[i];
    const outputs = Object.entries(p.outputs || {}).map(([file, sha]) => ({ file: resolve(file), sha1: resolve(sha) }));
    if (outputs.length) {
      let fresh = true;
      for (const o of outputs) {
        if (!(await exists(o.file)) || (await sha1File(o.file)) !== o.sha1) { fresh = false; break; }
      }
      if (fresh) continue;
    }
    const jar = paths.library(mavenPath(p.jar));
    const main = readManifestMain(jar);
    const cp = [jar, ...(p.classpath || []).map((c) => paths.library(mavenPath(c)))].join(path.delimiter);
    const task = p.args[p.args.indexOf('--task') + 1];
    onStatus(`Patching game (${i + 1}/${processors.length}${task && p.args.includes('--task') ? ` · ${task.toLowerCase()}` : ''})`);
    await runJava(java, ['-cp', cp, main, ...p.args.map(resolve)], paths.root, onLog);
    for (const o of outputs) {
      const got = await sha1File(o.file).catch(() => null);
      if (got !== o.sha1) throw new Error(`Installer step produced a bad ${path.basename(o.file)}`);
    }
  }
  await fsp.rm(work, { recursive: true, force: true });
  return version.id;
}

/** Forge up to 1.12.2's early builds: the profile carries the version JSON and a universal jar to unpack. */
async function installLegacy(ctx, zip, profile, onStatus) {
  const { paths } = ctx;
  const info = profile.versionInfo;
  const inst = profile.install;
  onStatus('Unpacking Forge');
  if (!info.inheritsFrom) {
    info.inheritsFrom = inst.minecraft;
    info.jar = inst.minecraft;
  }
  await writeJson(paths.versionJson(info.id), info);
  const dest = paths.library(mavenPath(inst.path));
  const entry = zip.getEntry(inst.filePath);
  if (!entry) throw new Error(`Installer is missing ${inst.filePath}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, entry.getData());
  return info.id;
}

module.exports = { neoToMinecraft, supportedGameVersions, listLoaderVersions, installerUrl, install, compareNatural };
