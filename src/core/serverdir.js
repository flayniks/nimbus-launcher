'use strict';
// Finding servers: a built-in list of well-known public Java servers, Minehut's live list of
// player-run servers, and any address typed into the search. Results are pinged by the page, so
// players, version and ping are always live.
const { parseAddress } = require('./servers');

// Every address here answered a status check when the list was made. `tags` are what the
// search matches besides the name.
const DIRECTORY = require('./serverdir.json');

const MINEHUT_API = 'https://api.minehut.com/servers';
const MINEHUT_TTL = 2 * 60_000;
let minehutCache = { at: 0, list: null, pending: null };

/** Minehut writes its MOTDs in MiniMessage ("<gradient:#f00:#0f0>Name</gradient>"); plain text is enough here. */
function plainMotd(s) {
  return String(s || '')
    .replace(/<[^<>]*>/g, '')
    .replace(/[§&][0-9a-fk-orx]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const title = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Minehut's online servers, cached for a couple of minutes. */
async function minehut({ fetchImpl = fetch } = {}) {
  if (minehutCache.list && Date.now() - minehutCache.at < MINEHUT_TTL) return minehutCache.list;
  if (minehutCache.pending) return minehutCache.pending;
  minehutCache.pending = (async () => {
    try {
      const res = await fetchImpl(MINEHUT_API, { headers: { accept: 'application/json', 'user-agent': 'NimbusLauncher' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Minehut answered ${res.status}.`);
      const data = await res.json();
      const list = (data.servers || [])
        .filter((s) => s && typeof s.name === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s.name) && s.visibility !== false && s.connectable !== false && s.staticInfo?.platform !== 'bedrock')
        .map((s) => ({
          name: s.name,
          address: `${s.name.toLowerCase()}.minehut.gg`,
          tags: (s.allCategories || []).filter((c) => typeof c === 'string').slice(0, 6).map(title),
          players: Number(s.playerData?.playerCount) || 0,
          motd: plainMotd(s.motd).slice(0, 160),
          source: 'minehut',
        }));
      minehutCache = { at: Date.now(), list, pending: null };
      return list;
    } catch (err) {
      minehutCache.pending = null;
      throw err;
    }
  })();
  return minehutCache.pending;
}

/**
 * How well `entry` fits the search words (0 = not at all). Every word has to be found in the
 * name, address, tags or description.
 */
function score(entry, words) {
  const name = entry.name.toLowerCase();
  const address = entry.address.toLowerCase();
  const tags = (entry.tags || []).map((t) => t.toLowerCase());
  const motd = String(entry.motd || '').toLowerCase();
  const squash = (s) => s.replace(/[^a-z0-9]/g, '');
  let total = 0;
  for (const w of words) {
    const sw = squash(w);
    let best = 0;
    if (name === w || squash(name) === sw) best = 120;
    else if (name.startsWith(w)) best = 90;
    else if (name.includes(w) || (sw.length > 2 && squash(name).includes(sw))) best = 60;
    if (tags.some((t) => t === w || squash(t) === sw)) best = Math.max(best, 55);
    else if (tags.some((t) => t.includes(w) || (sw.length > 2 && squash(t).includes(sw)))) best = Math.max(best, 35);
    if (address.includes(w)) best = Math.max(best, 30);
    if (motd.includes(w)) best = Math.max(best, 12);
    if (!best) return 0;
    total += best;
  }
  // busy servers first among similar matches (Minehut has lots of empty ones)
  return total + Math.log10((entry.players || 0) + 1) * 18;
}

/** Whether the search looks like a server address ("play.example.com", "1.2.3.4:25566"). */
function asAddress(query) {
  const q = String(query || '').trim();
  if (!q || /\s/.test(q) || !/[.:]/.test(q)) return null;
  if (!/^([a-z0-9-]+\.)+[a-z0-9-]{2,}(:\d{1,5})?$/i.test(q) && !/^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/.test(q) && !/^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(q)) return null;
  try {
    parseAddress(q);
    return q.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Searches everything. Returns {address, directory, minehut, minehutError}: the typed address
 * (when it is one), matches from the built-in list and from Minehut, best first.
 */
async function search(query, { limit = 30, fetchImpl } = {}) {
  const q = String(query || '').trim().toLowerCase().slice(0, 80);
  const words = q.split(/\s+/).filter(Boolean);
  const out = { query: q, address: asAddress(q), directory: [], minehut: [], minehutError: null };
  if (!words.length) return out;
  const rank = (list) => list.map((e) => ({ e, s: score(e, words) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.e);
  out.directory = rank(DIRECTORY).slice(0, limit);
  try {
    out.minehut = rank(await minehut({ fetchImpl })).slice(0, limit);
  } catch (err) {
    out.minehutError = err.name === 'TimeoutError' ? 'Minehut didn\'t answer.' : err.message;
  }
  return out;
}

/** The game modes people search for most, for the quick buttons on the page. */
const CATEGORIES = ['Survival', 'SMP', 'SkyBlock', 'Bed Wars', 'Lifesteal', 'PvP', 'Prison', 'Factions', 'Minigames', 'Parkour', 'Anarchy', 'RPG', 'Pixelmon', 'Creative'];

module.exports = { DIRECTORY, CATEGORIES, search, score, asAddress, plainMotd, minehut };
