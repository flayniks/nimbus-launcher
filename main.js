'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Menu, nativeImage } = require('electron');
const path = require('path');
const { Launcher } = require('./src/core/launcher');
const auth = require('./src/core/auth');
const modrinth = require('./src/core/modrinth');

const DEV = process.argv.includes('--dev');
const UPDATE_EVERY = 4 * 60 * 60 * 1000;
let win = null;
let launcher = null;
let updater = null;
let presence = null;
let friends = null;
let lan = null;
let discord = null;
const { Presence } = require('./src/core/presence');
const { readJson, writeJson } = require('./src/core/util');
const { Friends } = require('./src/core/friends');
const { Lan } = require('./src/core/lan');
const { DiscordStatus } = require('./src/core/discord');
const { services } = require('./src/core/services');

// a separate data folder (tests, or a second profile) is a separate launcher with its own lock
if (process.env.NIMBUS_DATA_DIR) app.setPath('userData', path.join(process.env.NIMBUS_DATA_DIR, '.electron'));
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

/** Seals tokens with the OS keychain. Falls back to plain base64 only where no keychain exists at all. */
const sealer = {
  encrypt(text) {
    if (safeStorage.isEncryptionAvailable()) return `k:${safeStorage.encryptString(text).toString('base64')}`;
    return `p:${Buffer.from(text).toString('base64')}`;
  },
  decrypt(blob) {
    if (blob.startsWith('k:')) return safeStorage.decryptString(Buffer.from(blob.slice(2), 'base64'));
    if (blob.startsWith('p:')) return Buffer.from(blob.slice(2), 'base64').toString();
    throw new Error('Unknown token format');
  },
};

function createWindow() {
  const mac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1220,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: mac,
    titleBarStyle: mac ? 'hiddenInset' : undefined,
    backgroundColor: '#0b0d14',
    title: 'Nimbus Launcher',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });
  if (!mac && !DEV) Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
  win.on('closed', () => {
    win = null;
    // the hidden Nimbus LAN window would otherwise keep the app alive
    if (netWin && !netWin.isDestroyed() && !(launcher && launcher.running.size > 0)) netWin.destroy();
  });
}

