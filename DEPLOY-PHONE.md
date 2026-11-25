# Permanent host, phone only — no laptop

This pack has **four files** and no dependencies. The game, all 108 card images,
the rules engine and the online-room server are embedded in `server.js`.

You do need two free accounts, both created in a phone browser:

- GitHub — holds the four files.
- A Node host — runs them. **Render** is the simplest free option; its own
  first-deploy guide says free resources need no payment. Koyeb is a backup.

## 1. Get the files onto your phone

Download `VUSAL-cloud.zip` and unzip it with the Files app (iPhone) or Files /
a ZIP app (Android). You should have:

```text
server.js
package.json
render.yaml
DEPLOY-PHONE.md
```

`server.js` is about 3 MB, so it is well within GitHub's browser-upload limit of
25 MiB per file. GitHub's web uploader also accepts up to 100 files at once;
this pack is only four. See GitHub's
[Adding a file to a repository](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).

## 2. Put them in a GitHub repository from your phone

Use the **GitHub website in Safari or Chrome**, not the GitHub app. If the
upload button is missing, turn on **Request Desktop Site** / **Desktop site**.

1. Sign in at `github.com` and create a **New repository** named `vusal`.
   Public or private is fine. Leave the branch as `main`.
2. Open the repository, tap **Add file → Upload files**.
3. Choose the four files from the unzipped `VUSAL-cloud` folder.
4. Tap **Commit changes**.

Nothing is installed on your phone and no terminal is needed.

## 3. Deploy on Render from your phone

1. Sign up at `render.com` using your GitHub account. Free web services require
   no payment, according to Render's
   [first deploy guide](https://render.com/docs/your-first-deploy).
2. In Render, choose **New → Blueprint**, connect GitHub, and pick `vusal`.
   The included `render.yaml` fills in the Node runtime, free plan,
   `npm install`, `npm start`, and `/health` check.
3. If Blueprint is awkward on a small screen, use **New → Web Service** instead
   and enter:

   | Field | Value |
   | --- | --- |
   | Repository | `vusal` |
   | Branch | `main` |
   | Language / Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Compute / Plan | **Free** |
   | Health Check Path | `/health` |

4. Tap **Deploy**. After a minute or two, Render gives you an
   `https://….onrender.com` URL. Open it on your phone.

Render's free services spin down after 15 minutes with no inbound traffic and
take roughly a minute to wake; the workspace gets 750 free instance hours per
month. During an active game the players' long-poll requests keep arriving, so
the game should not be treated as idle. After any sleep or redeploy, local room
state may be gone — just create a new room. Details:
[Render free plan](https://render.com/docs/free).

## 4. Play

On the live `https://` URL, tap **COPY GAME LINK** and send that link to
friends. One person taps CREATE ROOM, shares the room link/code, everyone
fills a selected seat, and the host taps START GAME. The same URL works every time; no-one has
to keep a laptop running.

## Updating an existing deployment

Replace all four files in the GitHub repository and commit. Render or Koyeb
will redeploy; if it does not, use **Manual Deploy → Deploy latest commit**.
Hard-refresh the game page on every phone, then create a **new room** so nobody
rejoins a room created by the older server process.

## Backup host: Koyeb

Koyeb can also deploy this GitHub repository from its browser dashboard. Choose
**Web Service → GitHub → `vusal`**, Node buildpack, `npm install`,
`npm start`, and one **Free** instance. Koyeb documents one free web service per
organization with 512 MB RAM; it scales to zero after one hour without traffic
and you are not charged for the free web service. See
[Instances](https://www.koyeb.com/docs/reference/instances) and
[Pricing FAQ](https://www.koyeb.com/docs/faqs/pricing).

## Avoid these phone-hosting dead ends

- **GitHub Pages / Netlify / Cloudflare Pages** — can serve the standalone HTML
  for pass & play, but cannot run `server.js`, so online rooms will not work.
- **Vercel/Netlify Functions / Cloudflare Workers** — this is a long-running
  Node process with in-memory rooms, not a serverless function.
- **Glitch** — project hosting ended on 8 July 2025; do not follow old guides
  that recommend it.
- **Sharing the Arena preview URL** — it needs a session traffic token; friends
  get a 403.

## If you need truly always-on

Free tiers sleep. A cheap paid web service or small VPS stays awake without a
laptop: create it through the provider's phone browser dashboard, upload these
same four files, and use `npm start`. The host, not your phone, stays online.
