'use strict';
// Cosmetics you wear: saved here, written where Nimbus Core reads them (so your own show in game
// straight away, even offline), and sent to the friends service so other Nimbus players see them.
// Uploading needs the Mojang-verified friends sign-in, so nobody can dress up someone else.
//
// Most cosmetics are unlocked with Nimbus coins (website/lib/coins.mjs). Nimbus Core counts what
// you do in game into a progress file; while a game runs this sends the day's totals to the
// service, which pays out daily tasks and achievements. The wallet lives on the service; a copy
// is kept here so what you've unlocked still shows when the service can't be reached.
const EventEmitter = require('events');
const path = require('path');
const { readJson, writeJson } = require('./util');
const CATALOG = require('./cosmetics-catalog.json'); // id -> { slot, price }, from tools/cosmetics/build.mjs

const SLOTS = ['hat', 'pet', 'wings', 'aura'];
const ID = /^[a-z0-9_]{2,40}$/;
const RETRY_MIN = 30_000;
const RETRY_MAX = 5 * 60_000;
const REPORT_EVERY = 60_000;

const known = (id) => Object.hasOwn(CATALOG, id);
const price = (id) => (known(id) ? CATALOG[id].price : null);

/** Turns a failed call into what the Cosmetics page says. */
function describe(err) {
  const msg = String(err?.message || err || '');
  if (/sign in with a microsoft account/i.test(msg)) return { state: 'signed-out', error: null };
  const code = msg.match(/answered (\d+)/)?.[1];
  const down = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    || /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET/i.test(`${msg} ${err?.cause?.code || ''}`)
    || (code && (code === '404' || code[0] === '5'));
  if (down) return { state: 'offline', error: `Can't reach the Nimbus online service${code ? ` (it answered ${code})` : ''}.` };
  return { state: 'error', error: msg };
}

