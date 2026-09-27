// Nimbus coins: earned with daily tasks, achievements, a daily log-in streak and just playing;
// spent on cosmetics. Nimbus Core counts what you do in game (blocks mined, mobs beaten, blocks
// walked...), the launcher sends today's totals, and everything is worked out here, so a
// balance can't be edited from a player's computer. The totals themselves come from the
// player's game, so each day's counts are capped at what a person could really do.
import PRICES from './cosmetic-prices.mjs';

const MIN = 60;
const HOUR = 3600;

/** What Nimbus Core counts, with the most anyone could do in one day. Time is in seconds, distance in blocks. */
export const STATS = {
  play: 86_400, together: 86_400, nether: 86_400, end: 86_400,
  mine: 40_000, ores: 6_000, diamonds: 400, logs: 8_000, place: 40_000,
  kills: 5_000, hostile: 5_000, crits: 5_000,
  walk: 200_000, sprint: 150_000, swim: 40_000, fly: 400_000, ride: 200_000,
  eat: 600, xp: 200_000, levels: 400, sleep: 30, fish: 600,
};
const TIME = new Set(['play', 'together', 'nether', 'end']);

export const REWARDS = { tiers: [30, 50, 80], allDone: 50, login: 10, streakStep: 5, loginMax: 50, welcome: 250, playEvery: 3 * MIN, playMax: 50 };

// Three tasks a day, one from each list, picked the same way for the same player and day.
const TASK_POOL = [
  [
    ['play', 15 * MIN, 'Play for 15 minutes'],
    ['mine', 64, 'Mine 64 blocks'],
    ['place', 64, 'Place 64 blocks'],
    ['walk', 500, 'Walk 500 blocks'],
    ['eat', 5, 'Eat 5 times'],
    ['logs', 32, 'Chop 32 logs'],
    ['xp', 100, 'Collect 100 experience'],
    ['hostile', 5, 'Beat 5 hostile mobs'],
    ['sleep', 1, 'Sleep in a bed'],
  ],
  [
    ['play', 45 * MIN, 'Play for 45 minutes'],
    ['mine', 250, 'Mine 250 blocks'],
    ['ores', 16, 'Mine 16 ores'],
    ['hostile', 20, 'Beat 20 hostile mobs'],
    ['sprint', 1_000, 'Sprint 1,000 blocks'],
    ['swim', 150, 'Swim 150 blocks'],
    ['crits', 15, 'Land 15 critical hits'],
    ['levels', 5, 'Gain 5 levels'],
    ['fish', 3, 'Catch 3 fish'],
    ['ride', 300, 'Ride 300 blocks (boat, horse, minecart...)'],
    ['place', 300, 'Place 300 blocks'],
  ],
  [
    ['play', 90 * MIN, 'Play for 90 minutes'],
    ['mine', 800, 'Mine 800 blocks'],
    ['ores', 48, 'Mine 48 ores'],
    ['diamonds', 3, 'Mine 3 diamond ores'],
    ['hostile', 50, 'Beat 50 hostile mobs'],
    ['walk', 5_000, 'Travel 5,000 blocks on foot'],
    ['together', 20 * MIN, 'Play 20 minutes with other players'],
    ['nether', 10 * MIN, 'Spend 10 minutes in the Nether'],
    ['kills', 80, 'Beat 80 mobs'],
  ],
];

