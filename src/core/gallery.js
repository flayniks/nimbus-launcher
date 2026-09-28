'use strict';
// The gallery: every instance's screenshots in one list, and the replay clips Nimbus saved.
// Files are served to the launcher's page through the nimbus-media:// protocol (main.js), which
// only ever reads from these folders.
const fsp = require('fs').promises;
const path = require('path');

const IMAGE = /\.(png|jpe?g)$/i;
const VIDEO = /\.(mp4|webm)$/i;
const SAFE_NAME = /^[^/\\]+$/;

async function filesIn(dir, re) {
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!re.test(name)) continue;
    try {
      const st = await fsp.stat(path.join(dir, name));
      if (st.isFile()) out.push({ name, size: st.size, time: st.mtimeMs });
    } catch { /* gone meanwhile */ }
  }
  return out;
}

class Gallery {
  /**
   * @param {object} launcher the Launcher (paths, instances)
   * @param {string} clipsDir where replay clips are saved
   */
  constructor(launcher, clipsDir) {
    this.launcher = launcher;
    this.clipsDir = clipsDir;
  }

  shotsDir(instanceId) {
    return path.join(this.launcher.paths.gameDir(instanceId), 'screenshots');
  }

  /** Newest first, with where each one came from. */
  async screenshots() {
    const out = [];
    for (const inst of await this.launcher.instances.list()) {
      for (const f of await filesIn(this.shotsDir(inst.id), IMAGE)) {
        // Minecraft names them after when they were taken; copying them around changes the file time
        const m = f.name.match(/^(\d{4})-(\d\d)-(\d\d)_(\d\d)\.(\d\d)\.(\d\d)/);
        if (m) f.time = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
        out.push({ ...f, instanceId: inst.id, instance: inst.name, mc: inst.mcVersion, path: path.join(this.shotsDir(inst.id), f.name), url: `nimbus-media://media/shot/${encodeURIComponent(inst.id)}/${encodeURIComponent(f.name)}`, thumb: `nimbus-media://media/thumb/${encodeURIComponent(inst.id)}/${encodeURIComponent(f.name)}` });
      }
    }
    return out.sort((a, b) => b.time - a.time);
  }

  async clips() {
    const all = await filesIn(this.clipsDir, VIDEO);
    return all.map((f) => ({
      ...f,
      path: path.join(this.clipsDir, f.name),
      url: `nimbus-media://media/clip/${encodeURIComponent(f.name)}`,
      poster: `nimbus-media://media/poster/${encodeURIComponent(f.name)}`,
      ...parseClipName(f.name),
    })).sort((a, b) => b.time - a.time);
  }

  /**
   * The file behind a nimbus-media URL path ("shot/<instance>/<file>" and so on), or null for
   * anything else. Only names inside the gallery folders are accepted.
   */
  resolve(kind, parts) {
    const clean = parts.map((p) => decodeURIComponent(p));
    if (!clean.every((p) => SAFE_NAME.test(p) && p !== '..' && p !== '.')) return null;
    if ((kind === 'shot' || kind === 'thumb') && clean.length === 2 && IMAGE.test(clean[1])) return path.join(this.shotsDir(clean[0]), clean[1]);
    if (kind === 'clip' && clean.length === 1 && VIDEO.test(clean[0])) return path.join(this.clipsDir, clean[0]);
    if (kind === 'poster' && clean.length === 1 && VIDEO.test(clean[0])) return path.join(this.clipsDir, clean[0].replace(VIDEO, '.jpg'));
    return null;
  }

  /** Whether `file` is something the gallery shows (so it may be copied, revealed or deleted). */
  owns(file) {
    const abs = path.resolve(file);
    if (IMAGE.test(abs) && path.basename(path.dirname(abs)) === 'screenshots') {
      const inst = path.resolve(this.launcher.paths.instances);
      return abs.startsWith(inst + path.sep);
    }
    if (VIDEO.test(abs)) return path.dirname(abs) === path.resolve(this.clipsDir);
    return false;
  }

  /** A clip and its poster go together. */
  related(file) {
    return VIDEO.test(file) ? [file, file.replace(VIDEO, '.jpg')] : [file];
  }
}

/** "Nimbus clip 2026-09-28 18-04-11 (Survival).mp4" -> {label, instance}. */
function parseClipName(name) {
  const m = name.match(/^Nimbus clip (\d{4}-\d\d-\d\d) (\d\d)-(\d\d)-(\d\d)(?: \((.+)\))?\.\w+$/);
  if (!m) return { label: name.replace(VIDEO, ''), instance: null };
  return { label: `${m[1]} ${m[2]}:${m[3]}:${m[4]}`, instance: m[5] || null };
}

/** A file name for a new clip. */
function clipName(date, instanceName, ext = 'mp4') {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
  const inst = instanceName ? ` (${String(instanceName).replace(/[\\/:*?"<>|]/g, '').slice(0, 40)})` : '';
  return `Nimbus clip ${stamp}${inst}.${ext}`;
}

module.exports = { Gallery, parseClipName, clipName, IMAGE, VIDEO };
