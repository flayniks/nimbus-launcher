// The Nimbus friends service: sign-in (proved with Mojang, no passwords), friend
// requests, presence, chat and a small relay for Nimbus LAN (join requests and the
// WebRTC handshake). Storage is a key/value store with list-by-prefix; on Netlify that is
// Netlify Blobs, in tests a Map. Every write goes to its own key, so two launchers
// writing at the same time never overwrite each other.
import { newWallet, settle, buy, view, owns } from './coins.mjs';

const ONLINE_MS = 90_000;
const SESSION_MS = 30 * 24 * 3600_000;
const CHAT_KEEP = 200;
const RELAY_TYPES = new Set(['join-request', 'join-reply', 'join-cancel', 'signal']);
const COSMETIC_SLOTS = ['hat', 'pet', 'wings', 'aura'];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
});
const fail = (status, error) => json({ error }, status);
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const stamp = () => `${Date.now().toString(36).padStart(9, '0')}-${hex(3)}`;
const pair = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const cleanUuid = (u) => String(u || '').toLowerCase().replace(/-/g, '');
const validUuid = (u) => /^[0-9a-f]{32}$/.test(u);

/**
 * @param {object} deps
 * @param {{get(key): Promise<any>, set(key, value): Promise<void>, delete(key): Promise<void>, list(prefix): Promise<string[]>}} deps.store
 * @param {typeof fetch} [deps.fetch]
 * @param {boolean} [deps.devAuth] accept {uuid, name} without Mojang (local tests only)
 * @param {string} [deps.sessionServer] Mojang's session server
 * @param {string} [deps.profileApi] Mojang's name → uuid API
 */