class Cosmetics extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.launcher the Launcher (paths, settings, accounts)
   * @param {object} [opts.friends] the friends service client
   */
  constructor({ launcher, friends = null }) {
    super();
    this.launcher = launcher;
    this.friends = friends;
    this.file = path.join(launcher.paths.root, 'cosmetics.json');
    this.gameFile = launcher.paths.cosmetics;
    this.progressFile = launcher.paths.progress || null;
    this.tasksFile = launcher.paths.tasks || null;
    this.worn = { hat: null, pet: null, wings: null, aura: null };
    this.wallets = {}; // the last wallet seen, per account
    this.who = null; // the account this.wallet belongs to
    this.wallet = null;
    this.sync = { state: 'local', error: null };
    this.retryIn = RETRY_MIN;
    this.retryTimer = null;
    this.reportTimer = null;
    this.lastReport = '';
    this.busy = null;
  }

  async init() {
    const saved = await readJson(this.file, {});
    for (const s of SLOTS) if (ID.test(saved.worn?.[s] || '')) this.worn[s] = saved.worn[s];
    this.wallets = saved.wallets && typeof saved.wallets === 'object' ? saved.wallets : {};
    // until the service answers: the last wallet seen for the active account
    this.who = await this.account();
    this.wallet = (this.who && this.wallets[this.who]) || null;
    await this.writeGameFile();
    this.refresh().catch(() => {});
    return this;
  }

  async account() {
    try {
      const a = await this.launcher.accounts?.activeSession?.(this.launcher.oauth?.());
      return a?.uuid ? String(a.uuid).replace(/-/g, '') : null;
    } catch {
      return null;
    }
  }

  owns(id) {
    return price(id) === 0 || Boolean(this.wallet?.owned?.includes(id));
  }

  state() {
    return {
      worn: { ...this.worn },
      sync: { ...this.sync },
      showOthers: this.launcher.settings?.showOtherCosmetics !== false,
      wallet: this.wallet ? { ...this.wallet } : null,
    };
  }

  async save() {
    await writeJson(this.file, { worn: this.worn, wallets: this.wallets });
  }

  /** Wears `id` in `slot`, or takes it off with null. Locked ones have to be unlocked first. */
  async set(slot, id) {
    if (!SLOTS.includes(slot)) throw new Error('Unknown slot.');
    if (id !== null && (!ID.test(String(id)) || !known(id) || CATALOG[id].slot !== slot)) throw new Error('Unknown cosmetic.');
    if (id !== null && !this.owns(id)) throw new Error(`Unlock it first: it costs ${price(id)} Nimbus coins.`);
    this.worn[slot] = id;
    await this.save();
    await this.writeGameFile();
    this.emit('state', this.state());
    this.upload().catch(() => {});
    return this.state();
  }

  /** Spends coins on a cosmetic, then puts it on. */
  async buy(id) {
    if (!known(id)) throw new Error('Unknown cosmetic.');
    if (!this.friends) throw new Error('Nimbus coins need the online service.');
    let r;
    try {
      r = await this.friends.call('coins/buy', { id });
    } catch (err) {
      const d = describe(err);
      if (d.state === 'signed-out') throw new Error('Sign in with a Microsoft account to use Nimbus coins.');
      throw new Error(d.error || err.message);
    }
    await this.applyWallet(r);
    return this.state();
  }

  async writeGameFile() {
    // only what's yours: the game shows exactly what everyone else will see
    const shown = Object.fromEntries(SLOTS.map((s) => [s, this.worn[s] && this.owns(this.worn[s]) ? this.worn[s] : null]));
    await writeJson(this.gameFile, { ...shown, at: Date.now() });
  }

  /** Today's tasks where Nimbus Core can see them, to cheer when you finish one in game. */
  async writeTasksFile() {
    if (!this.tasksFile || !this.wallet) return;
    const w = this.wallet;
    await writeJson(this.tasksFile, {
      day: w.day,
      coins: w.coins,
      tasks: (w.tasks || []).map((t) => ({ id: t.id, title: t.title, stat: t.stat, goal: t.goal, reward: t.reward, done: t.done })),
      at: Date.now(),
    });
  }

  /** Takes in a wallet from the service: keeps it, and takes off anything that isn't yours. */
  async applyWallet(r) {
    const { events = [], bought = null, http, ...wallet } = r || {};
    if (typeof wallet.coins !== 'number') return;
    this.wallet = wallet;
    if (this.who) this.wallets[this.who] = wallet;
    if (bought && known(bought)) this.worn[CATALOG[bought].slot] = bought;
    for (const s of SLOTS) if (this.worn[s] && !this.owns(this.worn[s])) this.worn[s] = null;
    await this.save();
    await this.writeGameFile();
    await this.writeTasksFile().catch(() => {});
    this.emit('state', this.state());
    if (events.length) this.emit('coins', events);
    if (bought) this.upload().catch(() => {});
  }

  /** Fetches the wallet (paying the daily log-in), shares what you wear and sends the game's progress. */
  async refresh() {
    if (!this.friends) return;
    if (this.busy) return this.busy;
    this.busy = (async () => {
      try {
        const who = await this.account();
        if (who !== this.who) {
          this.who = who;
          this.wallet = (who && this.wallets[who]) || null;
          this.lastReport = '';
        }
        await this.applyWallet(await this.friends.call('coins/state', {}));
        await this.upload();
        await this.report().catch(() => {});
      } catch (err) {
        this.failed(err);
      } finally {
        this.busy = null;
      }
    })();
    return this.busy;
  }

  /** Sends what you wear to the friends service, so other players' games can show it. */
  async upload() {
    if (!this.friends) return;
    try {
      const r = await this.friends.call('cosmetics/set', { ...this.worn });
      this.sync = { state: 'shared', error: null };
      this.retryIn = RETRY_MIN;
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      if (Array.isArray(r?.locked) && r.locked.length) this.refresh().catch(() => {}); // the wallet here was out of date
      this.emit('state', this.state());
    } catch (err) {
      this.failed(err);
    }
  }

  failed(err) {
    this.sync = describe(err);
    this.emit('state', this.state());
    // keep trying by ourselves while it's the service that's missing (a sign-in brings it back anyway)
    if (this.sync.state === 'signed-out' || this.retryTimer) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.refresh().catch(() => {}); }, this.retryIn);
    this.retryTimer.unref?.();
    this.retryIn = Math.min(RETRY_MAX, this.retryIn * 2);
  }

  /** Sends today's totals from the game, if they changed since last time. */
  async report() {
    if (!this.friends || !this.progressFile) return;
    const p = await readJson(this.progressFile, null);
    if (!p || typeof p.day !== 'string' || !p.stats || typeof p.stats !== 'object') return;
    const key = `${this.who}:${p.day}:${JSON.stringify(p.stats)}`;
    if (key === this.lastReport) return;
    const r = await this.friends.call('coins/progress', { day: p.day, stats: p.stats });
    this.lastReport = key;
    await this.applyWallet(r);
  }

  /** While a game runs, its progress goes up every minute; and once more when it closes. */
  gameState(running) {
    clearInterval(this.reportTimer);
    this.reportTimer = null;
    if (running) {
      this.reportTimer = setInterval(() => this.report().catch(() => {}), REPORT_EVERY);
      this.reportTimer.unref?.();
    } else {
      setTimeout(() => this.report().catch(() => {}), 1500).unref?.();
    }
  }

  stop() {
    clearTimeout(this.retryTimer);
    clearInterval(this.reportTimer);
  }
}

module.exports = { Cosmetics, COSMETIC_SLOTS: SLOTS, describe };
