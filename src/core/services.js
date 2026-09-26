'use strict';
// services.json in the repo: addresses and ids the launcher reads at run time, so they can be
// changed (a new friends service address, the Discord app id) without a new launcher release.
const SERVICES_URL = 'https://raw.githubusercontent.com/flayniks/nimbus-launcher/main/services.json';
const KEEP = 6 * 3600_000;

let cached = null;
let cachedAt = 0;
let pending = null;

/** The published services.json, cached for six hours; {} when it can't be reached. */
async function services() {
  if (cached && Date.now() - cachedAt < KEEP) return cached;
  if (!pending) {
    pending = (async () => {
      try {
        const r = await fetch(process.env.NIMBUS_SERVICES_URL || SERVICES_URL, { signal: AbortSignal.timeout(6000) });
        if (r.ok) cached = await r.json();
      } catch { /* offline or blocked: keep what we had */ }
      cached = cached || {};
      cachedAt = Date.now();
      return cached;
    })().finally(() => { pending = null; });
  }
  return pending;
}

module.exports = { services };
