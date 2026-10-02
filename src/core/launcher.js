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
const { Builtin } = require('./builtin');
const packs = require('./packs');
const { CONTENT_DIRS } = require('./instances');
const skins = require('./skins');
const crashdoctor = require('./crashdoctor');
const importer = require('./importer');

const DEFAULT_SETTINGS = {
  concurrency: 16,
  onLaunch: 'hide', // hide | keep | close
  animations: true,
  splash: true,
  accent: 'violet',
  // appearance
  theme: 'midnight', // midnight | void | nebula | ocean | forest | ember
  customA1: '#7c5cff',
  customA2: '#c084fc',
  background: 'aurora', // aurora | stars | grid | solid | image
  bgImage: null,
  bgBlur: 8,
  bgDim: 45,
  glass: true,
  glassBlur: 16,
  cardStyle: 'glass', // glass | solid | outline
  radius: 'rounded', // sharp | rounded | round
  uiScale: 100,
  sidebarLabels: false,
  showCounter: true,
  showOtherCosmetics: true, // other Nimbus players' hats, pets, wings and auras in game
  replayClips: false, // record the game window so F8 can save the last seconds
  clipSeconds: 30,
  clipQuality: 'normal',
  clipAudio: true,
  discordStatus: true, // what you're playing, on your Discord profile
  discordServer: true, // include the server's name (never an IP address)
  shareOnline: true,
  countedInstall: false,
  // animations: launcher
  animSpeed: 'normal', // relaxed | normal | snappy
  pageTransition: 'rise', // rise | fade | slide | zoom | none
  stagger: true,
  hoverEffect: 'lift', // lift | tilt | glow | none
  bgMotion: true,
  // animations: launch splash
  splashParticles: true,
  splashStyle: 'spin', // spin | bounce | splash | pulse | flip | still | minimal
  // animations: in game (Nimbus Core)
  gameLoading: true,
  gameParticles: true,
  gameCube: true, // before 1.4.2: off meant a still logo
  gameStyle: 'spin', // how the logo moves while the game starts: spin | bounce | splash | pulse | flip | still
  reloadStyle: 'spin', // the same, while resource packs load in game
  gameAnimSpeed: 'normal', // relaxed | normal | snappy
  gameBadge: true,
  gameMenuMotion: true,
  msClientId: '',
  clientToken: null,
};

const LOG_KEEP = 3000;

/**
 * Everything the UI talks to. Long jobs run as tasks that report progress through
 * the 'task' event; the running game reports through 'game-log' and 'game-state'.
 */
