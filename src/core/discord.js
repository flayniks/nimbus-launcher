'use strict';
// Discord status ("Rich Presence"): what you're playing, on your Discord profile. The launcher talks
// to the Discord app on this computer through its local socket, the same way games do, so nothing
// here goes over the internet. Nimbus Core tells the launcher where you are in the game (menus,
// singleplayer, which server) over the Nimbus LAN bridge; vanilla instances just show the version.
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const DEFAULT_IMAGE = 'https://raw.githubusercontent.com/flayniks/nimbus-launcher/main/build/icon.png';
const DEFAULT_SITE = 'https://github.com/flayniks/nimbus-launcher/releases/latest';
const RETRY_MS = 20_000;
const MIN_GAP_MS = 4_000; // Discord allows 5 updates per 20 seconds

/** Where the Discord app listens: named pipes on Windows, sockets in the runtime folder elsewhere. */
function socketPaths() {
  if (process.env.NIMBUS_DISCORD_IPC) return [process.env.NIMBUS_DISCORD_IPC];
  const out = [];
  if (process.platform === 'win32') {
    for (let i = 0; i < 10; i++) out.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    return out;
  }
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  // the plain app, then the Flatpak and Snap builds
  for (const dir of [base, path.join(base, 'app', 'com.discordapp.Discord'), path.join(base, 'snap.discord')]) {
    for (let i = 0; i < 10; i++) out.push(path.join(dir, `discord-ipc-${i}`));
  }
  return out;
}

function frame(op, data) {
  const body = Buffer.from(JSON.stringify(data));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** One connection to the Discord app. */
class DiscordIpc extends EventEmitter {
  constructor(clientId) {
    super();
    this.clientId = clientId;
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.waiting = new Map();
  }

  async connect() {
    let lastErr = new Error('Discord is not running');
    for (const p of socketPaths()) {
      try {
        this.sock = await new Promise((resolve, reject) => {
          const s = net.createConnection(p, () => { s.off('error', reject); resolve(s); });
          s.once('error', reject);
        });
        break;
      } catch (err) { lastErr = err; }
    }
    if (!this.sock) throw lastErr;
    this.sock.on('data', (d) => this.read(d));
    this.sock.on('close', () => { this.sock = null; this.emit('close'); });
    this.sock.on('error', () => {});
    const ready = this.expect('READY', 6000);
    this.sock.write(frame(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
    await ready;
  }

  read(data) {
    this.buf = Buffer.concat([this.buf, data]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) return;
      let msg = {};
      try { msg = JSON.parse(this.buf.subarray(8, 8 + len).toString()); } catch { /* skip it */ }
      this.buf = this.buf.subarray(8 + len);
      if (op === OP.PING) this.sock?.write(frame(OP.PONG, msg));
      else if (op === OP.CLOSE) {
        // wrong app id, or Discord shutting down
        this.fail(new Error(msg.message || 'Discord closed the connection'));
        this.close();
      } else if (op === OP.FRAME) {
        const key = msg.evt === 'READY' ? 'READY' : msg.nonce;
        const w = this.waiting.get(key);
        if (w) {
          this.waiting.delete(key);
          clearTimeout(w.timer);
          if (msg.evt === 'ERROR') w.reject(new Error(msg.data?.message || 'Discord said no'));
          else w.resolve(msg);
        }
      }
    }
  }

  expect(key, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(key); reject(new Error('Discord did not answer')); }, ms);
      this.waiting.set(key, { resolve, reject, timer });
    });
  }

  fail(err) {
    for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(err); }
    this.waiting.clear();
  }

  /** Shows (or with null, clears) the activity. */
  async setActivity(activity) {
    if (!this.sock) throw new Error('not connected');
    const nonce = crypto.randomUUID();
    const answer = this.expect(nonce, 6000);
    this.sock.write(frame(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce }));
    return answer;
  }

  close() {
    this.fail(new Error('closed'));
    try { this.sock?.end(); } catch { /* already gone */ }
    this.sock = null;
  }
}