/** Once-only goals over everything you've ever done with Nimbus. */
export const ACHIEVEMENTS = [
  ['play_1h', 'play', HOUR, 50, 'Getting started', 'Play for an hour'],
  ['play_10h', 'play', 10 * HOUR, 200, 'Regular', 'Play for 10 hours'],
  ['play_50h', 'play', 50 * HOUR, 600, 'Veteran', 'Play for 50 hours'],
  ['mine_1k', 'mine', 1_000, 100, 'Miner', 'Mine 1,000 blocks'],
  ['mine_10k', 'mine', 10_000, 400, 'Excavator', 'Mine 10,000 blocks'],
  ['diamond_1', 'diamonds', 1, 100, 'Diamonds!', 'Mine a diamond ore'],
  ['diamond_50', 'diamonds', 50, 500, 'Diamond hands', 'Mine 50 diamond ores'],
  ['place_5k', 'place', 5_000, 200, 'Builder', 'Place 5,000 blocks'],
  ['hostile_100', 'hostile', 100, 150, 'Monster hunter', 'Beat 100 hostile mobs'],
  ['hostile_1k', 'hostile', 1_000, 500, 'Slayer', 'Beat 1,000 hostile mobs'],
  ['crits_500', 'crits', 500, 200, 'Critical', 'Land 500 critical hits'],
  ['walk_10k', 'walk', 10_000, 150, 'Explorer', 'Travel 10,000 blocks on foot'],
  ['walk_100k', 'walk', 100_000, 600, 'Globetrotter', 'Travel 100,000 blocks on foot'],
  ['swim_2k', 'swim', 2_000, 150, 'Fish out of water', 'Swim 2,000 blocks'],
  ['fly_10k', 'fly', 10_000, 300, 'Sky high', 'Fly 10,000 blocks with an elytra'],
  ['ride_5k', 'ride', 5_000, 150, 'Sailor', 'Ride 5,000 blocks'],
  ['fish_50', 'fish', 50, 200, 'Angler', 'Catch 50 fish'],
  ['nether', 'nether', 1, 100, 'Hot stuff', 'Go to the Nether'],
  ['end', 'end', 1, 250, 'The End?', 'Go to the End'],
  ['levels_30', 'levels', 30, 150, 'Enchanter', 'Gain 30 levels'],
  ['together_1h', 'together', HOUR, 200, 'Better together', 'Play an hour with other players'],
  ['streak_7', 'streak', 7, 250, 'Every day', 'Play 7 days in a row'],
  ['streak_30', 'streak', 30, 1_000, 'Dedicated', 'Play 30 days in a row'],
  ['owned_10', 'owned', 10, 200, 'Collector', 'Unlock 10 cosmetics'],
].map(([id, stat, goal, reward, title, desc]) => ({ id, stat, goal, reward, title, desc }));

export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const nextDay = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Today's three tasks for a player: one easy, one medium, one hard, all counting different things. */
export function tasksFor(day, uuid) {
  const used = new Set();
  return TASK_POOL.map((pool, tier) => {
    let pick = null;
    for (let salt = 0; salt < 20 && !pick; salt++) {
      const [stat, goal, title] = pool[fnv(`${day}:${uuid}:${tier}:${salt}`) % pool.length];
      if (!used.has(stat)) pick = { id: `${tier}-${stat}-${goal}`, stat, goal, title, reward: REWARDS.tiers[tier], tier };
    }
    used.add(pick.stat);
    return pick;
  });
}

export const priceOf = (id) => (Object.hasOwn(PRICES, id) ? PRICES[id] : null);
export const owns = (wallet, id) => priceOf(id) === 0 || Boolean(wallet?.owned?.includes(id));

export function newWallet() {
  return { coins: REWARDS.welcome, earned: REWARDS.welcome, owned: [], day: null, stats: {}, done: [], bonus: false, playPaid: 0, life: {}, ach: [], streak: 0, lastLogin: null, fresh: true };
}

/**
 * Brings a wallet up to date for `now` and folds in the totals the game reported, paying out
 * whatever that completes. Returns what was earned, for the launcher to show.
 */