class Launcher extends EventEmitter {
  constructor({ root, crypto: sealer, builtinDir = path.join(__dirname, '..', '..', 'resources', 'mods') }) {
    super();
    this.paths = createPaths(root);
    this.builtin = new Builtin(builtinDir);
    this.wardrobe = new skins.Wardrobe(path.join(root, 'skins'));
    this.instances = new Instances(this.paths);
    this.accounts = new AccountStore(this.paths.accounts, sealer);
    this.settings = null;
    this.tasks = new Map();
    this.running = new Map();
    this.logs = new Map();
    this.earlyDoctor = new Set(); // runs the crash doctor already looked at while the game was up
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

  /** Instances from other launchers on this computer, marking the ones already brought over. */
  async importScan(folder = null) {
    const found = folder ? await importer.scanFolder(folder) : await importer.scan();
    const have = new Set((await this.instances.list()).map((i) => i.importedFrom).filter(Boolean));
    return found.map((f) => ({ ...f, imported: have.has(f.path) }));
  }

  /** Brings instances over from other launchers: a Nimbus instance each, with their game folder copied in. */
  async importInstances(folders) {
    const made = [];
    for (const folder of folders) {
      const info = await importer.readInstance(folder);
      if (!info?.mcVersion) throw new Error(`Couldn't tell which Minecraft version ${path.basename(folder)} is.`);
      const inst = await this.task(`Importing ${info.name}`, async (ctx, stage) => {
        stage('Setting up');
        let loaderVersion = info.loaderVersion;
        if (info.loader !== 'vanilla' && !loaderVersion) loaderVersion = loaders.pickDefault(await loaders.listLoaderVersions(info.loader, info.mcVersion));
        const created = await this.instances.create({ name: info.name, mcVersion: info.mcVersion, loader: info.loader, loaderVersion, importedFrom: folder });
        stage('Copying mods, worlds and settings');
        await importer.copyGame(info.gameDir, this.paths.gameDir(created.id), (name) => stage(`Copying ${name}`));
        return created;
      });
      made.push(inst);
      // names and icons for the mods, and the game files, in the background
      modrinth.identifyContent({ paths: this.paths }, this.instances, inst.id).catch(() => {});
      this.installInstance(inst.id).catch(() => {});
    }
    return made;
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

    await this.builtin.ensure(paths, this.instances, instance);

    stage('Downloading game files');
    const version = await resolveVersion(paths, versionId);
    const install = await installVersion(ctx, version, { deep, skipAssets, label: `Minecraft ${instance.mcVersion}` });
    // packs added since last time are switched on, so they are simply there in game
    // (after the download: the game jar says which pack format this version takes)
    await packs.enableNewPacks({
      gameDir: paths.gameDir(instance.id),
      mcVersion: instance.mcVersion,
      stateFile: path.join(paths.instanceDir(instance.id), 'packs-seen.json'),
      clientJar: install.clientJar,
    }).catch(() => {});
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

  /**
   * @param {object} [opts]
   * @param {string} [opts.joinServer] join this address as soon as the game is up (Nimbus LAN)
   */
  async launch(id, { detach = false, joinServer = null } = {}) {
    const ban = this.banned?.();
    if (ban) {
      const err = new Error(`You're banned from Nimbus${ban.reason ? `: ${ban.reason}` : '.'}`);
      err.code = 'BANNED';
      throw err;
    }
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
      // Nimbus Core's in-game Skins & Capes menu shares the launcher's wardrobe
      extraJvm.push(`-Dnimbus.wardrobe=${this.wardrobe.dir}`);
      // one Nimbus Features setup for every instance, and the animation choices from Settings
      extraJvm.push(`-Dnimbus.features=${this.paths.features}`);
      extraJvm.push(`-Dnimbus.menu.image=${this.paths.menuImage}`);
      const st = this.settings;
      const anim = {
        loading: st.gameLoading !== false,
        particles: st.gameParticles !== false,
        style: st.gameStyle || (st.gameCube === false ? 'still' : 'spin'),
        reloadStyle: st.reloadStyle || st.gameStyle || 'spin',
        badge: st.gameBadge !== false,
        menus: st.gameMenuMotion !== false,
        speed: { relaxed: 0.6, normal: 1, snappy: 1.6 }[st.gameAnimSpeed] || 1,
      };
      for (const [k, v] of Object.entries(anim)) extraJvm.push(`-Dnimbus.anim.${k}=${v}`);
      // Nimbus LAN: Nimbus Core talks to the launcher through this local address
      if (this.bridgeUrl) extraJvm.push(`-Dnimbus.bridge=${this.bridgeUrl}`, `-Dnimbus.mc=${inst.mcVersion}`, `-Dnimbus.loader=${inst.loader}`);
      // cosmetics: yours from this file, everyone else's from the friends service
      extraJvm.push(`-Dnimbus.cosmetics=${this.paths.cosmetics}`);
      // Nimbus coins: the game counts what you do into one file and reads today's tasks from another
      extraJvm.push(`-Dnimbus.progress=${this.paths.progress}`, `-Dnimbus.tasks=${this.paths.tasks}`);
      // the game asks the service about the players around it (cosmetics, the Nimbus badge); a
      // launch in the first seconds after start may come before the address was looked up
      if (!this.apiBase && this.lookupApiBase) this.apiBase = await this.lookupApiBase().catch(() => null);
      if (this.apiBase) extraJvm.push(`-Dnimbus.api=${this.apiBase}`);
      // tests: extra JVM flags (e.g. authlib pointed at a stand-in Mojang)
      if (process.env.NIMBUS_EXTRA_JVM) extraJvm.push(...process.env.NIMBUS_EXTRA_JVM.split(' ').filter(Boolean));
      // tests swap Mojang and the gallery for local stand-ins
      for (const [env, prop] of [['NIMBUS_SERVICES_URL', 'services'], ['NIMBUS_MOJANG_URL', 'mojang'], ['NIMBUS_GALLERY_URL', 'gallery'], ['NIMBUS_TEXTURES_URL', 'textures']]) {
        if (process.env[env]) extraJvm.push(`-Dnimbus.${prop}=${process.env[env]}`);
      }
      const built = buildArguments({
        paths: this.paths, version: prep.version, install: prep.install, instance: joinServer ? { ...inst, server: joinServer } : inst, account,
        gameDir: prep.gameDir, gameAssets: prep.gameAssets, clientId: this.settings.clientToken, extraJvm,
      });
      if (inst.boost?.gpu) await boost.preferDedicatedGpu(prep.java.bin);

      this.logs.set(id, []);
      let pending = [];
      let timer = null;
      const parser = new LogParser();
      // mod loading failed: Fabric and Forge then show their own error window and wait, so the
      // crash doctor steps in as soon as the log says so instead of when the game closes
      const FATAL = /Incompatible mods found!|Mod resolution failed|Missing or unsupported mandatory dependencies|Mod loading has failed|Failed to create mod instance|Mixin apply for mod .* failed|MixinApplyError|Could not execute entrypoint stage/;
      let early = false;
      const flush = () => {
        timer = null;
        if (!pending.length) return;
        if (!early && pending.some((l) => FATAL.test(l))) {
          early = true;
          this.earlyDoctor.add(id);
          setTimeout(() => {
            this.examine(id, { code: null, since: started }).then((doctor) => {
              if (doctor) this.emit('doctor', { instanceId: id, doctor });
            }).catch(() => {});
          }, 1500);
        }
        this.log(id, pending);
        pending = [];
      };
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
      this.running.set(id, { child, started, instance: inst });
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
    let inst = null;
    try {
      inst = await this.instances.get(id);
      await this.instances.update(id, { playTime: (inst.playTime || 0) + seconds });
    } catch { /* deleted while running */ }
    // a crash: the crash doctor has a look before anyone is told
    let doctor = null;
    const already = this.earlyDoctor.delete(id);
    if (inst && code !== 0 && code !== null && !killed && !already) {
      doctor = await this.examine(id, { code, since: started, crashFile: crash }).catch(() => null);
    }
    this.emit('game-state', { instanceId: id, running: false, code, crash, seconds, killed, doctor });
  }

  /** The crash doctor's diagnosis for an instance (after a crash, or on demand from the console). */
  async examine(id, { code = null, since = 0, crashFile = null } = {}) {
    const inst = await this.instances.get(id);
    const gameDir = this.paths.gameDir(id);
    if (!crashFile && since === 0) {
      // on demand: the newest crash report, if there is one
      try {
        const dir = path.join(gameDir, 'crash-reports');
        const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.txt'));
        let best = null;
        for (const f of files) {
          const t = (await fsp.stat(path.join(dir, f))).mtimeMs;
          if (!best || t > best.t) best = { f, t };
        }
        if (best) crashFile = path.join(dir, best.f);
      } catch { /* none */ }
    }
    const result = await crashdoctor.examine({ gameDir, instance: inst, code, since, log: this.getLog(id), crashFile, totalMB: boost.systemInfo().totalMB });
    return result && { ...result, crashFile };
  }

  /** Does one of the crash doctor's fixes. */
  async applyFix(id, fix) {
    const inst = await this.instances.get(id);
    const gameDir = this.paths.gameDir(id);
    const safeRel = (rel, dir) => {
      const r = String(rel || '').replace(/\\/g, '/');
      if (!r.startsWith(`${dir}/`) || r.split('/').includes('..')) throw new Error('That file is not in this instance.');
      return r;
    };
    switch (fix?.kind) {
      case 'disable':
        await this.instances.setContentEnabled(id, safeRel(fix.rel, 'mods'), false);
        return { done: 'Turned off' };
      case 'install':
        return this.task(`Adding ${fix.label?.replace(/^Add /, '') || fix.project} to ${inst.name}`, (ctx) => modrinth.installProject(ctx, this.instances, inst, String(fix.project)), { instanceId: id });
      case 'update': {
        const rel = safeRel(fix.rel, 'mods');
        let meta = (await this.instances.contentManifest(id))[rel];
        if (!meta?.projectId) {
          await modrinth.identifyContent({ paths: this.paths }, this.instances, id).catch(() => {});
          meta = (await this.instances.contentManifest(id))[rel];
        }
        if (!meta?.projectId) throw new Error('Nimbus couldn\'t find that mod on Modrinth, so it can\'t update it. Turn it off instead.');
        // only ever forward: the newest release can be older than a beta that's installed
        const version = await modrinth.newerVersion(meta.projectId, 'mod', inst, meta.versionId);
        if (!version) throw new Error(`${meta.title} is already the newest build for ${inst.mcVersion}. Turn it off instead.`);
        return this.task(`Updating ${meta.title}`, (ctx) => modrinth.installProject(ctx, this.instances, inst, meta.projectId, version.id), { instanceId: id });
      }
      case 'memory': {
        const mb = Math.max(1024, Math.min(Number(fix.mb) || 4096, 65536));
        await this.instances.update(id, { memory: { ...(inst.memory || {}), max: mb } });
        return { done: `Memory set to ${Math.round(mb / 102.4) / 10} GB` };
      }
      case 'java':
        await this.instances.update(id, { javaPath: null });
        return { done: 'Using the Java Nimbus picks' };
      case 'repair':
        return this.installInstance(id, { deep: true });
      case 'reset-config': {
        const rel = safeRel(fix.rel, 'config');
        const abs = path.join(gameDir, ...rel.split('/'));
        await fsp.rename(abs, `${abs}.broken-${Date.now()}`);
        return { done: 'Reset' };
      }
      case 'shaders-off': {
        for (const name of ['iris.properties', 'oculus.properties']) {
          const f = path.join(gameDir, 'config', name);
          const text = await fsp.readFile(f, 'utf8').catch(() => null);
          if (text === null) continue;
          await fsp.writeFile(f, /^enableShaders=/m.test(text) ? text.replace(/^enableShaders=.*$/m, 'enableShaders=false') : `${text.trimEnd()}\nenableShaders=false\n`);
        }
        const of = path.join(gameDir, 'optionsshaders.txt');
        const oft = await fsp.readFile(of, 'utf8').catch(() => null);
        if (oft !== null) await fsp.writeFile(of, oft.replace(/^shaderPack=.*$/m, 'shaderPack=OFF'));
        return { done: 'Shaders off' };
      }
      default:
        throw new Error('Unknown fix.');
    }
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

  /** Copies files the player picked (or dropped) into the right folder for their kind. */
  async addContentFiles(instanceId, type, files) {
    const dir = CONTENT_DIRS[type];
    if (!dir) throw new Error('Pick Mods, Resource Packs or Shaders first.');
    const wanted = type === 'mod' ? /\.jar$/i : /\.zip$/i;
    const target = path.join(this.paths.gameDir(instanceId), dir);
    await fsp.mkdir(target, { recursive: true });
    const added = [];
    const skipped = [];
    for (const file of files || []) {
      const name = path.basename(String(file));
      let stat = null;
      try { stat = await fsp.stat(file); } catch { /* gone */ }
      // shader and resource packs may also be plain folders
      const folderPack = stat?.isDirectory() && type !== 'mod';
      if (!stat || (!folderPack && !wanted.test(name))) {
        skipped.push({ name, reason: type === 'mod' ? 'Mods are .jar files' : 'Packs are .zip files or folders' });
        continue;
      }
      const dest = path.join(target, name);
      if (folderPack) await fsp.cp(file, dest, { recursive: true, force: true });
      else await fsp.copyFile(file, dest);
      await this.instances.recordContent(instanceId, `${dir}/${name}`, {
        title: name.replace(/\.(jar|zip)$/i, ''), type, source: 'file', added: Date.now(),
      });
      added.push(name);
    }
    return { added, skipped };
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

  // ---- skins & capes -----------------------------------------------------

  /** What the active account wears right now, plus the capes it owns. */
  async skinState() {
    const session = await this.accounts.activeSession(this.oauth());
    const view = await skins.describe(await skins.getProfile(session.accessToken));
    await this.accounts.setSkin(session.uuid, view.skin?.url || null);
    // the first visit saves what you already wear, so switching away is never a one-way trip
    if (view.skin?.texture && (await this.wardrobe.list()).length === 0) {
      const entry = await this.wardrobe.add({ name: 'My original skin', variant: view.skin.variant, png: skins.fromDataUrl(view.skin.texture), source: 'account' }).catch(() => null);
      if (entry) await this.wardrobe.setWorn(session.uuid, entry.id, view.skin.url);
    }
    return { ...view, wornId: await this.wardrobe.wornId(session.uuid, view.skin?.url) };
  }

  async listWardrobe() { return this.wardrobe.list(); }

  /** Wears a wardrobe skin (by id) or a fresh image, with the chosen arm model. */
  async applySkin({ id, texture, variant, name }) {
    const session = await this.accounts.activeSession(this.oauth());
    let entry;
    if (id) {
      entry = await this.wardrobe.get(id);
      if (variant && variant !== entry.variant) await this.wardrobe.update(id, { variant });
    } else {
      const added = await this.wardrobe.add({ name: name || 'Uploaded skin', variant, png: skins.fromDataUrl(texture), source: 'file' });
      entry = await this.wardrobe.get(added.id);
    }
    const model = variant || entry.variant;
    const view = await skins.describe(await skins.uploadSkin(session.accessToken, entry.png, model));
    await this.accounts.setSkin(session.uuid, view.skin?.url || null);
    await this.wardrobe.setWorn(session.uuid, entry.id, view.skin?.url);
    return { ...view, wornId: entry.id };
  }

  async resetSkin() {
    const session = await this.accounts.activeSession(this.oauth());
    const view = await skins.describe(await skins.resetSkin(session.accessToken));
    await this.accounts.setSkin(session.uuid, view.skin?.url || null);
    await this.wardrobe.setWorn(session.uuid, null);
    return { ...view, wornId: null };
  }

  async setCape(capeId) {
    const session = await this.accounts.activeSession(this.oauth());
    const view = await skins.describe(await skins.showCape(session.accessToken, capeId || null));
    return { ...view, wornId: await this.wardrobe.wornId(session.uuid, view.skin?.url) };
  }

  async importSkin({ texture, name, variant, source }) {
    await this.wardrobe.add({ name, variant, png: skins.fromDataUrl(texture), source: source || 'file' });
    return this.wardrobe.list();
  }

  async updateSkin(id, patch) {
    await this.wardrobe.update(id, patch);
    return this.wardrobe.list();
  }

  async removeSkin(id) {
    await this.wardrobe.remove(id);
    return this.wardrobe.list();
  }

  lookupPlayerSkin(name) { return skins.lookupPlayer(name); }

  searchSkins({ query, after } = {}) { return skins.searchSkins(query, after); }

  skinTexture(url) { return skins.textureDataUrl(url); }

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
