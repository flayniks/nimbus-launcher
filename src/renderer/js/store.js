// Shared state plus a tiny event bus, fed by the main process.
export const api = window.nimbus;

const listeners = new Map();

export const store = {
  instances: [],
  accounts: [],
  settings: null,
  tasks: new Map(),
  running: new Set(),
  versions: null,
  update: { state: 'idle' },
  modUpdates: new Map(), // instance id -> updates found on Modrinth

  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },

  emit(event, data) {
    for (const fn of listeners.get(event) || []) {
      try { fn(data); } catch (err) { console.error(err); }
    }
  },

  async refreshInstances() {
    this.instances = await api.instances.list();
    this.running = new Set(this.instances.filter((i) => i.running).map((i) => i.id));
    this.emit('instances', this.instances);
    return this.instances;
  },

  async refreshAccounts() {
    this.accounts = await api.accounts.list();
    this.emit('accounts', this.accounts);
    return this.accounts;
  },

  activeAccount() {
    return this.accounts.find((a) => a.active) || null;
  },

  async loadVersions() {
    if (!this.versions) this.versions = api.versions.list().catch((err) => { this.versions = null; throw err; });
    return this.versions;
  },

  /** The running task for an instance, if any (installs, launches, boosts). */
  taskFor(instanceId) {
    let found = null;
    for (const t of this.tasks.values()) if (t.instanceId === instanceId && t.state === 'running') found = t;
    return found;
  },
};

api.on('content:updates', (e) => {
  store.modUpdates.set(e.instanceId, e.updates);
  store.emit('mod-updates', e);
});
api.content.updatesKnown().then((all) => {
  for (const [id, list] of Object.entries(all || {})) store.modUpdates.set(id, list);
  store.emit('mod-updates', {});
}).catch(() => {});

api.on('task', (t) => {
  store.tasks.set(t.id, t);
  if (t.state !== 'running') setTimeout(() => { store.tasks.delete(t.id); store.emit('tasks', store.tasks); }, t.state === 'error' ? 20000 : 4000);
  store.emit('task', t);
  store.emit('tasks', store.tasks);
});

api.on('game:state', (e) => {
  if (e.running) store.running.add(e.instanceId);
  else store.running.delete(e.instanceId);
  document.body.classList.toggle('game-running', store.running.size > 0);
  store.emit('game-state', e);
  store.refreshInstances().catch(() => {});
});

api.on('game:log', (e) => store.emit('game-log', e));
api.on('boost:step', (e) => store.emit('boost-step', e));

api.on('update:state', (u) => {
  store.update = u;
  store.emit('update', u);
});

// friends: the latest list, and each message as it arrives
store.friends = { signedIn: false, friends: [], requests: [], outgoing: [], unread: {} };
store.lan = { hosting: null, joining: null };
api.friends.state().then((s) => { store.friends = s; store.emit('friends', s); }).catch(() => {});
api.on('friends:state', (s) => {
  store.friends = s;
  store.emit('friends', s);
});
api.on('friends:message', (m) => store.emit('friend-message', m));
api.on('lan:state', (s) => {
  store.lan = s;
  store.emit('lan', s);
});
