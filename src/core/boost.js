'use strict';
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const modrinth = require('./modrinth');
const { exists } = require('./util');

/**
 * Performance mods, by job. Each group lists alternatives in order of preference;
 * the first one with a build for the instance wins and the group is skipped when any is present.
 */
const PERF_MODS = [
  { label: 'Faster renderer', ids: ['sodium', 'embeddium'], match: /sodium|embeddium|rubidium/i, render: true },
  { label: 'Faster game logic', ids: ['lithium'], match: /lithium|radium|canary/i },
  { label: 'Less memory use', ids: ['ferrite-core'], match: /ferrite/i },
  { label: 'Skip hidden entities', ids: ['entityculling'], match: /entityculling/i },
  { label: 'Faster HUD and text', ids: ['immediatelyfast'], match: /immediatelyfast/i },
  { label: 'Faster startup', ids: ['modernfix'], match: /modernfix/i },
  { label: 'Idle when tabbed out', ids: ['dynamic-fps'], match: /dynamic.?fps/i },
  { label: 'Smarter block culling', ids: ['moreculling'], match: /moreculling/i },
  { label: 'Cheaper frame work', ids: ['badoptimizations'], match: /badoptimizations/i },
];

const PRESETS = {
  potato: {
    name: 'Potato', blurb: 'For older laptops and integrated graphics. Everything as light as it goes.',
    video: { render: 6, sim: 5, graphics: 0, clouds: 'off', particles: 2, shadows: false, mipmap: 0, blend: 0, ao: false, entityDist: 0.5 },
    jvm: 'g1', priority: 'high',
  },
  balanced: {
    name: 'Balanced', blurb: 'Keeps the game looking good while cutting the waste. Best for most PCs.',
    video: { render: 12, sim: 8, graphics: 1, clouds: 'fast', particles: 1, shadows: true, mipmap: 2, blend: 2, ao: true, entityDist: 1 },
    jvm: 'g1', priority: 'above',
  },
  max: {
    name: 'Max FPS', blurb: 'Competitive setup: fast graphics, no clouds, smoothest frame times.',
    video: { render: 8, sim: 6, graphics: 0, clouds: 'off', particles: 1, shadows: false, mipmap: 0, blend: 0, ao: true, entityDist: 0.75 },
    jvm: 'auto', priority: 'high',
  },
};

function systemInfo() {
  const cpus = os.cpus();
  return {
    totalMB: Math.round(os.totalmem() / 1048576),
    freeMB: Math.round(os.freemem() / 1048576),
    cpu: (cpus[0]?.model || 'Unknown CPU').replace(/\s+/g, ' ').trim(),
    cores: cpus.length,
    platform: process.platform,
    arch: process.arch,
  };
}

/** A heap big enough for the mod count, without starving the OS. Too much heap makes GC pauses worse, not better. */
function recommendMemory({ loader, modCount = 0, totalMB = systemInfo().totalMB }) {
  let mb = loader === 'vanilla' ? 2048 : 3072;
  if (modCount > 40) mb = 4096;
  if (modCount > 120) mb = 6144;
  if (modCount > 250) mb = 8192;
  const cap = Math.max(1024, Math.floor((totalMB * 0.5) / 256) * 256);
  let pick = Math.min(mb, cap);
  if (process.arch === 'ia32') pick = Math.min(pick, 1024);
  return pick;
}

// The official launcher's default G1 setup
const VANILLA_GC = ['-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M'];

function gcFlags(kind, javaMajor, totalMB, heapMB) {
  if (kind === 'auto') kind = javaMajor >= 21 && totalMB >= 12288 && heapMB >= 4096 ? 'zgc' : 'g1';
  if (kind === 'zgc' && javaMajor >= 21) {
    const flags = ['-XX:+UseZGC'];
    // generational is the default from Java 23 on; passing the flag there only prints warnings
    if (javaMajor < 23) flags.push('-XX:+ZGenerational');
    return [...flags, '-XX:+DisableExplicitGC', '-XX:+PerfDisableSharedMem', '-XX:+UseStringDeduplication'];
  }
  if (kind === 'g1' || kind === 'zgc') {
    return [...VANILLA_GC, '-XX:+ParallelRefProcEnabled', '-XX:+DisableExplicitGC', '-XX:+PerfDisableSharedMem', '-XX:+UseStringDeduplication'];
  }
  return VANILLA_GC;
}

/** Memory and garbage collector flags for a launch. */
function launchJvmFlags({ instance, javaMajor, modCount, totalMB = systemInfo().totalMB }) {
  const max = instance.memory?.max || recommendMemory({ loader: instance.loader, modCount, totalMB });
  const min = instance.boost ? Math.max(512, Math.floor(max / 2)) : Math.min(512, max);
  const flags = [`-Xms${min}M`, `-Xmx${max}M`];
  const userPicksGc = /-XX:[+-]Use\w*GC\b/.test(instance.jvmArgs || '');
  if (!userPicksGc) flags.push(...gcFlags(instance.boost?.jvm || 'vanilla', javaMajor, totalMB, max));
  return flags;
}