export function settle(w, uuid, now, report = null) {
  const events = [];
  const pay = (type, coins, title, id = null) => {
    if (coins <= 0) return;
    w.coins += coins;
    w.earned = (w.earned || 0) + coins;
    events.push({ type, id, title, coins });
  };
  if (w.fresh) {
    delete w.fresh;
    events.push({ type: 'welcome', id: null, title: 'Welcome to Nimbus coins', coins: REWARDS.welcome });
  }
  const today = dayOf(now);
  if (w.day !== today) Object.assign(w, { day: today, stats: {}, done: [], bonus: false, playPaid: 0 });

  // the daily log-in, with a streak for coming back every day
  if (w.lastLogin !== today) {
    w.streak = w.lastLogin === dayOf(now - 86_400_000) ? (w.streak || 0) + 1 : 1;
    w.lastLogin = today;
    pay('login', Math.min(REWARDS.loginMax, REWARDS.login + (w.streak - 1) * REWARDS.streakStep), w.streak > 1 ? `Day ${w.streak} streak` : 'Daily log-in');
  }

  // today's totals only ever go up; whatever they add counts towards achievements too
  if (report && report.day === today && report.stats && typeof report.stats === 'object') {
    for (const [k, max] of Object.entries(STATS)) {
      const v = Math.min(max, Math.max(0, Math.floor(Number(report.stats[k]) || 0)));
      const before = w.stats[k] || 0;
      if (v > before) {
        w.stats[k] = v;
        w.life[k] = (w.life[k] || 0) + (v - before);
      }
    }
  }

  const tasks = tasksFor(today, uuid);
  for (const t of tasks) {
    if (!w.done.includes(t.id) && (w.stats[t.stat] || 0) >= t.goal) {
      w.done.push(t.id);
      pay('task', t.reward, t.title, t.id);
    }
  }
  if (!w.bonus && tasks.every((t) => w.done.includes(t.id))) {
    w.bonus = true;
    pay('bonus', REWARDS.allDone, 'All daily tasks done');
  }
  const playable = Math.min(REWARDS.playMax, Math.floor((w.stats.play || 0) / REWARDS.playEvery));
  if (playable > (w.playPaid || 0)) {
    pay('play', playable - (w.playPaid || 0), 'Playing');
    w.playPaid = playable;
  }
  for (const a of ACHIEVEMENTS) {
    if (!w.ach.includes(a.id) && progressOf(w, a.stat) >= a.goal) {
      w.ach.push(a.id);
      pay('achievement', a.reward, a.title, a.id);
    }
  }
  return events;
}

function progressOf(w, stat) {
  if (stat === 'streak') return w.streak || 0;
  if (stat === 'owned') return (w.owned || []).length;
  return w.life?.[stat] || 0;
}

/** Spends coins on a cosmetic. Throws a message for the player when it can't. */
export function buy(w, id) {
  const no = (msg) => Object.assign(new Error(msg), { player: true });
  const price = priceOf(id);
  if (price === null) throw no('That cosmetic is not in the shop.');
  if (owns(w, id)) throw no('You already have it.');
  if (w.coins < price) throw no(`You need ${price - w.coins} more coins.`);
  w.coins -= price;
  w.owned.push(id);
  return price;
}

/** What the launcher shows. */
export function view(w, uuid, now) {
  const today = dayOf(now);
  const stats = w.day === today ? w.stats : {};
  const done = w.day === today ? w.done : [];
  const tasks = tasksFor(today, uuid).map((t) => ({ ...t, time: TIME.has(t.stat), progress: Math.min(t.goal, stats[t.stat] || 0), done: done.includes(t.id) }));
  return {
    coins: w.coins,
    earned: w.earned || 0,
    owned: [...w.owned],
    streak: w.lastLogin === today || w.lastLogin === dayOf(now - 86_400_000) ? w.streak || 0 : 0,
    day: today,
    resetsAt: nextDay(now),
    tasks,
    bonus: { reward: REWARDS.allDone, done: w.day === today && Boolean(w.bonus) },
    play: { paid: w.day === today ? w.playPaid || 0 : 0, max: REWARDS.playMax, every: REWARDS.playEvery },
    achievements: ACHIEVEMENTS.map((a) => ({ ...a, time: TIME.has(a.stat), progress: Math.min(a.goal, progressOf(w, a.stat)), done: w.ach.includes(a.id) })),
  };
}
