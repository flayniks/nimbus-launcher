'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { getJson } = require('./http');
const { exists, readJson, writeJson } = require('./util');

const RUNTIME_INDEX = 'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

/**
 * Mojang's platform keys, with the platforms to fall back on when a runtime is missing for ours.
 * `x64First` is for ARM machines running a version whose LWJGL has no ARM natives:
 * an x64 Java under Rosetta/emulation can load them, a native ARM Java cannot.
 */
function platformKeys({ x64First = false } = {}) {
  const { platform, arch } = process;
  if (platform === 'win32') {
    if (arch === 'arm64') return x64First ? ['windows-x64', 'windows-arm64'] : ['windows-arm64', 'windows-x64'];
    if (arch === 'ia32') return ['windows-x86'];
    return ['windows-x64'];
  }
  if (platform === 'darwin') {
    if (arch !== 'arm64') return ['mac-os'];
    return x64First ? ['mac-os', 'mac-os-arm64'] : ['mac-os-arm64', 'mac-os'];
  }
  if (arch === 'ia32') return ['linux-i386'];
  if (arch === 'x64') return ['linux'];
  return [];
}

const COMPONENT_MAJOR = {
  'jre-legacy': 8,
  'java-runtime-alpha': 16,
  'java-runtime-beta': 17,
  'java-runtime-gamma': 17,
  'java-runtime-gamma-snapshot': 17,
  'java-runtime-delta': 21,
  'java-runtime-epsilon': 25,
};

function javaFor(version) {
  const component = version.javaVersion?.component || 'jre-legacy';
  const major = version.javaVersion?.majorVersion || COMPONENT_MAJOR[component] || 8;
  return { component, major };
}

function javaBinary(home, { console = false } = {}) {
  if (process.platform === 'win32') return path.join(home, 'bin', console ? 'java.exe' : 'javaw.exe');
  if (process.platform === 'darwin') {
    const bundled = path.join(home, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
    if (fs.existsSync(bundled)) return bundled;
  }
  return path.join(home, 'bin', 'java');
}

/**
 * Makes sure Mojang's Java runtime for `component` is installed and returns its home.
 * A marker file records which manifest we installed, so later launches skip the file check.
 */
async function ensureRuntime(paths, component, downloader, { deep = false, x64First = false } = {}) {
  const home = path.join(paths.runtimes, x64First ? `${component}-x64` : component);
  const marker = path.join(home, '.nimbus-runtime.json');
  const done = await readJson(marker, null);

  let index;
  try {
    index = await getJson(RUNTIME_INDEX, { timeout: 15000 });
  } catch (err) {
    if (done && (await exists(javaBinary(home)))) return home;
    throw err;
  }

  let entry = null;
  let platform = null;
  for (const key of platformKeys({ x64First })) {
    const list = index[key]?.[component];
    if (list && list.length) { entry = list[0]; platform = key; break; }
  }
  if (!entry) return null;

  if (!deep && done && done.sha1 === entry.manifest.sha1 && (await exists(javaBinary(home)))) return home;

  const manifest = await getJson(entry.manifest.url);
  const tasks = [];
  const links = [];
  for (const [rel, file] of Object.entries(manifest.files)) {
    const target = path.join(home, ...rel.split('/'));
    if (file.type === 'directory') await fsp.mkdir(target, { recursive: true });
    else if (file.type === 'file') {
      const raw = file.downloads.raw;
      tasks.push({ url: raw.url, path: target, sha1: raw.sha1, size: raw.size, executable: file.executable });
    } else if (file.type === 'link') links.push({ target, to: file.target });
  }
  await downloader.run(tasks, { deep, label: `Java ${entry.version.name}` });

  if (process.platform !== 'win32') {
    for (const link of links) {
      await fsp.rm(link.target, { force: true });
      await fsp.mkdir(path.dirname(link.target), { recursive: true });
      await fsp.symlink(link.to, link.target).catch(() => {});
    }
  }
  await writeJson(marker, { sha1: entry.manifest.sha1, version: entry.version.name, platform });
  return home;
}

/** True on ARM Macs/PCs when the game's LWJGL ships no ARM natives (1.18 and older). */
function needsX64Java(version) {
  if (process.arch !== 'arm64' || (process.platform !== 'darwin' && process.platform !== 'win32')) return false;
  const tag = process.platform === 'darwin' ? 'natives-macos-arm64' : 'natives-windows-arm64';
  return !(version.libraries || []).some((lib) => (lib.name || '').includes(tag));
}

/** Runs `java -version` and pulls out the major version (8, 17, 21...). */
function probeJava(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stderr) return resolve(null);
      const text = `${stderr}\n${stdout}`;
      const m = text.match(/version "([^"]+)"/);
      if (!m) return resolve(null);
      const ver = m[1];
      const parts = ver.split(/[._-]/).map((n) => parseInt(n, 10));
      const major = parts[0] === 1 ? parts[1] : parts[0];
      resolve({ path: bin, version: ver, major, is64: /64-Bit/i.test(text) });
    });
  });
}

