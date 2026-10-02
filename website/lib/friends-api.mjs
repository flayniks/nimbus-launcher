// The Nimbus friends service: sign-in (proved with Mojang, no passwords), friend
// requests, presence, chat and a small relay for Nimbus LAN (join requests and the
// WebRTC handshake). Storage is a key/value store with list-by-prefix; on Netlify that is
// Netlify Blobs, in tests a Map. Every write goes to its own key, so two launchers
// writing at the same time never overwrite each other.
import { createHash } from 'node:crypto';
import { newWallet, settle, buy, view, owns } from './coins.mjs';

const ONLINE_MS = 90_000;
const SESSION_MS = 30 * 24 * 3600_000;
const CHAT_KEEP = 200;
const RELAY_TYPES = new Set(['join-request', 'join-reply', 'join-cancel', 'signal']);
const COSMETIC_SLOTS = ['hat', 'pet', 'wings', 'aura'];
// pictures in chat: base64, checked by their first bytes; ~1.1 MB at most (the launcher sends less)
const IMAGE_TYPES = { 'image/jpeg': { magic: '/9j/' }, 'image/webp': { magic: 'UklGR' }, 'image/png': { magic: 'iVBORw0KGgo' } };
const IMAGE_MAX = 1_500_000;
const IMAGES_PER_DAY = 60;

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
const validInstall = (id) => typeof id === 'string' && /^[0-9a-f]{32}$/.test(id);
// bump to have every signed-in player's lookup keys written again on their next request
const INDEX_VERSION = 1;

/** The uuid an offline-mode server gives a player of this name (Java's UUID.nameUUIDFromBytes). */
export function offlineUuid(name) {
  const h = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  return h.toString('hex');
}

/** Runs `fn` over `items`, `n` at a time. */
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

