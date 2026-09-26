'use strict';
// "How many people use Nimbus": anonymous counters on Abacus (a free counting API), no
// accounts or IDs involved. Every open launcher adds one to the counter for the current
// five-minute window (and one to "playing" while a game runs); the numbers shown are the
// busier of this window and the last. A separate all-time counter goes up once per install.
const { request } = require('./http');

const base = () => process.env.NIMBUS_COUNTER_URL || 'https://abacus.jasoncameron.dev';
const NAMESPACE = 'nimbus-launcher';
const WINDOW_MS = 5 * 60 * 1000;

const windowOf = (t) => Math.floor(t / WINDOW_MS);

async function call(kind, key) {
  try {
    const res = await request(`${base()}/${kind}/${NAMESPACE}/${key}`, { retries: 0, timeout: 8000 });
    const body = JSON.parse(await res.text());
    return Number(body.value) || 0;
  } catch (err) {
    // a counter nobody has hit yet reads as 404
    if (err && err.status === 404) return 0;
    throw err;
  }
}

class Presence {
  /**
   * @param {() => object} settings current launcher settings
   * @param {(patch: object) => Promise<void>} save stores settings (for the once-per-install flag)
   * @param {() => boolean} playing whether a game is running right now
   */
  constructor({ settings, save, playing, now = () => Date.now() }) {
    this.settings = settings;
    this.save = save;
    this.playing = playing;
    this.now = now;
    this.sent = { online: -1, playing: -1 };
    this.timer = null;
  }

  start() {
    this.beat().catch(() => {});
    this.timer = setInterval(() => this.beat().catch(() => {}), 30 * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Counts this launcher (and its game) once per window, if the player allows it. */
  async beat() {
    const s = this.settings();
    if (s.shareOnline === false) return;
    const w = windowOf(this.now());
    if (!s.countedInstall) {
      await call('hit', 'players-total');
      await this.save({ countedInstall: true });
    }
    if (this.sent.online !== w) {
      await call('hit', `online-${w}`);
      this.sent.online = w;
    }
    if (this.playing() && this.sent.playing !== w) {
      await call('hit', `playing-${w}`);
      this.sent.playing = w;
    }
  }

  /** { online, playing, total }, read fresh from the counters. */
  async stats() {
    const w = windowOf(this.now());
    const [onNow, onBefore, playNow, playBefore, total] = await Promise.all([
      call('get', `online-${w}`), call('get', `online-${w - 1}`),
      call('get', `playing-${w}`), call('get', `playing-${w - 1}`),
      call('get', 'players-total'),
    ]);
    return { online: Math.max(onNow, onBefore), playing: Math.max(playNow, playBefore), total };
  }
}

module.exports = { Presence, windowOf, WINDOW_MS };
