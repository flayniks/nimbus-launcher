'use strict';
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) {
    const err = new Error(res.error);
    err.code = res.code;
    throw err;
  }
  return res.data;
}

const EVENTS = new Set(['task', 'game:log', 'game:state', 'boost:step', 'win:state', 'update:state']);

contextBridge.exposeInMainWorld('nimbus', {
  platform: process.platform,
  app: {
    info: () => call('app:info'),
    minimize: () => call('win:minimize'),
    maximize: () => call('win:maximize'),
    close: () => call('win:close'),
    external: (url) => call('shell:external', url),
    openData: () => call('data:open'),
    // a dropped file's path on disk (sandboxed pages can't read it themselves)
    pathForFile: (file) => { try { return webUtils.getPathForFile(file) || null; } catch { return null; } },
    setZoom: (f) => { try { webFrame.setZoomFactor(Math.max(0.75, Math.min(1.5, Number(f) || 1))); } catch { /* keep */ } },
  },
  presence: {
    stats: () => call('presence:stats'),
  },
  look: {
    pickBackground: () => call('look:pickBackground'),
    useBackground: (file) => call('look:useBackground', file),
    menu: () => call('menu:get'),
    setMenu: (choice) => call('menu:set', choice),
    background: () => call('look:background'),
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
  },
  versions: { list: () => call('versions:list') },
  loaders: {
    games: (kind) => call('loaders:games', kind),
    versions: (kind, mc) => call('loaders:versions', kind, mc),
  },
  instances: {
    list: () => call('instances:list'),
    get: (id) => call('instances:get', id),
    create: (fields) => call('instances:create', fields),
    update: (id, patch) => call('instances:update', id, patch),
    remove: (id) => call('instances:remove', id),
    duplicate: (id) => call('instances:duplicate', id),
    repair: (id) => call('instances:repair', id),
    install: (id) => call('instances:install', id),
    open: (id, sub) => call('instances:open', id, sub),
    size: (id) => call('instances:size', id),
  },
  content: {
    list: (id) => call('content:list', id),
    toggle: (id, rel, enabled) => call('content:toggle', id, rel, enabled),
    remove: (id, rel) => call('content:remove', id, rel),
    addFiles: (id, type, paths) => call('content:addFiles', id, type, paths),
    identify: (id) => call('content:identify', id),
    updates: (id) => call('content:updates', id),
    update: (id, items) => call('content:update', id, items),
  },
  game: {
    launch: (id) => call('game:launch', id),
    kill: (id) => call('game:kill', id),
    log: (id) => call('game:log', id),
    openCrash: (file) => call('game:openCrash', file),
  },
  accounts: {
    list: () => call('accounts:list'),
    login: () => call('accounts:login'),
    remove: (uuid) => call('accounts:remove', uuid),
    select: (uuid) => call('accounts:select', uuid),
  },
  modrinth: {
    search: (opts) => call('modrinth:search', opts),
    project: (id) => call('modrinth:project', id),
    versions: (id, opts) => call('modrinth:versions', id, opts),
    install: (instanceId, projectId, versionId) => call('modrinth:install', instanceId, projectId, versionId),
    installPack: (opts) => call('modrinth:installPack', opts),
    importPack: () => call('modpack:import'),
  },
  boost: {
    info: (id) => call('boost:info', id),
    apply: (id, preset, opts) => call('boost:apply', id, preset, opts),
    revert: (id) => call('boost:revert', id),
    gpu: () => call('system:gpu'),
  },
  skins: {
    state: () => call('skins:state'),
    wardrobe: () => call('skins:wardrobe'),
    apply: (opts) => call('skins:apply', opts),
    reset: () => call('skins:reset'),
    cape: (capeId) => call('skins:cape', capeId),
    import: (opts) => call('skins:import', opts),
    update: (id, patch) => call('skins:update', id, patch),
    remove: (id) => call('skins:remove', id),
    lookup: (name) => call('skins:lookup', name),
    search: (query, after) => call('skins:search', { query, after }),
    texture: (url) => call('skins:texture', url),
    pick: () => call('skins:pick'),
  },
  java: {
    detect: () => call('java:detect'),
    pick: () => call('java:pick'),
  },
  cache: {
    size: () => call('cache:size'),
    clear: () => call('cache:clear'),
  },
  tasks: { list: () => call('tasks:list') },
  updates: {
    state: () => call('update:state'),
    check: () => call('update:check'),
    install: () => call('update:install'),
  },
  on(event, fn) {
    if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}`);
    const listener = (_e, data) => fn(data);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