export function createApi({ store, fetch: doFetch = fetch, devAuth = false, sessionServer = 'https://sessionserver.mojang.com', profileApi = 'https://api.mojang.com', now = () => Date.now() }) {
  async function me(req) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const s = await store.get(`session/${token}`);
    if (!s || Date.now() - s.created > SESSION_MS) return null;
    return s;
  }

  async function user(uuid) {
    return (await store.get(`user/${uuid}`)) || null;
  }

  async function friendsOf(uuid) {
    return (await store.list(`friend/${uuid}/`)).map((k) => k.split('/')[2]);
  }

  async function isFriend(a, b) {
    return Boolean(await store.get(`friend/${a}/${b}`));
  }

  async function lookupName(name) {
    const r = await doFetch(`${profileApi}/users/profiles/minecraft/${encodeURIComponent(name)}`);
    if (r.status === 404 || r.status === 204) return null;
    if (!r.ok) throw new Error('Mojang did not answer. Try again in a moment.');
    const p = await r.json();
    return { uuid: cleanUuid(p.id), name: p.name };
  }

  async function wallet(uuid) {
    return (await store.get(`wallet/${uuid}`)) || newWallet();
  }

  /** Loads the wallet, applies `change`, pays out whatever is due, saves, and answers with the lot. */
  async function withWallet(who, change = () => null, report = null) {
    const w = await wallet(who.uuid);
    const extra = change(w) || {};
    const t = now();
    const events = settle(w, who.uuid, t, report);
    await store.set(`wallet/${who.uuid}`, w);
    return json({ ...view(w, who.uuid, t), events, ...extra });
  }

  async function deliver(to, message) {
    await store.set(`inbox/${to}/${stamp()}`, { ...message, at: Date.now() });
  }

  const routes = {
    // ---- sign in: the launcher proves it owns the account through Mojang's session server
    'POST login/start': async () => {
      const serverId = hex(16);
      await store.set(`challenge/${serverId}`, { created: Date.now() });
      return json({ serverId });
    },
    'POST login/finish': async (req, body) => {
      let profile;
      if (devAuth && body.dev) {
        profile = { uuid: cleanUuid(body.uuid), name: String(body.name || '') };
      } else {
        const challenge = await store.get(`challenge/${body.serverId}`);
        if (!challenge || Date.now() - challenge.created > 120_000) return fail(400, 'That sign-in took too long. Try again.');
        await store.delete(`challenge/${body.serverId}`);
        const r = await doFetch(`${sessionServer}/session/minecraft/hasJoined?username=${encodeURIComponent(body.name)}&serverId=${encodeURIComponent(body.serverId)}`);
        if (r.status !== 200) return fail(401, 'Mojang could not confirm this account. Sign in to the launcher again.');
        const p = await r.json();
        profile = { uuid: cleanUuid(p.id), name: p.name };
      }
      if (!validUuid(profile.uuid) || !/^[A-Za-z0-9_]{1,16}$/.test(profile.name)) return fail(400, 'Bad account.');
      const token = hex(32);
      await store.set(`session/${token}`, { ...profile, created: Date.now() });
      const old = (await user(profile.uuid)) || {};
      await store.set(`user/${profile.uuid}`, { ...old, uuid: profile.uuid, name: profile.name, seen: Date.now() });
      return json({ token, ...profile });
    },

    // ---- one call per poll: says "I'm here", returns friends, requests and new messages
    'POST beat': async (req, body, who) => {
      const now = Date.now();
      const status = {
        uuid: who.uuid, name: who.name, seen: now,
        status: ['online', 'playing', 'away'].includes(body.status) ? body.status : 'online',
        playing: body.playing ? { mc: String(body.playing.mc || '').slice(0, 20), loader: String(body.playing.loader || '').slice(0, 12) } : null,
        hosting: body.hosting ? { mc: String(body.hosting.mc || '').slice(0, 20), loader: String(body.hosting.loader || '').slice(0, 12), world: String(body.hosting.world || '').slice(0, 60) } : null,
      };
      await store.set(`user/${who.uuid}`, status);
      const friends = [];
      for (const uuid of await friendsOf(who.uuid)) {
        const u = await user(uuid);
        const online = Boolean(u && now - (u.seen || 0) < ONLINE_MS);
        friends.push({ uuid, name: u?.name || uuid, online, status: online ? u.status : 'offline', playing: online ? u.playing : null, hosting: online ? u.hosting : null, seen: u?.seen || 0 });
      }
      const requests = [];
      for (const key of await store.list(`request/${who.uuid}/`)) {
        const r = await store.get(key);
        if (r) requests.push({ uuid: key.split('/')[2], name: r.name, at: r.at });
      }
      const outgoing = [];
      for (const key of await store.list(`sent/${who.uuid}/`)) {
        const r = await store.get(key);
        if (r) outgoing.push({ uuid: key.split('/')[2], name: r.name, at: r.at });
      }
      const inbox = [];
      for (const key of (await store.list(`inbox/${who.uuid}/`)).sort()) {
        const m = await store.get(key);
        if (m) inbox.push(m);
        await store.delete(key);
      }
      return json({ me: { uuid: who.uuid, name: who.name }, friends, requests, outgoing, inbox });
    },

    // ---- friends
    'POST friends/add': async (req, body, who) => {
      const name = String(body.name || '').trim();
      if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return fail(400, 'That is not a Minecraft name.');
      const target = await lookupName(name);
      if (!target) return fail(404, `There is no Minecraft player called ${name}.`);
      if (target.uuid === who.uuid) return fail(400, "That's you!");
      if (await isFriend(who.uuid, target.uuid)) return json({ status: 'friends', ...target });
      // they already asked us: that makes us friends
      if (await store.get(`request/${who.uuid}/${target.uuid}`)) {
        await befriend(who, target);
        return json({ status: 'friends', ...target });
      }
      await store.set(`request/${target.uuid}/${who.uuid}`, { name: who.name, at: Date.now() });
      await store.set(`sent/${who.uuid}/${target.uuid}`, { name: target.name, at: Date.now() });
      await deliver(target.uuid, { type: 'friend-request', from: who.uuid, name: who.name });
      return json({ status: 'sent', ...target });
    },
    'POST friends/accept': async (req, body, who) => {
      const from = cleanUuid(body.uuid);
      const r = await store.get(`request/${who.uuid}/${from}`);
      if (!r) return fail(404, 'That request is gone.');
      await befriend(who, { uuid: from, name: r.name });
      return json({ status: 'friends' });
    },
    'POST friends/decline': async (req, body, who) => {
      const from = cleanUuid(body.uuid);
      await store.delete(`request/${who.uuid}/${from}`);
      await store.delete(`sent/${from}/${who.uuid}`);
      return json({ status: 'declined' });
    },
    'POST friends/cancel': async (req, body, who) => {
      const to = cleanUuid(body.uuid);
      await store.delete(`request/${to}/${who.uuid}`);
      await store.delete(`sent/${who.uuid}/${to}`);
      return json({ status: 'cancelled' });
    },
    'POST friends/remove': async (req, body, who) => {
      const other = cleanUuid(body.uuid);
      await store.delete(`friend/${who.uuid}/${other}`);
      await store.delete(`friend/${other}/${who.uuid}`);
      return json({ status: 'removed' });
    },

    // ---- chat
    'POST chat/send': async (req, body, who) => {
      const to = cleanUuid(body.to);
      const text = String(body.text || '').trim().slice(0, 1000);
      if (!text) return fail(400, 'Empty message.');
      if (!(await isFriend(who.uuid, to))) return fail(403, 'You can only chat with friends.');
      const message = { from: who.uuid, name: who.name, to, text, at: Date.now() };
      const key = `chat/${pair(who.uuid, to)}/${stamp()}`;
      await store.set(key, message);
      await deliver(to, { type: 'chat', ...message });
      // keep the history short
      const keys = (await store.list(`chat/${pair(who.uuid, to)}/`)).sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - CHAT_KEEP))) await store.delete(old);
      return json({ ok: true, message });
    },
    'POST chat/history': async (req, body, who) => {
      const other = cleanUuid(body.with);
      if (!(await isFriend(who.uuid, other))) return fail(403, 'You can only chat with friends.');
      const keys = (await store.list(`chat/${pair(who.uuid, other)}/`)).sort().slice(-50);
      const messages = [];
      for (const k of keys) {
        const m = await store.get(k);
        if (m) messages.push(m);
      }
      return json({ messages });
    },

    // ---- cosmetics: what each player wears, for every Nimbus player to see
    'POST cosmetics/set': async (req, body, who) => {
      const worn = {};
      for (const slot of COSMETIC_SLOTS) {
        const id = body[slot];
        if (id === null || id === undefined || id === '') worn[slot] = null;
        else if (typeof id === 'string' && /^[a-z0-9_]{2,40}$/.test(id)) worn[slot] = id;
        else return fail(400, `Bad ${slot}.`);
      }
      // only what you've unlocked (or what's free) is shown to others
      const w = await store.get(`wallet/${who.uuid}`);
      const locked = [];
      for (const slot of COSMETIC_SLOTS) {
        if (worn[slot] && !owns(w, worn[slot])) {
          locked.push(worn[slot]);
          worn[slot] = null;
        }
      }
      await store.set(`cosmetics/${who.uuid}`, { name: who.name, ...worn, at: Date.now() });
      await store.set(`cosname/${who.name.toLowerCase()}`, { uuid: who.uuid });
      return json({ ok: true, worn, locked });
    },

    // ---- Nimbus coins (website/lib/coins.mjs)
    'POST coins/state': (req, body, who) => withWallet(who),
    'POST coins/progress': (req, body, who) => withWallet(who, () => null, { day: String(body.day || ''), stats: body.stats }),
    'POST coins/buy': (req, body, who) => withWallet(who, (w) => {
      const id = String(body.id || '');
      buy(w, id);
      return { bought: id };
    }),
    // anyone may look: the game asks about the players around it, by uuid (or by name on
    // offline-mode servers, where uuids aren't the real ones)
    'POST cosmetics/get': async (req, body) => {
      const players = Array.isArray(body.players) ? body.players.slice(0, 80) : [];
      const out = {};
      await Promise.all(players.map(async (p) => {
        const key = String(p?.uuid || p?.name || '');
        let uuid = p?.uuid ? cleanUuid(p.uuid) : null;
        let found = uuid && validUuid(uuid) ? await store.get(`cosmetics/${uuid}`) : null;
        if (!found && typeof p?.name === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(p.name)) {
          const byName = await store.get(`cosname/${p.name.toLowerCase()}`);
          if (byName) { uuid = byName.uuid; found = await store.get(`cosmetics/${uuid}`); }
        }
        if (found) out[key] = Object.fromEntries(COSMETIC_SLOTS.map((s) => [s, found[s] || null]));
      }));
      return json({ cosmetics: out });
    },

    // ---- relay for Nimbus LAN: join requests, answers and the WebRTC handshake
    'POST relay': async (req, body, who) => {
      const to = cleanUuid(body.to);
      if (!RELAY_TYPES.has(body.type)) return fail(400, 'Unknown message.');
      if (!(await isFriend(who.uuid, to))) return fail(403, 'Only friends can join each other.');
      const data = body.data ?? null;
      if (JSON.stringify(data).length > 64_000) return fail(413, 'Too big.');
      await deliver(to, { type: body.type, from: who.uuid, name: who.name, data });
      return json({ ok: true });
    },
  };

  async function befriend(a, b) {
    const at = Date.now();
    await store.set(`friend/${a.uuid}/${b.uuid}`, { at });
    await store.set(`friend/${b.uuid}/${a.uuid}`, { at });
    await store.delete(`request/${a.uuid}/${b.uuid}`);
    await store.delete(`request/${b.uuid}/${a.uuid}`);
    await store.delete(`sent/${a.uuid}/${b.uuid}`);
    await store.delete(`sent/${b.uuid}/${a.uuid}`);
    await deliver(b.uuid, { type: 'friend-added', from: a.uuid, name: a.name });
  }

  return async function handle(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' } });
    }
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*?\/api\//, '').replace(/\/+$/, '');
    if (req.method === 'GET' && (path === '' || path === 'health')) return json({ ok: true, service: 'nimbus-friends' });
    const route = routes[`${req.method} ${path}`];
    if (!route) return fail(404, 'Not found.');
    let body = {};
    try { body = req.method === 'POST' ? await req.json() : {}; } catch { return fail(400, 'Bad JSON.'); }
    try {
      if (path.startsWith('login/') || path === 'cosmetics/get') return await route(req, body, null);
      const who = await me(req);
      if (!who) return fail(401, 'Sign in again.');
      return await route(req, body, who);
    } catch (err) {
      if (err.player) return fail(400, err.message);
      return fail(500, err.message || 'Something went wrong.');
    }
  };
}

/** A Map-backed store with the same shape as the Netlify one, for tests. */
export function memoryStore() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : null; },
    async set(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { m.delete(k); },
    async list(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
    size: () => m.size,
  };
}