/** What a banned player is told (never who banned them). */
const banView = (b) => (b ? { reason: b.reason || null, at: b.at, until: b.until || null } : null);
const banText = (b) => `You're banned from Nimbus${b.until ? ` until ${new Date(b.until).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}${b.reason ? `: ${b.reason}` : '.'}`;

/**
 * @param {object} deps
 * @param {{get(key): Promise<any>, set(key, value): Promise<void>, delete(key): Promise<void>, list(prefix): Promise<string[]>}} deps.store
 * @param {typeof fetch} [deps.fetch]
 * @param {boolean} [deps.devAuth] accept {uuid, name} without Mojang (local tests only)
 * @param {string} [deps.sessionServer] Mojang's session server
 * @param {string} [deps.profileApi] Mojang's name → uuid API
 * @param {string[]} [deps.admins] uuids of the accounts that may use the admin routes
 */
export function createApi({ store, fetch: doFetch = fetch, devAuth = false, sessionServer = 'https://sessionserver.mojang.com', profileApi = 'https://api.mojang.com', now = () => Date.now(), admins = [] }) {
  const ADMINS = new Set(admins.map(cleanUuid).filter(validUuid));
  const isAdmin = (uuid) => ADMINS.has(uuid);

  async function me(req) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const s = await store.get(`session/${token}`);
    if (!s || Date.now() - s.created > SESSION_MS) return null;
    return { ...s, token };
  }

  async function saveSession(who, patch) {
    const { token, ...s } = who;
    Object.assign(who, patch);
    await store.set(`session/${token}`, { ...s, ...patch });
  }

  /** A ban that is still running, or null (an expired one is cleared). */
  async function activeBan(key) {
    const b = await store.get(key);
    if (!b) return null;
    if (b.until && b.until <= now()) {
      await store.delete(key);
      return null;
    }
    return b;
  }

  /**
   * The keys games look players up by: their name (offline-mode servers rename uuids) and the
   * uuid an offline-mode server gives that name. Written once per session.
   */
  async function index(who) {
    await store.set(`username/${who.name.toLowerCase()}`, { uuid: who.uuid });
    await store.set(`offuuid/${offlineUuid(who.name)}`, { uuid: who.uuid, name: who.name });
    if (!(await store.get(`joined/${who.uuid}`))) await store.set(`joined/${who.uuid}`, { at: Date.now() });
  }

  /** Remembers which installs of the launcher an account uses, so a ban covers them too. */
  async function recordInstall(who, installId) {
    if (!validInstall(installId) || who.install === installId) return;
    const list = (await store.get(`installs/${who.uuid}`))?.ids || [];
    if (!list.includes(installId)) await store.set(`installs/${who.uuid}`, { ids: [installId, ...list].slice(0, 10) });
    await store.set(`install/${installId}`, { uuid: who.uuid, name: who.name, at: Date.now() });
    if (who.token) await saveSession(who, { install: installId });
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
      // a banned account, or a banned install of the launcher, gets no session
      const ban = (!isAdmin(profile.uuid) && await activeBan(`ban/${profile.uuid}`)) || (validInstall(body.installId) && !isAdmin(profile.uuid) && await activeBan(`baninstall/${body.installId}`));
      if (ban) return json({ error: banText(ban), banned: banView(ban) }, 403);
      const token = hex(32);
      await store.set(`session/${token}`, { ...profile, created: Date.now(), iv: INDEX_VERSION });
      const old = (await user(profile.uuid)) || {};
      await store.set(`user/${profile.uuid}`, { ...old, uuid: profile.uuid, name: profile.name, seen: Date.now() });
      await index(profile);
      await recordInstall({ ...profile, token }, body.installId);
      return json({ token, ...profile, admin: isAdmin(profile.uuid) });
    },

    // anyone may ask whether their launcher is banned: by its install id, and by account when signed in
    'POST ban/check': async (req, body) => {
      const who = await me(req);
      const ban = (who && !isAdmin(who.uuid) && await activeBan(`ban/${who.uuid}`)) || (validInstall(body.installId) && !(who && isAdmin(who.uuid)) && await activeBan(`baninstall/${body.installId}`));
      return json({ banned: banView(ban || null) });
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
      await recordInstall(who, body.installId);
      return json({ me: { uuid: who.uuid, name: who.name, admin: isAdmin(who.uuid) }, friends, requests, outgoing, inbox });
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
      return json({ ok: true, message: await post(who, to, { text }) });
    },
    // a picture (a screenshot, made small by the launcher), only for the two people in the chat
    'POST chat/image': async (req, body, who) => {
      const to = cleanUuid(body.to);
      if (!(await isFriend(who.uuid, to))) return fail(403, 'You can only chat with friends.');
      const type = IMAGE_TYPES[body.type];
      const data = String(body.data || '');
      if (!type || !data.startsWith(type.magic) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return fail(400, 'That is not a picture.');
      if (data.length > IMAGE_MAX) return fail(413, 'That picture is too big.');
      const w = Math.round(Number(body.w));
      const h = Math.round(Number(body.h));
      if (!(w >= 1 && w <= 8192 && h >= 1 && h <= 8192)) return fail(400, 'Bad picture size.');
      const day = new Date().toISOString().slice(0, 10);
      const count = (await store.get(`imgday/${who.uuid}/${day}`))?.n || 0;
      if (count >= IMAGES_PER_DAY) return fail(429, `That's ${IMAGES_PER_DAY} pictures today. More tomorrow!`);
      await store.set(`imgday/${who.uuid}/${day}`, { n: count + 1 });
      const id = hex(12);
      await store.set(`image/${id}`, { from: who.uuid, to, type: body.type, data, w, h, at: Date.now() });
      const text = String(body.text || '').trim().slice(0, 300);
      return json({ ok: true, message: await post(who, to, { text, image: { id, w, h } }) });
    },
    'POST chat/image/get': async (req, body, who) => {
      const id = String(body.id || '');
      const img = /^[0-9a-f]{24}$/.test(id) ? await store.get(`image/${id}`) : null;
      if (!img || (img.from !== who.uuid && img.to !== who.uuid)) return fail(404, 'That picture is gone.');
      return json({ type: img.type, data: img.data, w: img.w, h: img.h });
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
    // Everyone who plays with Nimbus is in the answer (that's how games know to show the Nimbus
    // badge), with nothing in their slots when they wear nothing. Found by their uuid; on an
    // offline-mode server by the uuid it made from their name; or by name.
    'POST cosmetics/get': async (req, body) => {
      const players = Array.isArray(body.players) ? body.players.slice(0, 80) : [];
      const banned = new Set((await store.list('ban/')).map((k) => k.split('/')[1]));
      const out = {};
      await Promise.all(players.map(async (p) => {
        const key = String(p?.uuid || p?.name || '');
        let uuid = p?.uuid ? cleanUuid(p.uuid) : null;
        if (uuid && !validUuid(uuid)) uuid = null;
        let found = uuid ? await store.get(`cosmetics/${uuid}`) : null;
        let nimbus = Boolean(found) || Boolean(uuid && await store.get(`user/${uuid}`));
        if (!nimbus && uuid) {
          const off = await store.get(`offuuid/${uuid}`);
          if (off) { uuid = off.uuid; nimbus = true; found = await store.get(`cosmetics/${uuid}`); }
        }
        if (!nimbus && typeof p?.name === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(p.name)) {
          const byName = (await store.get(`cosname/${p.name.toLowerCase()}`)) || (await store.get(`username/${p.name.toLowerCase()}`));
          if (byName) { uuid = byName.uuid; nimbus = true; found = await store.get(`cosmetics/${uuid}`); }
        }
        if (!nimbus || banned.has(uuid)) return;
        out[key] = Object.fromEntries(COSMETIC_SLOTS.map((s) => [s, found?.[s] || null]));
      }));
      return json({ cosmetics: out });
    },

    // ---- admins (by uuid, see createApi): everyone who uses Nimbus, and bans
    'POST admin/users': async () => {
      const t = now();
      const bans = new Map();
      for (const [k, b] of await mapLimit(await store.list('ban/'), 16, async (k) => [k, await store.get(k)])) {
        if (b && !(b.until && b.until <= t)) bans.set(k.split('/')[1], b);
      }
      const keys = (await store.list('user/')).slice(0, 5000);
      const users = await mapLimit(keys, 24, async (k) => {
        const uuid = k.split('/')[1];
        const [u, joined, w, inst] = await Promise.all([store.get(k), store.get(`joined/${uuid}`), store.get(`wallet/${uuid}`), store.get(`installs/${uuid}`)]);
        if (!u) return null;
        const online = t - (u.seen || 0) < ONLINE_MS;
        return {
          uuid, name: u.name || uuid, seen: u.seen || 0, online,
          status: online ? u.status || 'online' : 'offline', playing: online ? u.playing || null : null, hosting: online ? u.hosting || null : null,
          joined: joined?.at || null, coins: w ? w.coins ?? null : null, installs: inst?.ids?.length || 0,
          admin: isAdmin(uuid), banned: bans.has(uuid) ? { ...banView(bans.get(uuid)), by: bans.get(uuid).by || null } : null,
        };
      });
      const list = users.filter(Boolean);
      // banned before they ever signed in (banned by name)
      for (const [uuid, b] of bans) {
        if (!list.some((x) => x.uuid === uuid)) list.push({ uuid, name: b.name || uuid, seen: 0, online: false, status: 'offline', playing: null, hosting: null, joined: null, coins: null, installs: 0, admin: false, banned: { ...banView(b), by: b.by || null } });
      }
      list.sort((a, b) => Number(b.online) - Number(a.online) || b.seen - a.seen);
      return json({
        users: list,
        stats: {
          total: list.filter((x) => x.seen).length,
          online: list.filter((x) => x.online).length,
          playing: list.filter((x) => x.online && (x.status === 'playing' || x.hosting)).length,
          banned: bans.size,
          newToday: list.filter((x) => x.joined && t - x.joined < 24 * 3600_000).length,
        },
        at: t,
      });
    },
    'POST admin/ban': async (req, body, who) => {
      let target = null;
      if (body.uuid) {
        const uuid = cleanUuid(body.uuid);
        if (!validUuid(uuid)) return fail(400, 'Bad uuid.');
        target = { uuid, name: (await user(uuid))?.name || String(body.name || '').slice(0, 16) || uuid };
      } else {
        const name = String(body.name || '').trim();
        if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return fail(400, 'That is not a Minecraft name.');
        target = await lookupName(name);
        if (!target) return fail(404, `There is no Minecraft player called ${name}.`);
      }
      if (isAdmin(target.uuid)) return fail(400, target.uuid === who.uuid ? "You can't ban yourself." : "Admins can't be banned.");
      const days = Number(body.days) || 0;
      const ban = {
        name: target.name,
        reason: String(body.reason || '').trim().slice(0, 200) || null,
        at: now(),
        until: days > 0 ? now() + Math.min(days, 3650) * 24 * 3600_000 : null,
        by: who.name,
      };
      await store.set(`ban/${target.uuid}`, ban);
      // and every install of the launcher this account was used on
      const installs = (await store.get(`installs/${target.uuid}`))?.ids || [];
      for (const id of installs) await store.set(`baninstall/${id}`, { ...ban, uuid: target.uuid });
      return json({ ok: true, uuid: target.uuid, name: target.name, installs: installs.length, ban: banView(ban) });
    },
    'POST admin/unban': async (req, body) => {
      const uuid = cleanUuid(body.uuid);
      if (!validUuid(uuid)) return fail(400, 'Bad uuid.');
      await store.delete(`ban/${uuid}`);
      for (const id of (await store.get(`installs/${uuid}`))?.ids || []) {
        const b = await store.get(`baninstall/${id}`);
        if (!b || b.uuid === uuid) await store.delete(`baninstall/${id}`);
      }
      return json({ ok: true });
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

  /** Saves a chat message, hands it to `to` and keeps the history short (pictures go with their messages). */
  async function post(who, to, content) {
    const message = { from: who.uuid, name: who.name, to, ...content, at: Date.now() };
    await store.set(`chat/${pair(who.uuid, to)}/${stamp()}`, message);
    await deliver(to, { type: 'chat', ...message });
    const keys = (await store.list(`chat/${pair(who.uuid, to)}/`)).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - CHAT_KEEP))) {
      const m = await store.get(old);
      if (m?.image?.id) await store.delete(`image/${m.image.id}`);
      await store.delete(old);
    }
    return message;
  }

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
      if (path.startsWith('login/') || path === 'cosmetics/get' || path === 'ban/check') return await route(req, body, null);
      const who = await me(req);
      if (!who) return fail(401, 'Sign in again.');
      if (!isAdmin(who.uuid)) {
        const ban = (await activeBan(`ban/${who.uuid}`)) || (path === 'beat' && validInstall(body.installId) && (await activeBan(`baninstall/${body.installId}`)));
        if (ban) return json({ error: banText(ban), banned: banView(ban) }, 403);
      }
      if (path.startsWith('admin/') && !isAdmin(who.uuid)) return fail(403, 'Only Nimbus admins can do that.');
      if (who.iv !== INDEX_VERSION) {
        await index(who);
        await saveSession(who, { iv: INDEX_VERSION });
      }
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
