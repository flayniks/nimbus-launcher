'use strict';
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson, exists, slugify, pool } = require('./util');

const CONTENT_DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };

function defaults(fields) {
  return {
    id: null,
    name: 'New instance',
    mcVersion: null,
    loader: 'vanilla',
    loaderVersion: null,
    versionId: null,
    icon: null,
    created: Date.now(),
    lastPlayed: null,
    playTime: 0,
    memory: null,
    javaPath: null,
    jvmArgs: '',
    resolution: null,
    fullscreen: false,
    server: '',
    boost: null,
    modpack: null,
    ...fields,
  };
}

class Instances {
  constructor(paths) {
    this.paths = paths;
  }

  file(id) { return path.join(this.paths.instanceDir(id), 'instance.json'); }

  async list() {
    let dirs = [];
    try { dirs = await fsp.readdir(this.paths.instances); } catch { return []; }
    const all = await Promise.all(dirs.map((d) => readJson(this.file(d), null)));
    return all.filter(Boolean).sort((a, b) => (b.lastPlayed || b.created) - (a.lastPlayed || a.created));
  }

  async get(id) {
    const inst = await readJson(this.file(id), null);
    if (!inst) throw new Error('That instance no longer exists');
    return inst;
  }

  async create(fields) {
    const base = slugify(fields.name || `${fields.loader}-${fields.mcVersion}`);
    let id = base;
    while (await exists(this.paths.instanceDir(id))) id = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    const inst = defaults({ ...fields, id, created: Date.now() });
    const game = this.paths.gameDir(id);
    for (const dir of ['mods', 'resourcepacks', 'shaderpacks', 'saves']) await fsp.mkdir(path.join(game, dir), { recursive: true });
    await writeJson(this.file(id), inst);
    return inst;
  }

  async update(id, patch) {
    const inst = { ...(await this.get(id)), ...patch, id };
    await writeJson(this.file(id), inst);
    return inst;
  }

  async remove(id) {
    const dir = this.paths.instanceDir(id);
    if (!dir.startsWith(this.paths.instances + path.sep)) throw new Error('Refusing to delete outside the instances folder');
    await fsp.rm(dir, { recursive: true, force: true });
  }

  async duplicate(id) {
    const src = await this.get(id);
    const copy = await this.create({ ...src, name: `${src.name} (copy)`, lastPlayed: null, playTime: 0 });
    await fsp.cp(this.paths.gameDir(id), this.paths.gameDir(copy.id), { recursive: true, force: true });
    const manifest = await readJson(this.contentFile(id), null);
    if (manifest) await writeJson(this.contentFile(copy.id), manifest);
    return copy;
  }

  // ---- installed content -------------------------------------------------

  contentFile(id) { return path.join(this.paths.instanceDir(id), 'content.json'); }

  async contentManifest(id) { return readJson(this.contentFile(id), {}); }

  async recordContent(id, rel, meta) {
    const manifest = await this.contentManifest(id);
    manifest[rel] = meta;
    await writeJson(this.contentFile(id), manifest);
  }

  /** Mods, resource packs and shader packs on disk, joined with what we know about where they came from. */
  async listContent(id) {
    const game = this.paths.gameDir(id);
    const manifest = await this.contentManifest(id);
    const out = [];
    for (const [type, dir] of Object.entries(CONTENT_DIRS)) {
      let files = [];
      try { files = await fsp.readdir(path.join(game, dir), { withFileTypes: true }); } catch { continue; }
      for (const f of files) {
        const name = f.name;
        const enabled = !name.endsWith('.disabled');
        const clean = enabled ? name : name.slice(0, -'.disabled'.length);
        const isPack = /\.(jar|zip)$/i.test(clean) || f.isDirectory();
        if (!isPack) continue;
        if (type === 'mod' && !/\.jar$/i.test(clean)) continue;
        const rel = `${dir}/${clean}`;
        const meta = manifest[rel] || null;
        let size = 0;
        try { size = (await fsp.stat(path.join(game, dir, name))).size; } catch { /* gone */ }
        out.push({ type, file: clean, rel, enabled, size, isDir: f.isDirectory(), ...(meta ? { meta } : {}) });
      }
    }
    return out.sort((a, b) => (a.meta?.title || a.file).localeCompare(b.meta?.title || b.file));
  }

  async setContentEnabled(id, rel, enabled) {
    const abs = path.join(this.paths.gameDir(id), ...rel.split('/'));
    const from = enabled ? `${abs}.disabled` : abs;
    const to = enabled ? abs : `${abs}.disabled`;
    if (await exists(from)) await fsp.rename(from, to);
  }

  async removeContent(id, rel) {
    const game = this.paths.gameDir(id);
    const abs = path.join(game, ...rel.split('/'));
    if (!abs.startsWith(game + path.sep)) throw new Error('Bad path');
    await fsp.rm(abs, { recursive: true, force: true });
    await fsp.rm(`${abs}.disabled`, { recursive: true, force: true });
    const manifest = await this.contentManifest(id);
    delete manifest[rel];
    await writeJson(this.contentFile(id), manifest);
  }

  async modCount(id) {
    try {
      const files = await fsp.readdir(path.join(this.paths.gameDir(id), 'mods'));
      return files.filter((f) => f.endsWith('.jar')).length;
    } catch { return 0; }
  }

  async sizeOf(id) {
    let total = 0;
    const walk = async (dir) => {
      let entries = [];
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      await pool(entries, 16, async (e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else { try { total += (await fsp.stat(p)).size; } catch { /* skip */ } }
      });
    };
    await walk(this.paths.instanceDir(id));
    return total;
  }
}

module.exports = { Instances, CONTENT_DIRS };
