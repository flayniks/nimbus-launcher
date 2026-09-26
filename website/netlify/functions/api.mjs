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

export default (req) => createApi({ store: openStore() })(req);
export const config = { path: '/api/*' };
