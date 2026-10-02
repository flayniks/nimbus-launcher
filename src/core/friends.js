'use strict';
// Friends, chat and presence, through the Nimbus friends service (website/lib/friends-api.mjs,
// hosted with the website on Netlify). Signing in proves you own your Minecraft account the
// same way joining a server does: the launcher "joins" a one-off server id at Mojang and the
// service asks Mojang to confirm it. No password or token ever leaves for anywhere else.
const EventEmitter = require('events');
const crypto = require('crypto');
const path = require('path');
const { readJson, writeJson } = require('./util');
const { services } = require('./services');

const DEFAULT_API = 'https://nimbus-launcher.netlify.app/api';
const SLOW = 15_000;
const FAST = 2_500;
const BAN_CHECK = 5 * 60_000;

/** An error the service sent because this account or launcher is banned. */
function banError(data) {
  const err = new Error(data.error || "You're banned from Nimbus.");
  err.code = 'BANNED';
  err.banned = data.banned;
  return err;
}

class Friends extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.launcher the Launcher (accounts, settings, running games)
   * @param {() => object|null} [opts.hosting] what this player is hosting on Nimbus LAN
   */
  constructor({ launcher, hosting = () => null }) {
    super();
    this.launcher = launcher;
    this.hosting = hosting;
    this.file = path.join(launcher.paths.root, 'friends.json');
    this.saved = { sessions: {}, unread: {} };
    this.state = { signedIn: false, me: null, friends: [], requests: [], outgoing: [], error: null, api: null };
    this.timer = null;
    this.hotUntil = 0;
    this.beating = false;
    this.history = new Map();
  }

  async init() {
    this.saved = { sessions: {}, unread: {}, ...(await readJson(this.file, {})) };
    // a random id for this install of the launcher, so a ban can cover it whichever account signs in
    if (!/^[0-9a-f]{32}$/.test(this.saved.installId || '')) {
      this.saved.installId = crypto.randomBytes(16).toString('hex');
      await this.persist();
    }
    this.start();
    this.checkBan().catch(() => {});
    this.banTimer = setInterval(() => this.checkBan().catch(() => {}), BAN_CHECK);
    if (this.banTimer.unref) this.banTimer.unref();
    return this;
  }

  /** The ban on this launcher, while it lasts (kept from the last answer, so being offline doesn't lift it). */
  banned() {
    const b = this.saved.ban;
    if (!b) return null;
    if (b.until && b.until <= Date.now()) return null;
    return b;
  }

  setBan(ban) {
    const before = JSON.stringify(this.saved.ban || null);
    this.saved.ban = ban || null;
    if (JSON.stringify(this.saved.ban) === before) return;
    this.persist().catch(() => {});
    this.emit('ban', this.banned());
    this.emit('state', this.snapshot());
  }

  /** Asks the service whether this install (or the signed-in account) is banned. */
  async checkBan() {
    const base = await this.apiBase();
    const acc = await this.account();
    const token = acc ? this.saved.sessions[acc.uuid]?.token : null;
    const res = await fetch(`${base}/ban/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ installId: this.saved.installId }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return this.banned();
    const data = await res.json().catch(() => ({}));
    if ('banned' in data) this.setBan(data.banned);
    return this.banned();
  }

  async persist() {
    await writeJson(this.file, this.saved);
  }

  /** Where the service lives: an override, then the address published in the repo, then the default. */
  async apiBase() {
    if (process.env.NIMBUS_FRIENDS_URL) return process.env.NIMBUS_FRIENDS_URL.replace(/\/+$/, '');
    const s = await services();
    this.base = String(s.friends || DEFAULT_API).replace(/\/+$/, '');
    return this.base;
  }

  /** Makes polling quick for a while: a chat is open, or a join is under way. */
  hot(ms = 120_000) {
    this.hotUntil = Math.max(this.hotUntil, Date.now() + ms);
    this.schedule(200);
  }

  start() {
    this.schedule(500);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.beat().catch(() => {}), ms);
    if (this.timer.unref) this.timer.unref();
  }

  async account() {
    try {
      return await this.launcher.accounts.activeSession(this.launcher.oauth());
    } catch {
      return null;
    }
  }

  /** The service session for the active Minecraft account, signing in when needed. */
  async session(force = false) {
    const acc = await this.account();
    if (!acc) return null;
    const known = this.saved.sessions[acc.uuid];
    if (known && !force) return known;
    const base = await this.apiBase();
    const post = (p, body) => fetch(`${base}/${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    let res;
    if (process.env.NIMBUS_FRIENDS_DEV === '1') {
      res = await post('login/finish', { dev: true, uuid: acc.uuid, name: acc.name });
    } else {
      const start = await post('login/start', {});
      if (!start.ok) throw new Error(`The friends service answered ${start.status}.`);
      const { serverId } = await start.json();
      const mojang = process.env.NIMBUS_SESSION_URL || 'https://sessionserver.mojang.com';
      const join = await fetch(`${mojang}/session/minecraft/join`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken: acc.accessToken, selectedProfile: acc.uuid.replace(/-/g, ''), serverId }),
        signal: AbortSignal.timeout(15000),
      });
      if (join.status !== 204 && join.status !== 200) throw new Error('Mojang refused the sign-in. Sign out and back in to your account.');
      res = await post('login/finish', { name: acc.name, serverId, installId: this.saved.installId });
    }
    let data = {};
    try { data = await res.json(); } catch { /* not JSON: the service isn't there */ }
    if (res.status === 403 && data.banned) {
      this.setBan(data.banned);
      throw banError(data);
    }
    if (!res.ok) throw new Error(data.error || `The friends service answered ${res.status}.`);
    this.saved.sessions[acc.uuid] = { token: data.token, uuid: data.uuid, name: data.name };
    await this.persist();
    return this.saved.sessions[acc.uuid];
  }

  async call(p, body = {}, retry = true) {
    const s = await this.session();
    if (!s) throw new Error('Sign in with a Microsoft account to use friends.');
    const base = await this.apiBase();
    const res = await fetch(`${base}/${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    let data = {};
    try { data = await res.json(); } catch { /* not JSON: the service isn't there */ }
    if (res.status === 401 && retry) {
      await this.session(true);
      return this.call(p, body, false);
    }
    if (res.status === 403 && data.banned) {
      this.setBan(data.banned);
      throw banError(data);
    }
    if (!res.ok) throw new Error(data.error || `The friends service answered ${res.status}.`);
    return data;
  }

  presence() {
    const running = [...(this.launcher.running?.values?.() || [])][0];
    const inst = running?.instance || running?.inst || null;
    return {
      status: this.launcher.running?.size ? 'playing' : 'online',
      playing: inst ? { mc: inst.mcVersion, loader: inst.loader } : null,
      hosting: this.hosting() || null,
    };
  }

  async beat() {
    if (this.beating) return;
    this.beating = true;
    try {
      const acc = await this.account();
      if (!acc) {
        this.update({ signedIn: false, me: null, friends: [], requests: [], outgoing: [], error: 'Sign in with a Microsoft account to use friends.' });
        return;
      }
      const data = await this.call('beat', { ...this.presence(), installId: this.saved.installId });
      // the service answered normally, so whatever ban there was is over
      if (this.saved.ban) this.setBan(null);
      this.update({ signedIn: true, me: data.me, friends: data.friends, requests: data.requests, outgoing: data.outgoing || [], error: null, offline: false, api: this.base });
      for (const m of data.inbox || []) this.receive(m);
    } catch (err) {
      if (err.code === 'BANNED') {
        this.update({ signedIn: false, me: null, friends: [], requests: [], outgoing: [], error: err.message, offline: false });
        return;
      }
      const offline = err.name === 'TimeoutError' || err.name === 'AbortError' || /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|answered 404|answered 5\d\d/i.test(`${err.message} ${err.cause?.code || ''}`);
      this.update({ error: offline ? "Can't reach Nimbus friends right now. Trying again soon." : err.message, offline });
    } finally {
      this.beating = false;
      this.schedule(Date.now() < this.hotUntil ? FAST : SLOW);
    }
  }

  receive(m) {
    if (m.type === 'chat') {
      const list = this.history.get(m.from);
      if (list) list.push(m);
      this.saved.unread[m.from] = (this.saved.unread[m.from] || 0) + 1;
      this.persist().catch(() => {});
      this.hot(60_000);
    }
    if (m.type === 'friend-request' || m.type === 'friend-added') this.schedule(300);
    this.emit('message', m);
    this.emit('state', this.snapshot());
  }

  update(patch) {
    Object.assign(this.state, patch);
    this.emit('state', this.snapshot());
  }

  snapshot() {
    return { ...this.state, unread: { ...this.saved.unread }, banned: this.banned() };
  }

  // ---- admins (the service checks; the launcher only shows the page to them)
  adminUsers() { return this.call('admin/users', {}); }
  adminBan(target, reason, days) { return this.call('admin/ban', { ...target, reason, days }); }
  adminUnban(uuid) { return this.call('admin/unban', { uuid }); }

  // ---- actions
  async add(name) { const r = await this.call('friends/add', { name }); this.schedule(100); return r; }
  async accept(uuid) { const r = await this.call('friends/accept', { uuid }); this.schedule(100); return r; }
  async decline(uuid) { const r = await this.call('friends/decline', { uuid }); this.schedule(100); return r; }
  async cancel(uuid) { const r = await this.call('friends/cancel', { uuid }); this.schedule(100); return r; }
  async remove(uuid) { const r = await this.call('friends/remove', { uuid }); this.schedule(100); return r; }

  async chat(to, text) {
    const r = await this.call('chat/send', { to, text });
    const list = this.history.get(to);
    if (list) list.push(r.message);
    this.hot();
    return r.message;
  }

  /** A picture message: `picture` is {type, data (base64), w, h}. */
  async sendImage(to, picture, text = '') {
    const r = await this.call('chat/image', { to, ...picture, text });
    const list = this.history.get(to);
    if (list) list.push(r.message);
    this.hot();
    return r.message;
  }

  /** A picture from a chat, as a data: URL (the last few are kept). */
  async image(id) {
    this.images = this.images || new Map();
    if (this.images.has(id)) return this.images.get(id);
    const r = await this.call('chat/image/get', { id });
    const url = `data:${r.type};base64,${r.data}`;
    this.images.set(id, url);
    if (this.images.size > 40) this.images.delete(this.images.keys().next().value);
    return url;
  }

  async loadHistory(uuid) {
    const r = await this.call('chat/history', { with: uuid });
    this.history.set(uuid, r.messages);
    this.hot();
    return r.messages;
  }

  async markRead(uuid) {
    if (!this.saved.unread[uuid]) return;
    delete this.saved.unread[uuid];
    await this.persist();
    this.emit('state', this.snapshot());
  }

  /** Nimbus LAN messages: join requests, answers and the WebRTC handshake. */
  async relay(to, type, data) {
    this.hot();
    return this.call('relay', { to, type, data });
  }
}

module.exports = { Friends, DEFAULT_API };
