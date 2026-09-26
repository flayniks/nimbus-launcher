# Nimbus website + friends service

The website (`public/`) and the friends service behind Friends, chat and Nimbus LAN (`netlify/functions/api.mjs`, logic in `lib/friends-api.mjs`). Both deploy to Netlify together; `netlify.toml` at the repo root sets everything up.

## Put it online (one time, about two minutes)

1. Open **https://app.netlify.com/start** and sign in with GitHub.
2. Pick **Import an existing project → GitHub → flayniks/nimbus-launcher**.
3. Leave the settings as they are (they come from `netlify.toml`) and press **Deploy**.
4. In **Site configuration → Change site name**, name it **nimbus-launcher** so it lives at `https://nimbus-launcher.netlify.app`.
   If that name is taken, pick another and put the new address in `services.json` at the repo root (`"friends": "https://<your-name>.netlify.app/api"`). Launchers read that file, so no new launcher release is needed.

Every push to `main` redeploys the site after that. Check the service at `https://<site>/api/health`, which should say `{"ok":true}`.

## The site

Plain HTML, CSS and a module script, no build step. The 3D scene uses three.js, vendored in `public/vendor/three` (MIT). The download buttons point at `releases/latest/download/Nimbus-Launcher-Setup.exe`, so they always serve the newest release. The page also reads the version and size from GitHub, and the online and player counts from the same counters the launcher uses.

To preview it, run any static server in `public/`, for example `python3 -m http.server 8000`.

## The friends service

`/api/*` is one Netlify Function. Its data lives in Netlify Blobs (store `nimbus-friends`), and every record is written to its own key, so two launchers never overwrite each other.

- **Sign-in** uses Mojang's own server check. The service hands out a random server id, the launcher "joins" it with the player's session, and the service asks Mojang (`hasJoined`) to confirm. The service never sees a password or token. It stores a random session token.
- **Presence:** each launcher calls `POST /api/beat` about every 15 seconds (every 2.5 seconds while chatting or joining). The reply carries friends, requests and new messages.
- **Chat** keeps the last 200 messages per pair.
- **Relay** passes Nimbus LAN join requests, answers and the WebRTC handshake, between friends only. Game traffic never goes through the service; it flows directly between the two players' computers.

`test/friends-server.mjs` runs the same code locally with an in-memory store, for tests.
