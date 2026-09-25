'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Menu } = require('electron');
const path = require('path');
const { Launcher } = require('./src/core/launcher');
const auth = require('./src/core/auth');
const modrinth = require('./src/core/modrinth');

const DEV = process.argv.includes('--dev');
let win = null;
let launcher = null;

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
  win.on('closed', () => { win = null; });
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
  handle('settings:set', (patch) => launcher.setSettings(patch));
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
  handle('content:identify', (id) => modrinth.identifyContent({ paths: launcher.paths }, launcher.instances, id));
  handle('content:updates', async (id) => modrinth.checkUpdates({ paths: launcher.paths }, launcher.instances, await launcher.instances.get(id)));
  handle('content:update', (id, items) => launcher.updateContent(id, items));

  handle('game:launch', async (id) => {
    const mode = launcher.settings.onLaunch;
    const result = await launcher.launch(id, { detach: mode === 'close' });
    if (mode === 'close') setTimeout(() => app.quit(), 1500);
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
}

app.whenReady().then(async () => {
  const root = process.env.NIMBUS_DATA_DIR || path.join(app.getPath('userData'), 'minecraft');
  launcher = await new Launcher({ root, crypto: sealer }).init();
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
  });
  registerIpc();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => {
  // closing the window while a game runs would orphan its log pipe; keep the process until it exits
  if (launcher && launcher.running.size > 0) return;
  app.quit();
});
