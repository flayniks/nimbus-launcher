// A local stand-in for the Netlify friends service, for tests: the real API code with an
// in-memory store, signing in without Mojang and a small made-up name list.
// usage: node test/friends-server.mjs [port]   (prints the base URL)
import http from 'node:http';
import { createApi, memoryStore } from '../website/lib/friends-api.mjs';

const PEOPLE = {
  alex: ['0123456789abcdef0123456789abcdef', 'Alex'],
  steve: ['fedcba9876543210fedcba9876543210', 'Steve'],
  notch: ['069a79f444e94726a5befca90e38aaf5', 'Notch'],
};
const fakeMojang = async (url) => {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop()).toLowerCase();
  const p = PEOPLE[name];
  return p ? new Response(JSON.stringify({ id: p[0], name: p[1] })) : new Response(null, { status: 204 });
};
// NIMBUS_ADMINS=<uuid,...> makes those accounts admins (Alex is 0123456789abcdef0123456789abcdef)
const admins = String(process.env.NIMBUS_ADMINS || '').split(',').filter(Boolean);
const api = createApi({ store: memoryStore(), devAuth: true, fetch: fakeMojang, profileApi: 'http://mojang', admins });

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await api(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
server.listen(Number(process.argv[2]) || 0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/api`));
