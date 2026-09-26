// Netlify Function: the friends service at /api/*, stored in Netlify Blobs.
import { getStore } from '@netlify/blobs';
import { createApi } from '../../lib/friends-api.mjs';

const blobs = getStore({ name: 'nimbus-friends', consistency: 'strong' });
const store = {
  get: (key) => blobs.get(key, { type: 'json' }),
  set: (key, value) => blobs.setJSON(key, value),
  delete: (key) => blobs.delete(key),
  list: async (prefix) => (await blobs.list({ prefix })).blobs.map((b) => b.key),
};
const handle = createApi({ store });

export default (req) => handle(req);
export const config = { path: '/api/*' };
