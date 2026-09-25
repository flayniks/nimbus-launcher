'use strict';
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { createPaths } = require('./paths');
const { Downloader } = require('./http');
const { getManifest, getVersionJson, resolveVersion } = require('./versions');
const { resolveJava, findSystemJavas } = require('./java');
const { installVersion, prepareLegacyAssets } = require('./install');
const loaders = require('./loaders');
const { buildArguments, spawnGame } = require('./launch');
const { AccountStore } = require('./accounts');
const auth = require('./auth');
const { Instances } = require('./instances');
const modrinth = require('./modrinth');
const boost = require('./boost');
const { readJson, writeJson, exists } = require('./util');
const { LogParser } = require('./logparse');

const DEFAULT_SETTINGS = {
  concurrency: 16,
  onLaunch: 'hide', // hide | keep | close
  animations: true,
  accent: 'violet',
  msClientId: '',
  clientToken: null,
};

const LOG_KEEP = 3000;

/**
 * Everything the UI talks to. Long jobs run as tasks that report progress through
 * the 'task' event; the running game reports through 'game-log' and 'game-state'.
 */
class Launcher extends EventEmitter {
  constructor({ root, crypto: sealer }) {
    super();
    this.paths = createPaths(root);
    this.instances = new Instances(this.paths);
    this.accounts = new AccountStore(this.paths.accounts, sealer);
    this.settings = null;
    this.tasks = new Map();
    this.running = new Map();
    this.logs = new Map();
    this.busy = new Set();
    this.installs = new Map();
  }

  async init() {
    for (const dir of [this.paths.instances, this.paths.cache]) await fsp.mkdir(dir, { recursive: true });
    this.settings = { ...DEFAULT_SETTINGS, ...(await readJson(this.paths.settings, {})) };
    if (!this.settings.clientToken) {
      this.settings.clientToken = crypto.randomUUID();
      await writeJson(this.paths.settings, this.settings);
    }
    return this;
  }

  getSettings() { return { ...this.settings, dataDir: this.paths.root }; }

