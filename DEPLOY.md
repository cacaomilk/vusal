# Playing with people who are not in the same house

Online rooms need `server.js` reachable on the public internet. The single-file
`VUSAL-standalone.html` cannot host a room by itself — there is no shared state
without the server.

## A. Quickest: tunnel from your computer (no account, ~2 minutes)

1. Unzip `VUSAL.zip`. In that folder run:

   ```bash
   npm start          # or: node server.js
   ```

2. In a **second terminal**, install one of the tunnel tools if needed, then start it. Pick one:

   ```bash
   cloudflared tunnel --url http://localhost:3000   # no account, prints a https://….trycloudflare.com URL
   ngrok http 3000                                  # free account
   npm run tunnel                                   # localtunnel via npx; may ask visitors for a tunnel password
   ```

   `npm run tunnel` needs only Node/npm. `cloudflared` and `ngrok` are separate
   command-line downloads; quick-tunnel mode needs no Cloudflare account.

3. Send everyone the `https://…` URL. One person taps CREATE ROOM and shares the
   code or the room link; everyone else fills a selected seat; the host taps START GAME.
4. Keep the computer on for the whole game. The URL changes next session.

If a tunnel asks visitors for a "tunnel password", it is usually the public IP
of the computer running the tunnel — cloudflared avoids that.

## B. Permanent link: deploy to a Node host

Use a **long-running Web Service or container** — Render, Railway, Fly.io, Koyeb,
or any small VPS. Do **not** use a serverless function platform
(Vercel Functions, Netlify Functions, Cloudflare Workers): rooms live in the
server's memory and long-polling needs a process that stays alive. Glitch is no
longer an option: it ended project hosting on 8 July 2025.

1. Put this folder in a Git repository and push it to GitHub.
2. Create a Web Service from that repo:
   - Build command: none
   - Start command: `npm start` (or `node server.js`)
   - The server reads `PORT` from the environment automatically and binds `0.0.0.0`.
3. Open the `https://…` URL the host gives you and share it with your friends.

Notes:

- Free tiers sleep when idle. Rooms are saved to `rooms.json`, but on an
  ephemeral filesystem that file disappears after a restart — just start a fresh
  room after a wake-up.
- HTTPS makes the COPY LINK / COPY GAME LINK buttons and "Add to Home Screen"
  work properly. Plain HTTP still plays fine.
- This is a private party game with no accounts. Room codes are the only gate,
  so keep the URL among friends rather than posting it publicly.

## C. No laptop: phone-only cloud pack

Use **`VUSAL-cloud.zip`** (or the `cloud/` folder in the full ZIP). It contains
just four files and puts the whole game, rules engine, card images and room
server inside one `server.js`. Upload those four files to a GitHub repository
from a phone browser, then let Render or Koyeb deploy that repository. You never
run a terminal on the phone.

`render.yaml` pre-fills Render's free Node Web Service settings, and
`cloud/DEPLOY-PHONE.md` has the exact tap-by-tap steps. GitHub's web uploader
accepts up to 100 files at once and 25 MiB per file, so this four-file pack is
well inside the limit. Render's free plan needs no payment but spins down after
15 minutes idle; Koyeb's free instance scales down after one hour idle. Active
rooms send long-poll requests, so an active game keeps producing traffic.

## D. Static hosts

GitHub Pages, Netlify and Cloudflare Pages can host `VUSAL-standalone.html` so
everyone can play pass & play from a link. They cannot run `server.js`, so
online rooms will not work there. Use the standalone file on each device and
play over voice chat instead.

## Updating after a fix

Replace the game files in your folder or Git repository, then restart a local
server or redeploy the Web Service. Hard-refresh each browser (or clear the
site's cache), and create a **new room**: an already-running server can keep old
room state in memory. On a local install you can also stop the server and delete
`rooms.json` before restarting.

## Why not just share the Arena preview link?

The live preview is behind an Arena traffic access token; anyone opening the raw
URL without that token gets a 403. It is tied to your session, not a public
game server. A tunnel or a deployment gives you a link other people can open.