function priorityFor(instance) {
  const p = instance.boost?.priority;
  if (p === 'high') return os.constants.priority.PRIORITY_HIGH;
  if (p === 'above') return os.constants.priority.PRIORITY_ABOVE_NORMAL;
  return null;
}

/** Raising priority needs admin rights on Linux/macOS; that is fine to lose. */
function applyPriority(pid, instance) {
  const prio = priorityFor(instance);
  if (prio == null) return false;
  try { os.setPriority(pid, prio); return true; } catch {
    try { os.setPriority(pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); return true; } catch { return false; }
  }
}

/** Tells Windows to run this Java on the dedicated GPU on laptops with two. */
function preferDedicatedGpu(javaBin) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    execFile('reg', ['add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', '/v', javaBin, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'],
      { windowsHide: true }, (err) => resolve(!err));
  });
}

// 1.19 turned "ao" into a boolean and quoted renderClouds
const MODERN_OPTIONS = Date.parse('2022-06-07T00:00:00Z');

function videoOptions(video, releaseTime) {
  const modern = Date.parse(releaseTime || 0) >= MODERN_OPTIONS;
  const clouds = { off: 'false', fast: 'fast', fancy: 'true' }[video.clouds] || 'fast';
  const opts = {
    renderDistance: video.render,
    simulationDistance: video.sim,
    graphicsMode: video.graphics,
    particles: video.particles,
    entityShadows: video.shadows,
    mipmapLevels: video.mipmap,
    biomeBlendRadius: video.blend,
    entityDistanceScaling: video.entityDist,
    maxFps: 260,
    enableVsync: false,
  };
  if (modern) {
    opts.renderClouds = `"${clouds}"`;
    opts.ao = video.ao;
  } else {
    opts.renderClouds = clouds;
    opts.ao = video.ao ? 2 : 0;
    opts.fancyGraphics = video.graphics > 0;
  }
  return opts;
}

/** Rewrites the keys we care about in options.txt, keeping everything else and backing up the original once. */
async function writeOptions(gameDir, values) {
  const file = path.join(gameDir, 'options.txt');
  const backup = `${file}.nimbus-backup`;
  let lines = [];
  if (await exists(file)) {
    const text = await fsp.readFile(file, 'utf8');
    if (!(await exists(backup))) await fsp.writeFile(backup, text);
    lines = text.split(/\r?\n/).filter((l) => l.length);
  }
  const left = { ...values };
  lines = lines.map((line) => {
    const i = line.indexOf(':');
    const key = i === -1 ? line : line.slice(0, i);
    if (key in left) {
      const v = left[key];
      delete left[key];
      return `${key}:${v}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(left)) lines.push(`${k}:${v}`);
  await fsp.mkdir(gameDir, { recursive: true });
  await fsp.writeFile(file, `${lines.join('\n')}\n`);
}

async function restoreOptions(gameDir) {
  const file = path.join(gameDir, 'options.txt');
  const backup = `${file}.nimbus-backup`;
  if (!(await exists(backup))) return false;
  await fsp.copyFile(backup, file);
  await fsp.rm(backup, { force: true });
  return true;
}

/**
 * Installs whichever performance mods fit the instance. Groups already covered —
 * by us, by a modpack, or by a jar the user dropped in — are left alone.
 */
async function installPerfMods(ctx, instances, instance, onItem = () => {}) {
  await modrinth.identifyContent(ctx, instances, instance.id).catch(() => {});
  const content = await instances.listContent(instance.id);
  const mods = content.filter((c) => c.type === 'mod');
  const haveIds = new Set(mods.map((m) => m.meta?.slug).filter(Boolean));
  const names = mods.map((m) => `${m.meta?.title || ''} ${m.file}`).join('\n');
  const hasOptifine = /optifine/i.test(names);

  const results = [];
  for (const group of PERF_MODS) {
    if (group.ids.some((id) => haveIds.has(id)) || group.match.test(names)) {
      results.push({ label: group.label, status: 'present' });
      onItem(results.at(-1));
      continue;
    }
    if (group.render && hasOptifine) {
      results.push({ label: group.label, status: 'skipped', detail: 'OptiFine is installed and clashes with Sodium' });
      onItem(results.at(-1));
      continue;
    }
    let done = null;
    for (const id of group.ids) {
      try {
        const version = await modrinth.compatibleVersion(id, 'mod', instance);
        if (!version) continue;
        const project = await modrinth.getProject(id);
        const state = await modrinth.installToInstance(ctx, instances, instance, { project, version });
        done = { label: group.label, status: 'installed', detail: state.installed.join(', ') };
        break;
      } catch (err) {
        done = { label: group.label, status: 'failed', detail: err.message };
      }
    }
    results.push(done || { label: group.label, status: 'unavailable', detail: `No build for ${instance.mcVersion}` });
    onItem(results.at(-1));
  }
  return results;
}

module.exports = {
  PERF_MODS, PRESETS, VANILLA_GC, systemInfo, recommendMemory, gcFlags, launchJvmFlags, applyPriority,
  preferDedicatedGpu, videoOptions, writeOptions, restoreOptions, installPerfMods,
};