  async setSettings(patch) {
    const allowed = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'clientToken');
    for (const k of allowed) if (k in patch) this.settings[k] = patch[k];
    this.settings.concurrency = Math.max(2, Math.min(64, Number(this.settings.concurrency) || 16));
    await writeJson(this.paths.settings, this.settings);
    return this.getSettings();
  }

  oauth() { return auth.oauthConfig(this.settings.msClientId || null); }

  // ---- tasks -------------------------------------------------------------

  /** Runs `fn(ctx, stage)` as a tracked task with its own downloader so progress lands on the right bar. */
  async task(label, fn, { instanceId = null } = {}) {
    const id = crypto.randomUUID();
    const state = { id, label, instanceId, stage: 'Starting', state: 'running', done: 0, total: 0, bytes: 0, totalBytes: 0 };
    this.tasks.set(id, state);
    const emit = () => this.emit('task', { ...state });
    const downloader = new Downloader({ concurrency: this.settings.concurrency });
    downloader.on('progress', (p) => {
      Object.assign(state, { done: p.done, total: p.total, bytes: p.bytes, totalBytes: p.totalBytes, checking: p.checking });
      if (p.label) state.stage = p.checking ? `Checking ${p.label}` : `Downloading ${p.label}`;
      emit();
    });
    const stage = (text) => {
      Object.assign(state, { stage: text, done: 0, total: 0, bytes: 0, totalBytes: 0 });
      emit();
    };
    emit();
    try {
      const result = await fn({ paths: this.paths, downloader }, stage);
      state.state = 'done';
      state.stage = 'Done';
      emit();
      return result;
    } catch (err) {
      state.state = 'error';
      state.error = err.message;
      emit();
      throw err;
    } finally {
      setTimeout(() => this.tasks.delete(id), 30000);
    }
  }

  listTasks() { return [...this.tasks.values()]; }

  // ---- versions & loaders ----------------------------------------------

  async listVersions() {
    const manifest = await getManifest(this.paths);
    return {
      latest: manifest.latest,
      versions: manifest.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })),
    };
  }

  async loaderGameVersions(kind) {
    const set = await loaders.supportedGameVersions(kind);
    return set ? [...set] : null;
  }

  loaderVersions(kind, mc) { return loaders.listLoaderVersions(kind, mc); }

  // ---- instances ---------------------------------------------------------

  async listInstances() {
    const list = await this.instances.list();
    return list.map((i) => ({ ...i, running: this.running.has(i.id) }));
  }

  async createInstance(fields) {
    if (!fields.mcVersion) throw new Error('Pick a Minecraft version');
    const loader = fields.loader || 'vanilla';
    let loaderVersion = fields.loaderVersion || null;
    if (loader !== 'vanilla' && !loaderVersion) {
      loaderVersion = loaders.pickDefault(await loaders.listLoaderVersions(loader, fields.mcVersion));
      if (!loaderVersion) throw new Error(`${loaders.LOADERS[loader].name} has no build for ${fields.mcVersion}`);
    }
    const inst = await this.instances.create({
      name: (fields.name || '').trim() || `${loader === 'vanilla' ? 'Minecraft' : loaders.LOADERS[loader].name} ${fields.mcVersion}`,
      mcVersion: fields.mcVersion,
      loader,
      loaderVersion,
      icon: fields.icon || null,
    });
    // get the downloads out of the way now so the first Play is instant
    this.installInstance(inst.id).catch(() => {});
    return inst;
  }

  async installInstance(id, { deep = false } = {}) {
    const inst = await this.instances.get(id);
    if (this.busy.has(id)) throw new Error(`${inst.name} is already being set up`);
    this.busy.add(id);
    const job = this.task(`${deep ? 'Repairing' : 'Installing'} ${inst.name}`, (ctx, stage) => this.prepare(ctx, inst, { deep, stage }), { instanceId: id });
    this.installs.set(id, job);
    try {
      return await job;
    } finally {
      this.installs.delete(id);
      this.busy.delete(id);
    }
  }

  /** Makes an instance ready to launch: Java, loader, libraries, assets. */
  async prepare(ctx, instance, { deep = false, skipAssets = false, stage = () => {} } = {}) {
    const { paths } = this;
    stage(`Fetching Minecraft ${instance.mcVersion}`);
    const vanilla = await getVersionJson(paths, instance.mcVersion);

    stage('Preparing Java');
    const java = await resolveJava(paths, vanilla, ctx.downloader, { customPath: instance.javaPath, deep });

    let versionId = instance.mcVersion;
    if (instance.loader !== 'vanilla') {
      versionId = instance.versionId;
      let loaderVersion = instance.loaderVersion;
      if (!loaderVersion) loaderVersion = loaders.pickDefault(await loaders.listLoaderVersions(instance.loader, instance.mcVersion));
      const missing = !versionId || !(await exists(paths.versionJson(versionId)));
      if (missing || deep) {
        const name = loaders.LOADERS[instance.loader].name;
        stage(`Installing ${name} ${loaderVersion}`);
        if (instance.loader === 'fabric' || instance.loader === 'quilt') {
          versionId = await loaders.fabric.install(paths, instance.loader, instance.mcVersion, loaderVersion);
        } else {
          const base = await resolveVersion(paths, instance.mcVersion);
          await installVersion(ctx, base, { skipAssets: true, label: `Minecraft ${instance.mcVersion}` });
          versionId = await loaders.forge.install(ctx, instance.loader, instance.mcVersion, loaderVersion, { java: java.console, onStatus: stage });
        }
        instance = await this.instances.update(instance.id, { versionId, loaderVersion });
      }
    }

    stage('Downloading game files');
    const version = await resolveVersion(paths, versionId);
    const install = await installVersion(ctx, version, { deep, skipAssets, label: `Minecraft ${instance.mcVersion}` });
    const gameDir = paths.gameDir(instance.id);
    await fsp.mkdir(gameDir, { recursive: true });
    stage('Preparing assets');
    const gameAssets = await prepareLegacyAssets(paths, version, gameDir);
    return { instance, version, java, install, gameDir, gameAssets };
  }

  // ---- playing -----------------------------------------------------------

  log(id, lines) {
    const buf = this.logs.get(id) || [];
    buf.push(...lines);
    if (buf.length > LOG_KEEP) buf.splice(0, buf.length - LOG_KEEP);
    this.logs.set(id, buf);
    this.emit('game-log', { instanceId: id, lines });
  }

  getLog(id) { return this.logs.get(id) || []; }

  async launch(id, { detach = false } = {}) {
    if (this.running.has(id)) throw new Error('That instance is already running');
    const account = await this.accounts.activeSession(this.oauth());
    // Play pressed while the first install is still going: let it finish, then launch
    if (this.installs.has(id)) await this.installs.get(id).catch(() => {});
    if (this.busy.has(id)) throw new Error('That instance is busy — try again in a moment');
    let inst = await this.instances.get(id);
    this.busy.add(id);
    try {
      const prep = await this.task(`Launching ${inst.name}`, (ctx, stage) => this.prepare(ctx, inst, { stage }), { instanceId: id });
      inst = prep.instance;
      const modCount = await this.instances.modCount(id);
      const extraJvm = boost.launchJvmFlags({ instance: inst, javaMajor: prep.java.major, modCount });
      const built = buildArguments({
        paths: this.paths, version: prep.version, install: prep.install, instance: inst, account,
        gameDir: prep.gameDir, gameAssets: prep.gameAssets, clientId: this.settings.clientToken, extraJvm,
      });
      if (inst.boost?.gpu) await boost.preferDedicatedGpu(prep.java.bin);

      this.logs.set(id, []);
      let pending = [];
      let timer = null;
      const parser = new LogParser();
      const flush = () => { timer = null; if (pending.length) { this.log(id, pending); pending = []; } };
      const started = Date.now();
      const { child, commandLine } = await spawnGame({
        java: prep.java, gameDir: prep.gameDir, built, account, detach,
        onLine: (line) => {
          const done = parser.push(line);
          if (!done.length) return;
          pending.push(...done);
          if (!timer) timer = setTimeout(flush, 120);
        },
        onExit: (code) => {
          flush();
          const killed = Boolean(this.running.get(id)?.killed);
          this.finish(id, started, code, killed).catch(() => {});
        },
      });
      this.log(id, [`[Nimbus] Java ${prep.java.major}: ${prep.java.bin}`, `[Nimbus] ${commandLine.slice(1).filter((a) => a.startsWith('-X')).join(' ')}`]);
      boost.applyPriority(child.pid, inst);
      await this.instances.update(id, { lastPlayed: Date.now() });
      if (detach) return { detached: true };
      this.running.set(id, { child, started });
      this.emit('game-state', { instanceId: id, running: true });
      return { pid: child.pid };
    } finally {
      this.busy.delete(id);
    }
  }

  async finish(id, started, code, killed = false) {
    this.running.delete(id);
    const seconds = Math.round((Date.now() - started) / 1000);
    let crash = null;
    if (code !== 0 && code !== null && !killed) {
      const dir = path.join(this.paths.gameDir(id), 'crash-reports');
      try {
        const files = await fsp.readdir(dir);
        const recent = [];
        for (const f of files) {
          const stat = await fsp.stat(path.join(dir, f));
          if (stat.mtimeMs >= started) recent.push({ f, t: stat.mtimeMs });
        }
        recent.sort((a, b) => b.t - a.t);
        if (recent[0]) crash = path.join(dir, recent[0].f);
      } catch { /* no crash report folder */ }
    }
    try {
      const inst = await this.instances.get(id);
      await this.instances.update(id, { playTime: (inst.playTime || 0) + seconds });
    } catch { /* deleted while running */ }
    this.emit('game-state', { instanceId: id, running: false, code, crash, seconds, killed });
  }

  kill(id) {
    const run = this.running.get(id);
    if (!run) return false;
    run.killed = true;
    run.child.kill();
    return true;
  }

  // ---- content -----------------------------------------------------------

  async installContent(instanceId, projectId, versionId) {
    const inst = await this.instances.get(instanceId);
    return this.task(`Adding to ${inst.name}`, (ctx, stage) => {
      stage('Resolving dependencies');
      return modrinth.installProject(ctx, this.instances, inst, projectId, versionId);
    }, { instanceId });
  }

  async installModpack({ versionId, file, project }) {
    return this.task(`Installing ${project?.title || 'modpack'}`, async (ctx, stage) => {
      const inst = await modrinth.installModpack(ctx, this.instances, { versionId, file, project, onStatus: stage });
      return inst;
    }).then((inst) => {
      this.installInstance(inst.id).catch(() => {});
      return inst;
    });
  }

  async updateContent(instanceId, items) {
    const inst = await this.instances.get(instanceId);
    return this.task(`Updating ${items.length} item(s) in ${inst.name}`, async (ctx, stage) => {
      const done = [];
      for (const item of items) {
        stage(`Updating ${item.title}`);
        await modrinth.installProject(ctx, this.instances, inst, item.projectId, item.versionId);
        done.push(item.title);
      }
      return done;
    }, { instanceId });
  }

  // ---- boost -------------------------------------------------------------

  async boostInfo(instanceId) {
    const inst = instanceId ? await this.instances.get(instanceId) : null;
    const sys = boost.systemInfo();
    const modCount = inst ? await this.instances.modCount(inst.id) : 0;
    return {
      system: sys,
      presets: boost.PRESETS,
      perfMods: boost.PERF_MODS.map((g) => ({ label: g.label, ids: g.ids })),
      recommendedMemory: inst ? boost.recommendMemory({ loader: inst.loader, modCount, totalMB: sys.totalMB }) : null,
      modCount,
      instance: inst,
    };
  }

  /**
   * Applies an FPS boost preset. `opts` switches the individual parts on or off:
   * mods, jvm, memory, video, priority, gpu.
   */
  async applyBoost(instanceId, presetId, opts) {
    const preset = boost.PRESETS[presetId];
    if (!preset) throw new Error('Unknown preset');
    let inst = await this.instances.get(instanceId);
    return this.task(`Boosting ${inst.name}`, async (ctx, stage) => {
      const steps = [];
      const step = (s) => { steps.push(s); this.emit('boost-step', { instanceId, ...s }); };

      if (opts.mods) {
        if (inst.loader === 'vanilla') {
          step({ id: 'mods', label: 'Performance mods', status: 'skipped', detail: 'Vanilla cannot load mods — a Fabric copy of this instance gets the biggest boost.' });
        } else {
          stage('Adding performance mods');
          const results = await boost.installPerfMods(ctx, this.instances, inst, (r) => this.emit('boost-step', { instanceId, id: 'mod', ...r }));
          const added = results.filter((r) => r.status === 'installed').length;
          step({ id: 'mods', label: 'Performance mods', status: 'done', detail: `${added} added, ${results.filter((r) => r.status === 'present').length} already there`, results });
        }
      }

      const vanilla = await getVersionJson(this.paths, inst.mcVersion);
      const patch = {
        boost: {
          preset: presetId,
          jvm: opts.jvm ? preset.jvm : 'vanilla',
          priority: opts.priority ? preset.priority : 'normal',
          gpu: Boolean(opts.gpu && process.platform === 'win32'),
          mods: Boolean(opts.mods && inst.loader !== 'vanilla'),
          memory: Boolean(opts.memory),
          video: Boolean(opts.video),
          applied: Date.now(),
        },
      };
      step({ id: 'jvm', label: 'Garbage collector', status: opts.jvm ? 'done' : 'skipped', detail: opts.jvm ? (preset.jvm === 'auto' ? 'ZGC on Java 21+ with plenty of RAM, tuned G1 otherwise' : 'Tuned G1 collector') : 'Left on the default' });

      if (opts.memory) {
        const modCount = await this.instances.modCount(inst.id);
        const max = boost.recommendMemory({ loader: inst.loader, modCount });
        patch.memory = { max };
        step({ id: 'memory', label: 'Memory', status: 'done', detail: `${(max / 1024).toFixed(max % 1024 ? 1 : 0)} GB for ${modCount} mod${modCount === 1 ? '' : 's'}` });
      }

      if (opts.video) {
        stage('Tuning video settings');
        await boost.writeOptions(this.paths.gameDir(inst.id), boost.videoOptions(preset.video, vanilla.releaseTime));
        step({ id: 'video', label: 'Video settings', status: 'done', detail: `Render distance ${preset.video.render}, VSync off, uncapped FPS` });
      }

      step({ id: 'priority', label: 'Process priority', status: opts.priority ? 'done' : 'skipped', detail: opts.priority ? (preset.priority === 'high' ? 'High' : 'Above normal') : 'Normal' });
      if (process.platform === 'win32') step({ id: 'gpu', label: 'Dedicated GPU', status: opts.gpu ? 'done' : 'skipped', detail: opts.gpu ? 'Java will run on the dedicated GPU' : 'Windows decides' });

      inst = await this.instances.update(inst.id, patch);
      return { steps, instance: inst };
    }, { instanceId });
  }

  async revertBoost(instanceId) {
    const restored = await boost.restoreOptions(this.paths.gameDir(instanceId));
    const inst = await this.instances.update(instanceId, { boost: null, memory: null });
    return { instance: inst, restoredOptions: restored };
  }

  // ---- misc --------------------------------------------------------------

  async detectJava() { return findSystemJavas(this.paths); }

  async cacheSize() {
    let total = 0;
    const walk = async (dir) => {
      let entries = [];
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else { try { total += (await fsp.stat(p)).size; } catch { /* gone */ } }
      }
    };
    await walk(this.paths.cache);
    return total;
  }

  async clearCache() {
    await fsp.rm(this.paths.cache, { recursive: true, force: true });
    await fsp.mkdir(this.paths.cache, { recursive: true });
  }
}

module.exports = { Launcher, DEFAULT_SETTINGS };