const LOADER_NAMES = { vanilla: 'Minecraft', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

/**
 * The animated window shown from Play until the game's own window is up. It follows the
 * install/launch task first, then the game log, and bows out when the game opens its window.
 */
class LaunchSplash {
  constructor(inst, settings = {}) {
    this.closed = false;
    const kind = `${LOADER_NAMES[inst.loader] || 'Minecraft'} ${inst.mcVersion}`;
    this.inst = inst;
    this.pending = {
      instance: inst.name.includes(inst.mcVersion) ? inst.name : `${inst.name} · ${kind}`,
      stage: 'Getting ready',
      progress: null,
      accent: settings.accent,
      look: {
        a1: settings.accent === 'custom' ? settings.customA1 : null,
        a2: settings.accent === 'custom' ? settings.customA2 : null,
        particles: settings.splashParticles !== false,
        style: settings.splashStyle === 'cube' ? 'spin' : settings.splashStyle || 'spin',
        still: settings.animations === false,
      },
    };
    this.win = new BrowserWindow({
      width: 440,
      height: 400,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'splash-preload.js'), contextIsolation: true, sandbox: true },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.loadFile(path.join(__dirname, 'src', 'renderer', 'splash.html'));
    this.win.once('ready-to-show', () => {
      if (this.closed) return;
      this.win.showInactive();
      this.update(this.pending);
    });
    this.win.on('closed', () => { this.closed = true; this.cleanup?.(); });
    this.dismiss = (e) => { if (e.sender === this.win.webContents) this.close(); };
    ipcMain.on('splash:dismiss', this.dismiss);
  }

  update(data) {
    Object.assign(this.pending, data);
    if (!this.closed && !this.win.webContents.isLoading()) this.win.webContents.send('splash:update', data);
  }

  /** After spawn: read the log until the game window exists, then leave. */
  follow(instanceId, detached) {
    this.update({ stage: 'Starting Minecraft', progress: null });
    if (detached) { setTimeout(() => this.close(), 8000); return; }
    const onLog = (e) => {
      if (e.instanceId !== instanceId) return;
      for (const line of e.lines) {
        if (/Loading Minecraft .* with (Fabric|Quilt)/.test(line)) this.update({ stage: 'Loading mods' });
        else if (/ModLauncher|Forge Mod Loader|FML|NeoForge/.test(line)) this.update({ stage: 'Loading Forge' });
        // the game (or Forge's early loading window) is opening its window; give it a moment to draw
        if (/Backend library|LWJGL Version|ImmediateWindowProvider|Created: .*atlas/i.test(line)) {
          if (this.leaveTimer) return;
          this.update({ stage: 'Opening the game', progress: 1 });
          this.leaveTimer = setTimeout(() => this.close(), 2500);
          return;
        }
      }
    };
    const onState = (e) => { if (e.instanceId === instanceId && !e.running) this.close(); };
    launcher.on('game-log', onLog);
    launcher.on('game-state', onState);
    // alpha, beta and other pre-1.6 versions log almost nothing, their window shows up quickly
    const ancient = /^(rd-|c0\.|in-|inf-|a1\.|b1\.|1\.[0-5](\.|$))/.test(this.inst.mcVersion);
    const timer = setTimeout(() => this.close(), ancient ? 5000 : 90000);
    this.cleanup = () => {
      launcher.off('game-log', onLog);
      launcher.off('game-state', onState);
      clearTimeout(timer);
      clearTimeout(this.leaveTimer);
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.cleanup?.();
    ipcMain.off('splash:dismiss', this.dismiss);
    if (this.win.isDestroyed()) return;
    this.win.webContents.send('splash:update', { leaving: true });
    setTimeout(() => { if (!this.win.isDestroyed()) this.win.destroy(); }, 340);
  }
}

/**
 * Self-updates from the rolling "nimbus-latest" GitHub release (see the workflow). Every
 * start checks straight away (and again every few hours); a new version downloads in the
 * background, then the window restarts into it (see installUpdate in the renderer) or it
 * installs when the launcher quits.
 */
const updates = { state: 'idle', version: null, percent: 0, message: null };

function setUpdate(patch) {
  Object.assign(updates, patch);
  send('update:state', { ...updates, current: app.getVersion() });
}

function setupUpdater() {
  if (!app.isPackaged || process.env.NIMBUS_NO_UPDATES) {
    setUpdate({ state: 'disabled', message: 'Updates are only checked in the installed app.' });
    return null;
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking', message: null }));
  autoUpdater.on('update-available', (info) => setUpdate({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'current', version: null }));
  autoUpdater.on('download-progress', (p) => setUpdate({ state: 'downloading', percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => setUpdate({ state: 'ready', version: info.version, percent: 100 }));
  autoUpdater.on('error', (err) => setUpdate({ state: 'error', message: String(err?.message || err).split('\n')[0] }));
  setInterval(() => checkForUpdates(), UPDATE_EVERY);
  return autoUpdater;
}

let lastUpdateCheck = 0;

/** Checks the feed unless a check or download is already under way (or one ran within `minGap`). */
function checkForUpdates(minGap = 0) {
  if (!updater || ['checking', 'downloading', 'ready'].includes(updates.state)) return;
  if (Date.now() - lastUpdateCheck < minGap) return;
  lastUpdateCheck = Date.now();
  updater.checkForUpdates().catch(() => {});
}

/** The hidden window that holds Nimbus LAN's WebRTC connections, made the first time it's needed. */
let netWin = null;
let netQueue = [];
function netWindow() {
  if (!netWin || netWin.isDestroyed()) {
    netQueue = [];
    netWin = new BrowserWindow({
      show: false, width: 200, height: 200,
      webPreferences: { preload: path.join(__dirname, 'net-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    netWin.loadFile(path.join(__dirname, 'src', 'renderer', 'net.html'));
    netWin.webContents.once('did-finish-load', () => {
      const q = netQueue;
      netQueue = null;
      for (const m of q) netWin.webContents.send('net:cmd', m);
    });
    netWin.on('closed', () => { netWin = null; });
  }
  return {
    send(msg) {
      if (netQueue) netQueue.push(msg);
      else netWin.webContents.send('net:cmd', msg);
    },
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Every IPC call returns {ok, data} or {ok:false, error} so the renderer gets clean messages. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      if (DEV) console.error(`[ipc ${channel}]`, err);
      return { ok: false, error: err.message || String(err), code: err.code };
    }
  });
}

function microsoftLogin() {
  const cfg = launcher.oauth();
  return new Promise((resolve, reject) => {
    const popup = new BrowserWindow({
      width: 520,
      height: 680,
      parent: win,
      modal: true,
      title: 'Sign in with Microsoft',
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      // a throwaway session every time so "use another account" always works
      webPreferences: { partition: `msauth-${Date.now()}`, sandbox: true, contextIsolation: true },
    });
    let settled = false;
    const finish = (target) => {
      if (settled || !target.startsWith(cfg.redirect)) return false;
      settled = true;
      const url = new URL(target);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      setImmediate(() => { if (!popup.isDestroyed()) popup.close(); });
      if (code) resolve(code);
      else reject(new Error(error === 'access_denied' ? 'Sign-in was cancelled.' : `Microsoft sign-in failed: ${url.searchParams.get('error_description') || error}`));
      return true;
    };
    // newer Electron puts the URL on the event, older versions pass it as the second argument
    popup.webContents.on('will-redirect', (e, target) => { if (finish(e.url || target || '')) e.preventDefault(); });
    popup.webContents.on('will-navigate', (e, target) => { if (finish(e.url || target || '')) e.preventDefault(); });
    popup.webContents.on('did-navigate', (_e, target) => finish(target));
    popup.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    popup.on('closed', () => {
      if (!settled) {
        const err = new Error('Sign-in window was closed.');
        err.code = 'CANCELLED';
        reject(err);
      }
    });
    popup.loadURL(auth.authorizeUrl(cfg));
  }).then(async (code) => launcher.accounts.add(await auth.loginWithCode(cfg, code)));
}

async function gpuInfo() {
  try {
    const info = await app.getGPUInfo('complete');
    const renderer = info.auxAttributes?.glRenderer || '';
    const device = (info.gpuDevice || []).find((d) => d.active) || info.gpuDevice?.[0];
    const vendors = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel', 0x106b: 'Apple', 0x5143: 'Qualcomm' };
    const vendor = device ? vendors[device.vendorId] || 'Unknown' : 'Unknown';
    const name = renderer.replace(/^ANGLE \((.*)\)$/, '$1').split(',').slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
    return { vendor, name: name || `${vendor} GPU`, count: (info.gpuDevice || []).length };
  } catch {
    return { vendor: 'Unknown', name: 'Unknown GPU', count: 0 };
  }
}

function registerIpc() {
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataDir: launcher.paths.root }));
  handle('win:minimize', () => win?.minimize());
  handle('win:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  handle('win:close', () => win?.close());
  handle('shell:external', (url) => {
    if (!/^https:\/\//.test(url)) throw new Error('Only https links can be opened');
    return shell.openExternal(url);
  });

  handle('settings:get', () => launcher.getSettings());
  handle('settings:set', async (patch) => {
    const out = await launcher.setSettings(patch);
    if ('discordStatus' in patch || 'discordServer' in patch) discord?.poke(0);
    return out;
  });
  handle('versions:list', () => launcher.listVersions());
  handle('loaders:games', (kind) => launcher.loaderGameVersions(kind));
  handle('loaders:versions', (kind, mc) => launcher.loaderVersions(kind, mc));

  handle('instances:list', () => launcher.listInstances());
  handle('instances:get', (id) => launcher.instances.get(id));
  handle('instances:create', (fields) => launcher.createInstance(fields));
  handle('instances:update', (id, patch) => {
    const allowed = ['name', 'icon', 'memory', 'javaPath', 'jvmArgs', 'resolution', 'fullscreen', 'server'];
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    return launcher.instances.update(id, clean);
  });
  handle('instances:remove', (id) => {
    if (launcher.running.has(id)) throw new Error('Close the game before deleting this instance');
    return launcher.instances.remove(id);
  });
  handle('instances:duplicate', (id) => launcher.instances.duplicate(id));
  handle('instances:repair', (id) => launcher.installInstance(id, { deep: true }));
  handle('instances:install', (id) => launcher.installInstance(id));
  handle('instances:open', async (id, sub) => {
    const base = launcher.paths.gameDir(id);
    const target = sub ? path.join(base, sub) : base;
    await require('fs').promises.mkdir(target, { recursive: true });
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
  });
  handle('instances:size', (id) => launcher.instances.sizeOf(id));
  handle('content:list', (id) => launcher.instances.listContent(id));
  handle('content:toggle', (id, rel, enabled) => launcher.instances.setContentEnabled(id, rel, enabled));
  handle('content:remove', (id, rel) => launcher.instances.removeContent(id, rel));
  handle('content:addFiles', async (id, type, paths) => {
    let files = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : [];
    if (!files.length) {
      const pick = {
        mod: { title: 'Add mods', name: 'Mods', extensions: ['jar'] },
        resourcepack: { title: 'Add resource packs', name: 'Resource packs', extensions: ['zip'] },
        shader: { title: 'Add shader packs', name: 'Shader packs', extensions: ['zip'] },
      }[type];
      if (!pick) throw new Error('Pick Mods, Resource Packs or Shaders first.');
      const res = await dialog.showOpenDialog(win, { title: pick.title, properties: ['openFile', 'multiSelections'], filters: [{ name: pick.name, extensions: pick.extensions }] });
      if (res.canceled) return { added: [], skipped: [] };
      files = res.filePaths;
    }
    return launcher.addContentFiles(id, type, files);
  });
  handle('content:identify', (id) => modrinth.identifyContent({ paths: launcher.paths }, launcher.instances, id));
  handle('content:updates', async (id) => modrinth.checkUpdates({ paths: launcher.paths }, launcher.instances, await launcher.instances.get(id)));
  handle('content:update', (id, items) => launcher.updateContent(id, items));

  handle('game:launch', async (id) => {
    const mode = launcher.settings.onLaunch;
    const inst = await launcher.instances.get(id);
    const splash = launcher.settings.splash !== false ? new LaunchSplash(inst, launcher.settings) : null;
    const onTask = (t) => {
      if (t.instanceId !== id || t.state !== 'running') return;
      const progress = t.checking || !t.total ? null : t.totalBytes ? t.bytes / t.totalBytes : t.done / t.total;
      splash?.update({ stage: t.stage, progress });
    };
    launcher.on('task', onTask);
    let result;
    try {
      result = await launcher.launch(id, { detach: mode === 'close' });
    } catch (err) {
      splash?.close();
      throw err;
    } finally {
      launcher.off('task', onTask);
    }
    splash?.follow(id, result.detached);
    if (mode === 'close') setTimeout(() => app.quit(), splash ? 9000 : 1500);
    else if (mode === 'hide' && win) win.hide();
    return result;
  });
  handle('game:kill', (id) => launcher.kill(id));
  handle('game:log', (id) => launcher.getLog(id));
  handle('game:openCrash', async (file) => {
    if (!file.startsWith(launcher.paths.instances)) throw new Error('Not a crash report');
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
  });

  handle('accounts:list', () => launcher.accounts.list());
  handle('accounts:login', () => microsoftLogin());
  handle('accounts:remove', (uuid) => launcher.accounts.remove(uuid));
  handle('accounts:select', (uuid) => launcher.accounts.setActive(uuid));

  handle('modrinth:search', (opts) => modrinth.search(opts));
  handle('modrinth:project', (id) => modrinth.getProject(id));
  handle('modrinth:versions', (id, opts) => modrinth.getVersions(id, opts));
  handle('modrinth:install', (instanceId, projectId, versionId) => launcher.installContent(instanceId, projectId, versionId));
  handle('modrinth:installPack', (opts) => launcher.installModpack(opts));
  handle('modpack:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Import a Modrinth modpack',
      filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return launcher.installModpack({ file: res.filePaths[0], project: { title: path.basename(res.filePaths[0], '.mrpack') } });
  });

  handle('boost:info', (id) => launcher.boostInfo(id));
  handle('boost:apply', (id, preset, opts) => launcher.applyBoost(id, preset, opts));
  handle('boost:revert', (id) => launcher.revertBoost(id));
  handle('system:gpu', () => gpuInfo());

  handle('skins:state', () => launcher.skinState());
  handle('skins:wardrobe', () => launcher.listWardrobe());
  handle('skins:apply', (opts) => launcher.applySkin(opts));
  handle('skins:reset', () => launcher.resetSkin());
  handle('skins:cape', (capeId) => launcher.setCape(capeId));
  handle('skins:import', (opts) => launcher.importSkin(opts));
  handle('skins:update', (id, patch) => launcher.updateSkin(id, patch));
  handle('skins:remove', (id) => launcher.removeSkin(id));
  handle('skins:lookup', (name) => launcher.lookupPlayerSkin(name));
  handle('skins:search', (opts) => launcher.searchSkins(opts));
  handle('skins:texture', (url) => launcher.skinTexture(url));
  handle('skins:pick', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a skin',
      filters: [{ name: 'Minecraft skin', extensions: ['png'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const png = await require('fs').promises.readFile(res.filePaths[0]);
    require('./src/core/skins').checkSkin(png);
    return { name: path.basename(res.filePaths[0], '.png'), texture: `data:image/png;base64,${png.toString('base64')}` };
  });
  handle('java:detect', () => launcher.detectJava());
  handle('java:pick', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a Java executable',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : [],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('cache:size', () => launcher.cacheSize());
  handle('cache:clear', () => launcher.clearCache());
  handle('data:open', async () => { await shell.openPath(launcher.paths.root); });
  handle('tasks:list', () => launcher.listTasks());
  // player counter, cached for half a minute
  let statsCache = null;
  handle('presence:stats', async () => {
    if (statsCache && Date.now() - statsCache.at < 30000) return statsCache.data;
    const data = await presence.stats();
    statsCache = { at: Date.now(), data };
    return data;
  });
  // a background picture of your own
  const fsp = require('fs').promises;
  const PICTURE_TYPES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
  const pickPicture = async (title) => {
    const res = await dialog.showOpenDialog(win, { title, properties: ['openFile'], filters: [{ name: 'Pictures', extensions: PICTURE_TYPES }] });
    return res.canceled ? null : res.filePaths[0] || null;
  };
  /** A picture as a size we can work with: big photos are scaled down, never refused. */
  const loadPicture = (src, longest) => {
    let img = nativeImage.createFromPath(src);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    const scale = Math.min(1, longest / Math.max(width, height));
    if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' });
    return img;
  };
  const useBackground = async (src) => {
    const ext = path.extname(src).slice(1).toLowerCase();
    if (!PICTURE_TYPES.includes(ext)) throw new Error('That is not a picture. Use a PNG, JPG, WebP or GIF.');
    const stat = await fsp.stat(src);
    const root = launcher.paths.root;
    // a new name every time, so the new picture shows even when it has the same type as the old one
    const stamp = Date.now().toString(36);
    const img = ext === 'gif' ? null : loadPicture(src, 2560);
    let dest;
    if (img) {
      dest = path.join(root, `background-${stamp}.jpg`);
      await fsp.writeFile(dest, img.toJPEG(90));
    } else {
      if (stat.size > 40 * 1024 * 1024) throw new Error('That picture is over 40 MB. Save it as a PNG or JPG and try again.');
      dest = path.join(root, `background-${stamp}.${ext}`);
      await fsp.copyFile(src, dest);
    }
    for (const f of await fsp.readdir(root)) {
      if (/^background(-[a-z0-9]+)?\.(png|jpe?g|webp|gif|bmp)$/i.test(f) && path.join(root, f) !== dest) await fsp.rm(path.join(root, f), { force: true });
    }
    backgroundCache = null;
    return launcher.setSettings({ background: 'image', bgImage: dest });
  };
  handle('look:pickBackground', async () => {
    const src = await pickPicture('Pick a background picture');
    return src ? useBackground(src) : launcher.getSettings();
  });
  handle('look:useBackground', (src) => useBackground(String(src || '')));
  let backgroundCache = null;
  handle('look:background', async () => {
    const file = launcher.settings.bgImage;
    if (!file) return null;
    if (backgroundCache?.file === file) return backgroundCache.url;
    const buf = await fsp.readFile(file);
    const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
    backgroundCache = { file, url: `data:image/${ext};base64,${buf.toString('base64')}` };
    return backgroundCache.url;
  });

  // the background behind Minecraft's title screen and menus (Nimbus Core reads it)
  const MENU_MODES = ['minecraft', 'nimbus', 'picture'];
  const menuState = async () => {
    const values = (await readJson(launcher.paths.features, {}))?.values || {};
    const mode = MENU_MODES[Math.max(0, Math.min(2, Number(values['menu.background']) || 0))];
    const img = nativeImage.createFromPath(launcher.paths.menuImage);
    const preview = img.isEmpty() ? null : img.resize({ width: 320, quality: 'good' }).toDataURL();
    return { mode, preview };
  };
  handle('menu:get', menuState);
  handle('menu:set', async ({ mode, from } = {}) => {
    if (from) {
      const src = from === 'launcher' ? launcher.settings.bgImage : await pickPicture('Pick a picture for the game menus');
      if (!src) return menuState();
      const img = loadPicture(src, 3840);
      if (!img) throw new Error('The game can only use PNG and JPG pictures. Pick one of those.');
      await fsp.writeFile(launcher.paths.menuImage, img.toPNG());
      mode = 'picture';
    }
    const index = MENU_MODES.indexOf(mode);
    if (index < 0) throw new Error('Unknown menu background.');
    const features = (await readJson(launcher.paths.features, {})) || {};
    features.values = { ...(features.values || {}), 'menu.background': index };
    await writeJson(launcher.paths.features, features);
    return menuState();
  });
  // friends and chat
  handle('friends:state', () => friends.snapshot());
  handle('friends:refresh', async () => { await friends.beat(); return friends.snapshot(); });
  handle('friends:add', (name) => friends.add(String(name || '')));
  handle('friends:accept', (uuid) => friends.accept(uuid));
  handle('friends:decline', (uuid) => friends.decline(uuid));
  handle('friends:cancel', (uuid) => friends.cancel(uuid));
  handle('friends:remove', (uuid) => friends.remove(uuid));
  handle('friends:chat', (to, text) => friends.chat(to, String(text || '')));
  handle('friends:history', (uuid) => friends.loadHistory(uuid));
  handle('friends:read', (uuid) => friends.markRead(uuid));

  // Nimbus LAN
  handle('lan:state', () => lan.state());
  handle('lan:join', (uuid) => lan.join(uuid));
  handle('lan:cancel', () => lan.cancelJoin());
  handle('lan:decide', (id, allow) => lan.decide(String(id), Boolean(allow)));

  handle('update:state', () => ({ ...updates, current: app.getVersion() }));
  handle('update:check', async () => {
    if (!updater) throw new Error(updates.message || 'Updates are not available here.');
    if (updates.state === 'downloading' || updates.state === 'ready') return { ...updates, current: app.getVersion() };
    lastUpdateCheck = Date.now();
    await updater.checkForUpdates();
    return { ...updates, current: app.getVersion() };
  });
  handle('update:install', () => {
    if (!updater || updates.state !== 'ready') throw new Error('No update is ready yet.');
    if (launcher.running.size > 0) throw new Error('Close Minecraft first — the update restarts the launcher.');
    setImmediate(() => updater.quitAndInstall(true, true));
  });
}

app.whenReady().then(async () => {
  const root = process.env.NIMBUS_DATA_DIR || path.join(app.getPath('userData'), 'minecraft');
  // Nimbus Core ships next to the app (extraResources) in a packaged build
  const builtinDir = app.isPackaged ? path.join(process.resourcesPath, 'mods') : path.join(__dirname, 'resources', 'mods');
  launcher = await new Launcher({ root, crypto: sealer, builtinDir }).init();
  launcher.on('task', (t) => send('task', t));
  launcher.on('game-log', (e) => send('game:log', e));
  launcher.on('boost-step', (e) => send('boost:step', e));
  launcher.on('game-state', (e) => {
    send('game:state', e);
    if (e.running || launcher.running.size > 0) return;
    // the window was closed while playing: nothing left to wait for
    if (!win) app.quit();
    else if (!win.isVisible()) {
      win.show();
      win.focus();
    }
    // back from a long session: see whether a new version came out meanwhile
    checkForUpdates(30 * 60 * 1000);
  });
  presence = new Presence({
    settings: () => launcher.settings,
    save: (patch) => launcher.setSettings(patch),
    playing: () => launcher.running.size > 0,
  });
  presence.start();
  friends = new Friends({ launcher, hosting: () => lan?.hostingInfo() || null });
  friends.on('state', (st) => send('friends:state', st));
  friends.on('message', (m) => send('friends:message', m));
  friends.init().catch(() => {});
  lan = new Lan({ launcher, friends, netWindow });
  lan.on('state', (st) => send('lan:state', st));
  if (process.env.NIMBUS_DATA_DIR) global.nimbusLan = lan; // tests reach in here
  await lan.startBridge().catch(() => {});
  discord = new DiscordStatus({
    launcher,
    lan,
    version: app.getVersion(),
    config: async () => {
      const s = await services();
      return { clientId: process.env.NIMBUS_DISCORD_ID || s.discord || null, image: s.discordImage, site: s.site };
    },
  });
  launcher.on('game-state', () => discord.poke());
  lan.on('state', () => discord.poke());
  lan.on('game-status', () => discord.poke());
  discord.start();
  if (process.env.NIMBUS_DATA_DIR) global.nimbusDiscord = discord;
  ipcMain.on('net:event', (e, msg) => { if (netWin && e.sender === netWin.webContents) lan.netEvent(msg); });
  registerIpc();
  createWindow();
  updater = setupUpdater();
  // check on every start, as soon as the window is up
  if (updater) win.webContents.once('did-finish-load', () => setTimeout(() => checkForUpdates(), 1200));
  app.on('activate', () => { if (!win) createWindow(); });
});

// clear the Discord status on the way out, so it doesn't linger until Discord notices
let discordCleared = false;
app.on('before-quit', (e) => {
  if (discordCleared || !discord?.ipc) return;
  e.preventDefault();
  discordCleared = true;
  Promise.race([discord.stop(), new Promise((r) => setTimeout(r, 800))]).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  // closing the window while a game runs would orphan its log pipe; keep the process until it exits
  if (launcher && launcher.running.size > 0) return;
  app.quit();
});
