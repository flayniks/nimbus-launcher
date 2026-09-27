'use strict';
// Cosmetics you wear: saved here, written where Nimbus Core reads them (so your own show in game
// straight away, even offline), and sent to the friends service so other Nimbus players see them.
// Uploading needs the Mojang-verified friends sign-in, so nobody can dress up someone else.
const EventEmitter = require('events');
const path = require('path');
const { readJson, writeJson } = require('./util');

const SLOTS = ['hat', 'pet', 'wings', 'aura'];
const ID = /^[a-z0-9_]{2,40}$/;

class Cosmetics extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.launcher the Launcher (paths, settings)
   * @param {object} [opts.friends] the friends service client, for uploading
   */
  constructor({ launcher, friends = null }) {
    super();
    this.launcher = launcher;
    this.friends = friends;
    this.file = path.join(launcher.paths.root, 'cosmetics.json');
    this.gameFile = launcher.paths.cosmetics;
    this.worn = { hat: null, pet: null, wings: null, aura: null };
    this.sync = { state: 'local', error: null };
  }

  async init() {
    const saved = await readJson(this.file, {});
    for (const s of SLOTS) if (ID.test(saved.worn?.[s] || '')) this.worn[s] = saved.worn[s];
    await this.writeGameFile();
    this.upload().catch(() => {});
    return this;
  }

  state() {
    return { worn: { ...this.worn }, sync: { ...this.sync }, showOthers: this.launcher.settings?.showOtherCosmetics !== false };
  }

  /** Wears `id` in `slot`, or takes it off with null. */
  async set(slot, id) {
    if (!SLOTS.includes(slot)) throw new Error('Unknown slot.');
    if (id !== null && !ID.test(String(id))) throw new Error('Unknown cosmetic.');
    this.worn[slot] = id;
    await writeJson(this.file, { worn: this.worn });
    await this.writeGameFile();
    this.emit('state', this.state());
    this.upload().catch(() => {});
    return this.state();
  }

  async writeGameFile() {
    await writeJson(this.gameFile, { ...this.worn, at: Date.now() });
  }

  /** Sends what you wear to the friends service, so other players' games can show it. */
  async upload() {
    if (!this.friends) return;
    try {
      await this.friends.call('cosmetics/set', { ...this.worn });
      this.sync = { state: 'shared', error: null };
    } catch (err) {
      this.sync = { state: 'local', error: err.message };
    }
    this.emit('state', this.state());
  }
}

module.exports = { Cosmetics, COSMETIC_SLOTS: SLOTS };
