'use strict';
// Nimbus LAN: play in a friend's singleplayer world over the internet, with their say-so.
//
//   host (in game)  Nimbus Core opens the world on a local port and tells the launcher
//                   through a small local HTTP "bridge". Friends see "Hosting".
//   friend          presses Join → a join request goes to the host through the friends
//                   service → Nimbus Core shows "NICK wants to join your world" → Y or N.
//   yes             the two launchers connect directly with WebRTC (the handshake travels
//                   through the friends service). The friend's launcher opens a local port,
//                   starts their Minecraft pointed at it, and every TCP connection is carried
//                   over a data channel to the host's world. No port forwarding, no server.
const EventEmitter = require('events');
const http = require('http');
const net = require('net');
const crypto = require('crypto');

const ASK_TIMEOUT = 90_000;
const CONNECT_TIMEOUT = 30_000;

class Lan extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.launcher
   * @param {object} opts.friends the Friends client (relay + incoming messages)
   * @param {() => {send(msg: object): void}} opts.netWindow the hidden WebRTC window, made on demand
   */
  constructor({ launcher, friends, netWindow }) {
    super();
    this.launcher = launcher;
    this.friends = friends;
    this.netWindow = netWindow;
    this.hosting = null; // { port, world, mc, loader }
    this.events = []; // waiting for Nimbus Core to collect
    this.requests = new Map(); // host: id -> { from, name, at, timer }
    this.approved = new Map(); // host: id -> { from, name }
    this.joining = null; // joiner: { id, to, name, status, address, error }
    this.waiters = new Map(); // id:kind -> resolve
    this.sessions = new Map(); // sid -> { role, sockets: Map(cid -> socket), server }
    this.seq = 0;
    friends.on('message', (m) => this.onMessage(m).catch(() => {}));
    launcher.on('game-state', (e) => {
      if (!e.running && launcher.running.size === 0 && this.hosting) this.stopHosting();
    });
  }

  // ------------------------------------------------------------------ the bridge to Nimbus Core
  async startBridge() {
    const token = crypto.randomBytes(16).toString('hex');
    this.server = http.createServer((req, res) => this.bridgeRequest(req, res, token).catch((err) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }));
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.launcher.bridgeUrl = `http://127.0.0.1:${this.server.address().port}/${token}`;
    return this.launcher.bridgeUrl;
  }

  async bridgeRequest(req, res, token) {
    const [, t, action] = req.url.split('?')[0].split('/');
    const reply = (data, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (t !== token) return reply({ error: 'no' }, 403);
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { body = {}; }
    }
    if (action === 'host' && req.method === 'POST') {
      this.hosting = {
        port: Number(body.port) || 0,
        world: String(body.world || 'World').slice(0, 60),
        mc: String(body.mc || ''),
        loader: String(body.loader || ''),
      };
      this.friends.hot(20_000);
      this.changed();
      return reply({ ok: true });
    }
    if (action === 'unhost' && req.method === 'POST') {
      this.stopHosting();
      return reply({ ok: true });
    }
    if (action === 'events') {
      const out = this.events.splice(0);
      return reply({ events: out, hosting: Boolean(this.hosting) });
    }
    if (action === 'decide' && req.method === 'POST') {
      await this.decide(String(body.id || ''), Boolean(body.allow));
      return reply({ ok: true });
    }
    return reply({ error: 'unknown' }, 404);
  }

  hostingInfo() {
    return this.hosting ? { mc: this.hosting.mc, loader: this.hosting.loader, world: this.hosting.world } : null;
  }

  stopHosting() {
    this.hosting = null;
    for (const r of this.requests.values()) clearTimeout(r.timer);
    this.requests.clear();
    for (const [sid, s] of this.sessions) if (s.role === 'host') this.closeSession(sid);
    this.friends.hot(20_000);
    this.changed();
  }

  state() {
    return {
      hosting: this.hostingInfo(),
      requests: [...this.requests.entries()].map(([id, r]) => ({ id, uuid: r.from, name: r.name, at: r.at })),
      guests: [...this.approved.values()].map((a) => a.name),
      joining: this.joining ? { ...this.joining } : null,
    };
  }

  changed() {
    this.emit('state', this.state());
  }

  // ------------------------------------------------------------------ messages from friends
  async onMessage(m) {
    const data = m.data || {};
    if (m.type === 'join-request') {
      if (!this.hosting) {
        await this.friends.relay(m.from, 'join-reply', { id: data.id, allow: false, reason: `${this.friends.state.me?.name || 'They'} is not hosting a world right now.` });
        return;
      }
      const id = String(data.id);
      const timer = setTimeout(() => this.decide(id, false, 'They did not answer in time.').catch(() => {}), ASK_TIMEOUT);
      this.requests.set(id, { from: m.from, name: m.name, at: Date.now(), timer });
      this.events.push({ type: 'join-request', id, name: m.name, uuid: m.from });
      this.changed();
      this.emit('request', { id, name: m.name });
      return;
    }
    if (m.type === 'join-cancel') {
      const r = this.requests.get(String(data.id));
      if (r) {
        clearTimeout(r.timer);
        this.requests.delete(String(data.id));
        this.events.push({ type: 'join-cancel', id: String(data.id), name: m.name });
        this.changed();
      }
      return;
    }
    if (m.type === 'join-reply') {
      this.resolve(`${data.id}:reply`, data);
      return;
    }
    if (m.type === 'signal') {
      if (data.role === 'offer' && this.approved.has(String(data.id))) {
        await this.answerOffer(String(data.id), m.from, data.sdp);
      } else if (data.role === 'answer') {
        this.resolve(`${data.id}:answer`, data);
      }
    }
  }

  /** The host said yes or no (in game, or in the launcher). */
  async decide(id, allow, reason = null) {
    const r = this.requests.get(id);
    if (!r) return;
    clearTimeout(r.timer);
    this.requests.delete(id);
    if (allow && this.hosting) {
      this.approved.set(id, { from: r.from, name: r.name });
      this.events.push({ type: 'joining', id, name: r.name });
    }
    await this.friends.relay(r.from, 'join-reply', {
      id, allow: Boolean(allow && this.hosting), reason: allow ? null : reason || `${this.friends.state.me?.name || 'The host'} said no.`,
      mc: this.hosting?.mc, loader: this.hosting?.loader, world: this.hosting?.world,
    });
    this.changed();
  }

  // ------------------------------------------------------------------ joining a friend
  async join(uuid) {
    if (this.joining && !['failed', 'done', 'cancelled'].includes(this.joining.status)) throw new Error('Already joining someone.');
    const friend = (this.friends.state.friends || []).find((f) => f.uuid === uuid);
    if (!friend) throw new Error('That friend is not in your list.');
    if (!friend.hosting) throw new Error(`${friend.name} is not hosting a world right now.`);
    const id = crypto.randomBytes(8).toString('hex');
    this.joining = { id, to: uuid, name: friend.name, world: friend.hosting.world, mc: friend.hosting.mc, status: 'asking' };
    this.changed();
    this.run(id, friend).catch((err) => {
      if (this.joining?.id !== id) return;
      this.joining = { ...this.joining, status: 'failed', error: err.message };
      this.closeSession(id);
      this.changed();
    });
    return this.state();
  }

  async cancelJoin() {
    const j = this.joining;
    if (!j) return this.state();
    if (j.status === 'asking') await this.friends.relay(j.to, 'join-cancel', { id: j.id }).catch(() => {});
    this.closeSession(j.id);
    this.resolve(`${j.id}:reply`, { allow: false, reason: 'cancelled' });
    this.joining = { ...j, status: 'cancelled' };
    this.changed();
    return this.state();
  }

  async run(id, friend) {
    const step = (patch) => {
      if (this.joining?.id !== id) throw new Error('cancelled');
      this.joining = { ...this.joining, ...patch };
      this.changed();
    };
    await this.friends.relay(friend.uuid, 'join-request', { id });
    const reply = await this.wait(`${id}:reply`, ASK_TIMEOUT + 10_000, `${friend.name} did not answer.`);
    if (!reply.allow) throw new Error(reply.reason === 'cancelled' ? 'cancelled' : reply.reason || `${friend.name} said no.`);
    step({ status: 'connecting', mc: reply.mc || friend.hosting.mc, loader: reply.loader || friend.hosting.loader });

    // WebRTC: offer → (friends service) → answer
    const session = { role: 'join', to: friend.uuid, sockets: new Map(), server: null, paused: new Set() };
    this.sessions.set(id, session);
    const connected = new Promise((resolve, reject) => { session.onState = (s) => (s === 'connected' ? resolve() : s === 'failed' ? reject(new Error(`Could not reach ${friend.name}'s computer. One of your networks blocks direct connections.`)) : null); });
    const local = new Promise((resolve) => { session.onLocalSdp = resolve; });
    this.cmd({ type: 'offer', sid: id });
    const offer = await local;
    await this.friends.relay(friend.uuid, 'signal', { id, role: 'offer', sdp: offer });
    const answer = await this.wait(`${id}:answer`, CONNECT_TIMEOUT, `${friend.name}'s launcher did not answer.`);
    this.cmd({ type: 'remote-sdp', sid: id, sdp: answer.sdp });
    await Promise.race([connected, new Promise((_, rej) => setTimeout(() => rej(new Error(`Could not reach ${friend.name}'s computer.`)), CONNECT_TIMEOUT))]);

    // a local address Minecraft can connect to; each connection rides its own data channel
    session.server = net.createServer((socket) => this.carry(id, socket));
    await new Promise((resolve) => session.server.listen(0, '127.0.0.1', resolve));
    const address = `127.0.0.1:${session.server.address().port}`;
    step({ status: 'starting', address });

    // start the matching Minecraft pointed at that address
    if (process.env.NIMBUS_LAN_NO_LAUNCH === '1') {
      step({ status: 'ready', note: `Connect to ${address}` });
      return;
    }
    const inst = await this.pickInstance(this.joining.mc, this.joining.loader);
    if (this.launcher.running.size > 0) {
      step({ status: 'ready', note: `Minecraft is already open: Multiplayer → Direct Connection → ${address}` });
      return;
    }
    step({ status: 'starting', instanceId: inst.id, instanceName: inst.name });
    await this.launcher.launch(inst.id, { joinServer: address });
    step({ status: 'playing' });
  }

  /** An instance on the host's Minecraft version (same loader if we have one), made if missing. */
  async pickInstance(mc, loader) {
    const all = await this.launcher.instances.list();
    const same = all.filter((i) => i.mcVersion === mc);
    const pick = same.find((i) => i.loader === loader) || same.find((i) => i.loader === 'fabric' || i.loader === 'quilt') || same[0];
    if (pick) return pick;
    return this.launcher.instances.create({ name: `Nimbus LAN ${mc}`, mcVersion: mc, loader: loader === 'fabric' || loader === 'quilt' ? loader : 'vanilla' });
  }

  // ------------------------------------------------------------------ hosting: the other end
  async answerOffer(id, from, sdp) {
    if (!this.hosting) return;
    const session = { role: 'host', to: from, sockets: new Map(), paused: new Set() };
    this.sessions.set(id, session);
    const local = new Promise((resolve) => { session.onLocalSdp = resolve; });
    this.cmd({ type: 'answer', sid: id, sdp });
    const answer = await local;
    await this.friends.relay(from, 'signal', { id, role: 'answer', sdp: answer });
  }

  // ------------------------------------------------------------------ bytes both ways
  carry(sid, socket) {
    const session = this.sessions.get(sid);
    if (!session) return socket.destroy();
    const cid = `tcp:${++this.seq}`;
    session.sockets.set(cid, socket);
    socket.pause(); // until the channel is open
    this.cmd({ type: 'open-channel', sid, cid });
    this.pipeSocket(sid, cid, socket);
  }

  pipeSocket(sid, cid, socket) {
    socket.on('data', (data) => this.cmd({ type: 'send', sid, cid, data: new Uint8Array(data) }));
    socket.on('close', () => {
      this.sessions.get(sid)?.sockets.delete(cid);
      this.cmd({ type: 'close-channel', sid, cid });
    });
    socket.on('error', () => socket.destroy());
  }

  /** Events from the WebRTC window. */
  netEvent(msg) {
    const session = this.sessions.get(msg.sid);
    if (!session) return;
    switch (msg.type) {
      case 'local-sdp': session.onLocalSdp?.(msg.sdp); break;
      case 'state':
        session.onState?.(msg.state);
        if (['failed', 'closed'].includes(msg.state) && session.role === 'join' && this.joining?.id === msg.sid && ['ready', 'playing', 'starting'].includes(this.joining.status)) {
          this.joining = { ...this.joining, status: 'failed', error: 'The connection to your friend dropped.' };
          this.changed();
        }
        break;
      case 'channel': {
        // the joiner opened a channel: connect it to the world
        if (session.role !== 'host' || !msg.cid.startsWith('tcp:') || !this.hosting) return;
        const socket = net.connect(this.hosting.port, '127.0.0.1');
        session.sockets.set(msg.cid, socket);
        this.pipeSocket(msg.sid, msg.cid, socket);
        break;
      }
      case 'channel-open': session.sockets.get(msg.cid)?.resume(); break;
      case 'data': session.sockets.get(msg.cid)?.write(Buffer.from(msg.data)); break;
      case 'pause': session.sockets.get(msg.cid)?.pause(); break;
      case 'resume': session.sockets.get(msg.cid)?.resume(); break;
      case 'channel-closed': session.sockets.get(msg.cid)?.end(); break;
      default:
    }
  }

  cmd(msg) {
    this.netWindow().send(msg);
  }

  closeSession(sid) {
    const s = this.sessions.get(sid);
    if (!s) return;
    for (const sock of s.sockets.values()) sock.destroy();
    s.server?.close();
    this.sessions.delete(sid);
    try { this.cmd({ type: 'close', sid }); } catch { /* window gone */ }
  }

  wait(key, ms, message) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiters.delete(key); reject(new Error(message)); }, ms);
      this.waiters.set(key, (v) => { clearTimeout(t); resolve(v); });
    });
  }

  resolve(key, value) {
    const fn = this.waiters.get(key);
    if (fn) {
      this.waiters.delete(key);
      fn(value);
    }
  }
}

module.exports = { Lan };
