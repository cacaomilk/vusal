# VUSAL

**Very unfair snakes and ladders.** A standalone, independent game — no PlayingCards.io room, no Discord DM required. Plain black and white, no taglines.

## Run it

```bash
cd vusal
npm start          # or: node server.js
```

Open `http://localhost:3000`. The server has **no dependencies** — just Node 18+.

- **Pass & play** — one device. Private hands are hidden behind a pass-the-device screen. Tap anywhere, press Enter, or use the REVEAL button to dismiss it. Works offline.
- **If everyone shares one screen** (or you are DMing over voice chat), tick **Skip pass-the-device screens** in the menu, use the link on the privacy screen, or toggle it in TABLE / DM CONTROLS. Online rooms never show these screens — each seat is already private.
- **Online room** — create a room in the menu, share the code or the link, and each player joins on their own device. Fill every selected seat; only the host starts the game. State is shared by HTTP long-polling, so it works behind proxies that block WebSockets. Hands are personalised per seat; the deck, discard and log are shared.
- **Standalone file** — open `VUSAL-standalone.html` directly, double-click, no server and no internet needed. CSS, JavaScript, the logo and all 108 card images are embedded as data URIs. Pass & play is fully playable there; online rooms need the server build. Rebuild it after any edit with `python3 build_standalone.py`.
- **Black first.** The site is primarily black with white type and white rules. The INVERT button switches to the white version (it becomes BLACK to switch back).
- **Phones & tablets** — see the Mobile section below. The layout stacks, and a sticky bar keeps ROLL / END TURN / HAND within thumb reach.

Rooms are saved to `rooms.json` beside `server.js`, so a server restart does not lose a game in progress. Delete that file to clear all rooms. START builds a fresh game state and requires every selected seat to be filled; the browser ignores older long-poll responses so a stale game-over screen cannot reappear after a new start or reset.

## Mobile

**One phone, pass & play (offline, no install)**

Download `VUSAL-standalone.html` and open it in a browser. It is a single self-contained file: CSS, JavaScript, the logo and all 108 cards are embedded, so no internet and no server are needed.

- **Android** — download the file, then open it with Chrome (or Files → "Open with" → Chrome). Local `file://` pages with inline scripts work.
- **iPhone / iPad** — tapping an HTML file in the Files app opens Quick Look, which **does not run JavaScript**, so the game will look static. Use the share sheet's "Open in Safari" / "Copy to Safari" if it appears, or an HTML viewer app with a real browser. The most reliable option is to open the game from a web address (next section).

**Group play on phones (same Wi-Fi)**

1. On a computer on the same Wi-Fi network, run `npm start` in this folder.
2. Find that computer's LAN IP: `ipconfig` on Windows, `ip addr` / `ifconfig` on macOS or Linux (something like `192.168.1.42`).
3. On every phone, open `http://192.168.1.42:3000` in Safari or Chrome.
4. One person taps CREATE ROOM and shares the code or link; everyone else fills a selected seat; the host taps START GAME.

The server listens on `0.0.0.0`, so LAN access works with no configuration and no internet account.

**Add to Home Screen**

The server build ships `manifest.webmanifest` plus 192 px and 512 px icons. On Android Chrome use "Install app" / "Add to Home Screen"; on iOS use Share → "Add to Home Screen". It opens full-screen with the VUSAL icon. (HTTPS is required for an install prompt on the web; a plain `http://` LAN address still works as a normal tab.)

The standalone `.html` file is offline and self-contained. Online rooms always need the Node server running somewhere — a phone cannot host them by itself.

## Not in the same house

The Arena live preview is protected by a session access token, so sharing that raw URL gives other people a 403. For remote play, put the server on the public internet:

- **Fastest, no account** — run `npm start` on your computer, then start a tunnel in a second terminal (`cloudflared tunnel --url http://localhost:3000`, `ngrok http 3000`, or `npm run tunnel`) and send friends the `https://…` URL. Keep the computer on.
- **Permanent link** — deploy this folder to a long-running Node host (Render, Railway, Fly.io, Koyeb, or a VPS). Start command `npm start`; the server honours `PORT`. Free tiers sleep, so start a fresh room after a wake-up.
- **Static hosts** (GitHub Pages, Netlify) can serve the standalone HTML for pass & play, but cannot run rooms.

**No laptop?** Use `VUSAL-cloud.zip` (or the `cloud/` folder in the full ZIP): four files that can be uploaded to GitHub from a phone browser and deployed by Render or Koyeb. `cloud/DEPLOY-PHONE.md` has the tap-by-tap steps.

Full steps, including why serverless functions will not work, are in **`DEPLOY.md`**. `package.json` (with `start` and `tunnel` scripts), `.gitignore`, `cloud/render.yaml` and `cloud/package.json` are included so hosts can auto-detect the app.

## What is in the box

