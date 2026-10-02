// Netlify Function: the friends service at /api/*, stored in Netlify Blobs.
import { getStore } from '@netlify/blobs';
import { createApi } from '../../lib/friends-api.mjs';

// The store is opened for every request: it carries an access token from the request's
// context, and a store kept from an earlier request fails with "Token expired" once the
// function has stayed warm for a while.
function openStore() {
  const blobs = getStore({ name: 'nimbus-friends', consistency: 'strong' });
  return {
    get: (key) => blobs.get(key, { type: 'json' }),
    set: (key, value) => blobs.setJSON(key, value),
    delete: (key) => blobs.delete(key),
    list: async (prefix) => (await blobs.list({ prefix })).blobs.map((b) => b.key),
  };
}

// Nimbus admins, by Minecraft uuid (a name can be changed and taken by someone else):
// Its_Flayniks, plus any in the NIMBUS_ADMINS environment variable (comma separated).
const ADMINS = ['7bc9c85eab2641ebbc373a283a27a3ab', ...String(process.env.NIMBUS_ADMINS || '').split(',').map((s) => s.trim()).filter(Boolean)];

export default (req) => createApi({ store: openStore(), admins: ADMINS })(req);
export const config = { path: '/api/*' };
