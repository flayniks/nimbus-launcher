'use strict';
const auth = require('./auth');
const { readJson, writeJson } = require('./util');

/**
 * Keeps signed-in Microsoft accounts. Tokens are sealed with the OS keychain
 * (Electron safeStorage) before they touch the disk; `crypto` is injected so the
 * store also works in plain Node tests.
 */
class AccountStore {
  constructor(file, crypto) {
    this.file = file;
    this.crypto = crypto;
    this.data = null;
  }

  async load() {
    if (!this.data) this.data = await readJson(this.file, { active: null, accounts: [] });
    return this.data;
  }

  async save() {
    await writeJson(this.file, this.data);
  }

  seal(secret) {
    return this.crypto.encrypt(JSON.stringify(secret));
  }

  open(account) {
    try { return JSON.parse(this.crypto.decrypt(account.secret)); } catch { return null; }
  }

  async list() {
    const d = await this.load();
    return d.accounts.map((a) => ({ uuid: a.uuid, name: a.name, skin: a.skin, active: a.uuid === d.active, needsLogin: !this.open(a) }));
  }

  async add(result) {
    const d = await this.load();
    const entry = {
      uuid: result.uuid,
      name: result.name,
      skin: result.skin,
      xuid: result.xuid,
      expiresAt: result.expiresAt,
      secret: this.seal({ refreshToken: result.refreshToken, accessToken: result.accessToken }),
    };
    d.accounts = d.accounts.filter((a) => a.uuid !== entry.uuid);
    d.accounts.push(entry);
    d.active = entry.uuid;
    await this.save();
    return this.list();
  }

  async remove(uuid) {
    const d = await this.load();
    d.accounts = d.accounts.filter((a) => a.uuid !== uuid);
    if (d.active === uuid) d.active = d.accounts[0]?.uuid || null;
    await this.save();
    return this.list();
  }

  async setActive(uuid) {
    const d = await this.load();
    if (d.accounts.some((a) => a.uuid === uuid)) d.active = uuid;
    await this.save();
    return this.list();
  }

  /** The active account with a Minecraft token that is good for a while, refreshing when needed. */
  async activeSession(oauthCfg) {
    const d = await this.load();
    const account = d.accounts.find((a) => a.uuid === d.active);
    if (!account) {
      const e = new Error('Sign in with a Microsoft account that owns Minecraft to play.');
      e.code = 'NO_ACCOUNT';
      throw e;
    }
    let secret = this.open(account);
    if (!secret) {
      const e = new Error(`${account.name} needs to sign in again.`);
      e.code = 'REAUTH';
      throw e;
    }
    if (!secret.accessToken || Date.now() > (account.expiresAt || 0) - 5 * 60 * 1000) {
      const fresh = await auth.refresh(oauthCfg, secret.refreshToken);
      Object.assign(account, { name: fresh.name, skin: fresh.skin, xuid: fresh.xuid, expiresAt: fresh.expiresAt });
      secret = { refreshToken: fresh.refreshToken || secret.refreshToken, accessToken: fresh.accessToken };
      account.secret = this.seal(secret);
      await this.save();
    }
    return { uuid: account.uuid, name: account.name, xuid: account.xuid, accessToken: secret.accessToken };
  }
}

module.exports = { AccountStore };