/** Looks for Java installs already on this machine, for the settings screen and for platforms Mojang does not ship. */
async function findSystemJavas(paths) {
  const candidates = new Set();
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  if (process.env.JAVA_HOME) candidates.add(path.join(process.env.JAVA_HOME, 'bin', exe));
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.add(path.join(dir, exe));
  }
  const roots = [];
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      for (const vendor of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto']) roots.push(path.join(base, vendor));
    }
  } else if (process.platform === 'darwin') {
    roots.push('/Library/Java/JavaVirtualMachines');
  } else {
    roots.push('/usr/lib/jvm', '/usr/java', '/opt/java');
  }
  for (const root of roots) {
    let entries = [];
    try { entries = await fsp.readdir(root); } catch { continue; }
    for (const e of entries) {
      const home = process.platform === 'darwin' ? path.join(root, e, 'Contents', 'Home') : path.join(root, e);
      candidates.add(path.join(home, 'bin', exe));
    }
  }
  if (paths) {
    for (const comp of Object.keys(COMPONENT_MAJOR)) {
      const home = path.join(paths.runtimes, comp);
      candidates.add(javaBinary(home, { console: true }));
    }
  }
  const found = [];
  const seen = new Set();
  for (const c of candidates) {
    if (!(await exists(c))) continue;
    let real = c;
    try { real = await fsp.realpath(c); } catch { /* keep the path we have */ }
    if (seen.has(real)) continue;
    seen.add(real);
    const info = await probeJava(c);
    if (info) found.push(info);
  }
  return found.sort((a, b) => b.major - a.major);
}

/**
 * Picks the Java binary for a version: the instance's own choice, then Mojang's runtime,
 * then whatever matching Java is installed.
 */
async function resolveJava(paths, version, downloader, { customPath, deep } = {}) {
  const { component, major } = javaFor(version);
  if (customPath) {
    if (!(await exists(customPath))) throw new Error(`Custom Java not found: ${customPath}`);
    return { bin: customPath, console: customPath, major: (await probeJava(customPath))?.major || major };
  }
  const home = await ensureRuntime(paths, component, downloader, { deep, x64First: needsX64Java(version) });
  if (home) return { bin: javaBinary(home), console: javaBinary(home, { console: true }), major };

  const system = await findSystemJavas(paths);
  const pick = system.find((j) => j.major === major) || system.find((j) => j.major > major && major >= 17) || null;
  if (!pick) throw new Error(`Minecraft ${version.id} needs Java ${major}, and Mojang does not ship one for this platform. Install Java ${major} and pick it in the instance settings.`);
  return { bin: pick.path, console: pick.path, major: pick.major };
}

module.exports = { RUNTIME_INDEX, platformKeys, needsX64Java, javaFor, javaBinary, ensureRuntime, probeJava, findSystemJavas, resolveJava };