| File | Purpose |
| --- | --- |
| `VUSAL-standalone.html` | Single-file offline build — open it anywhere, no server |
| `VUSAL-cloud.zip` | Four-file phone-only cloud deployment pack |
| `index.html` | Menu, game screen, card index, rulebook, original booklet |
| `style.css` | Minimal black-and-white layout (with an INVERT toggle) |
| `engine.js` | The whole rules engine. Pure JSON state, no DOM — runs in the browser and on the server |
| `app.js` | Interface for both play modes |
| `server.js` | Static files + online rooms (long-poll API) |
| `cards_data.js` | All 108 card texts and types, generated from `cards_manifest.csv` |
| `package.json` | `npm start` / `npm run tunnel` for local and hosted play |
| `DEPLOY.md` | Remote hosting: tunnels, Node hosts, static-host limitations |
| `START HERE.txt` | Three-line quick start |
| `manifest.webmanifest`, `assets/icon-*.png` | Add to Home Screen on mobile |
| `assets/cards/*.png` | All 108 original card faces, downloaded locally so nothing needs the internet |
| `assets/logo.png` | Your supplied "vusal™" script wordmark, cropped from the uploaded card-back artwork |
| `assets/favicon.png` | Favicon built from that wordmark |
| `build_standalone.py` | Regenerates the single-file offline build |
| `build_cloud.py` | Regenerates the phone-friendly four-file cloud deployment |
| `cloud/server.js` | One-file Node server with the game, engine, 108 cards, PWA assets and hosting guide embedded |
| `cloud/package.json`, `cloud/render.yaml` | Host auto-detection and Render free-plan settings |
| `cloud/DEPLOY-PHONE.md` | Phone-only GitHub → Render/Koyeb instructions |
| `exports/*.csv` | Your original PCIO import templates, now filled with real direct image URLs |

## The game

- 110 tiles: 100 normal plus Point Nemo, 0 down to −9.
- 108 cards: 36 Good, 36 Bad, 36 Vertigo. Draw on every even tile except in Point Nemo.
- 6 snakes, 5 ladders. They are not printed on the board by default — that was intentional. Turn on **Print snakes & ladders on the board** in the menu if you want them.
- Win by reaching 100, by landing on 3 → 7 → 13 in order on separate turns, or by a card that says you win. Land on −9 and you lose.
- Instant-result cards such as GC10, BC30 and VC20 stay automatic: a first-turn ending can be a legitimate card result, not a bug. VC25 blocks those results while it is in play. The game-over screen and LOG show the exact reason.
- Pawns are numbered 1–4 and the seat diagram shows north / east / south / west.
- 3 → 7 → 13 progress (one step per turn), statuses, cursed tiles and ongoing cards are all tracked visibly.
- **Table / DM controls** let the table overrule anything: set a tile, move a pawn, draw a card, eliminate, reshuffle, reverse order, clear rules, undo, force end turn, reset.

## What is automated, what is not

Automated: rolls and roll modifiers, movement, snakes and ladders, Point Nemo, even-tile draws, deck and discard, private hands, all deterministic card effects, targeting choices, tile choices, card choices, ongoing status effects, win and loss conditions.

Left to the table (shown as a card plus a question, not simulated): the Manila weather forecast, Wordle, buying food, insults, compliments, fun facts, the £1 owed to the Rothschilds family, and jazz. GC25 gives you a PLAY JAZZ button; the header JAZZ toggle plays a small synthesized bossa nova loop if you want it.

## House interpretations

The original rules leave a few things open. This build resolves them as follows (also listed in the in-game RULES tab):

- Snakes and ladders apply once per landing; they do not chain. 17 → 14 does not then climb 14 → 40.
- Reaching 100 needs an exact roll; an overshoot leaves you where you are. GC33 removes that requirement.
- 3 → 7 → 13 advances at most once per player turn: each tile must be landed on in a different turn. The final 13 is checked before the snake at 13.
- Overshooting zero in Point Nemo leaves you on 0. The turn-start drag applies at 0 too, taking you to −1; a roll of 1 then escapes through zero.
- Bad cards play immediately when drawn. Good cards stay in hand until played. Vertigo cards resolve immediately unless they are ongoing.
- BC2, BC7, BC14 and VC25 are sticky: they stay in hand and cannot be played to remove the effect.
- A round advances whenever the turn passes player 1, including after VC18 reverses direction.
- VC25's "no instant result" is global while the card is in hand.
- GC15 mirrors the next snake's distance upward; GC19 and GC12 intercept your next Bad card; GC20 adds five tiles when a Bad card is used against you.
- Showing your hand to anyone still eliminates you — that one is a social rule, so the table enforces it.

## Credits

Game, rules, booklet and card artwork by **Quevin Amoh Markin**. The card art comes from the Postimages gallery supplied with the build pack; direct URLs are recorded in `assets/card_urls.json` and in `exports/`. The PCIO build guide, board rules and card manifest were used as the source of truth for tile numbering, snakes, ladders and card text.