/** A server address worth showing: a name like mc.hypixel.net, not an IP or your own computer. */
function shownServer(address) {
  if (!address) return null;
  let host = String(address).trim().toLowerCase();
  if (host.startsWith('[')) return null; // IPv6
  host = host.replace(/:\d+$/, '');
  if (!host || host.length > 60 || host.includes(':')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan') || !host.includes('.')) return null;
  return host;
}

const LOADERS = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

/**
 * The activity for what's going on. Kept free of I/O so it's easy to test.
 * @param {object} o
 * @param {string} o.version launcher version
 * @param {{instance: object, started: number}|null} o.game the running game
 * @param {object|null} o.status where Nimbus Core says you are
 * @param {object|null} o.lan Nimbus LAN state
 * @param {boolean} o.showServer show server names
 * @param {number} o.since when the launcher opened
 */
function activityFor({ version, game, status, lan, showServer = true, since, image = DEFAULT_IMAGE, site = DEFAULT_SITE }) {
  const activity = {
    assets: { large_image: image, large_text: `Nimbus Launcher ${version}` },
    buttons: [{ label: 'Get Nimbus Launcher', url: site }],
    instance: false,
  };
  if (!game) {
    activity.details = 'In the launcher';
    activity.state = 'Picking what to play';
    if (since) activity.timestamps = { start: since };
    return activity;
  }
  const inst = game.instance || {};
  const loader = LOADERS[inst.loader];
  activity.state = `Minecraft ${inst.mcVersion || ''}${loader ? ` · ${loader}` : ''}`.trim();
  activity.timestamps = { start: game.started || Date.now() };
  const joining = lan?.joining;
  if (!status) activity.details = 'Playing Minecraft';
  else if (status.where === 'menu') activity.details = 'In the menus';
  else if (status.where === 'singleplayer') activity.details = status.lan || lan?.hosting ? 'Hosting a world on Nimbus LAN' : 'Playing singleplayer';
  else if (joining && joining.status === 'playing') activity.details = `In ${joining.name}'s world on Nimbus LAN`;
  else {
    const host = showServer ? shownServer(status.server) : null;
    activity.details = host ? `Playing on ${host}` : 'Playing multiplayer';
  }
  return activity;
}

/** Keeps your Discord status in step with the launcher; call poke() whenever something changes. */
class DiscordStatus {
  /**
   * @param {object} opts
   * @param {object} opts.launcher the Launcher (settings, running games)
   * @param {object} [opts.lan] Nimbus LAN (hosting, joining, what the game reports)
   * @param {string} opts.version launcher version
   * @param {() => Promise<object>} opts.config {clientId, image, site}
   */
  constructor({ launcher, lan = null, version, config }) {
    this.launcher = launcher;
    this.lan = lan;
    this.version = version;
    this.config = config;
    this.since = Date.now();
    this.ipc = null;
    this.lastSent = null;
    this.sentAt = 0;
    this.triedAt = 0;
    this.timer = null;
    this.tick = null;
    this.busy = false;
    this.again = false;
    this.error = null;
  }

  start() {
    this.tick = setInterval(() => this.poke(0), 15_000);
    this.tick.unref?.();
    this.poke(0);
  }

  async stop() {
    clearInterval(this.tick);
    clearTimeout(this.timer);
    if (this.ipc) {
      await this.ipc.setActivity(null).catch(() => {});
      this.ipc.close();
      this.ipc = null;
    }
  }

  poke(delay = 300) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh().catch(() => {}), delay);
    this.timer.unref?.();
  }

  enabled() {
    return this.launcher.settings?.discordStatus !== false;
  }

  current(cfg) {
    const running = [...(this.launcher.running?.values?.() || [])][0];
    const game = running ? { instance: running.instance || running.inst || {}, started: running.started } : null;
    const lanState = this.lan?.state?.() || null;
    return activityFor({
      version: this.version,
      game,
      status: game ? this.lan?.gameStatus || null : null,
      lan: lanState,
      showServer: this.launcher.settings?.discordServer !== false,
      since: this.since,
      image: cfg.image || DEFAULT_IMAGE,
      site: cfg.site || DEFAULT_SITE,
    });
  }

  async refresh() {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    try {
      if (!this.enabled()) {
        if (this.ipc) {
          await this.ipc.setActivity(null).catch(() => {});
          this.ipc.close();
          this.ipc = null;
        }
        this.lastSent = null;
        return;
      }
      const cfg = (await this.config()) || {};
      if (!cfg.clientId) return;
      if (!this.ipc) {
        if (Date.now() - this.triedAt < RETRY_MS) return;
        this.triedAt = Date.now();
        const ipc = new DiscordIpc(cfg.clientId);
        try {
          await ipc.connect();
        } catch (err) {
          ipc.close();
          this.error = err.message;
          return;
        }
        ipc.on('close', () => { if (this.ipc === ipc) { this.ipc = null; this.lastSent = null; } });
        this.ipc = ipc;
        this.lastSent = null;
        this.error = null;
      }
      const activity = this.current(cfg);
      const key = JSON.stringify({ ...activity, timestamps: activity.timestamps ? { start: Math.round(activity.timestamps.start / 1000) } : null });
      if (key === this.lastSent) return;
      const wait = MIN_GAP_MS - (Date.now() - this.sentAt);
      if (wait > 0) { this.poke(wait + 50); return; }
      this.sentAt = Date.now();
      await this.ipc.setActivity(activity);
      this.lastSent = key;
    } catch (err) {
      this.error = err.message;
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.poke(); }
    }
  }
}

module.exports = { DiscordStatus, DiscordIpc, activityFor, shownServer, socketPaths };
