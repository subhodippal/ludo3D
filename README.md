# Ludo 3D

A mobile-first 3D Ludo game that runs in the browser and installs as a PWA. Built with
[three.js](https://threejs.org/) for rendering and [cannon-es](https://github.com/pmndrs/cannon-es) for the dice physics.
It's a static site with no build step, so it can be hosted on GitHub Pages as-is.

## Features

- **Single player:** play against 1–3 computer opponents (Easy / Normal / Hard).
- **Pass & Play:** 2–4 players on one device, with any mix of humans and computers.
- **Online multiplayer:** create a room and share the 5-letter code or link. Friends join from their own phones. Uses WebRTC (PeerJS), so you don't need a server of your own. Empty seats can be filled by the computer, and if a player drops out the computer takes over their pawns.
- **Real dice physics:** the die is thrown from the current player's corner. It bounces off the board, the frame and the pawns, and its collision sounds follow the impacts. The result comes from a fair crypto RNG and the physics run is mapped onto that value, so online games stay in sync.
- **Lucky dice** (on by default, can be turned off in Settings): if all your tokens are still in the yard, you get a 6 within 3 turns. If some number would let you cut an opponent, there's a 75% chance you roll it. If an opponent comes near your start square while you have tokens in the yard, there's a 70% chance of a 6. If an exact number would bring a token home, there's a 60% chance of it. These apply equally to every player, computer included.
- **Celebrations:** rolling a six, bringing a token out, landing on a star, making a double (two of your tokens on one square), capturing, reaching home and finishing each get their own banner, emoji burst, 3D effect and sound. Firecrackers also go off in the background in that player's colour.
- **Emoji reactions** in online games: tap the smiley button to send an emoji that pops up from your badge for everyone.
- **Animation and sound:** pawns hop square by square, captured tokens fly back to their yard, and there are particle bursts and confetti. All sounds are generated with Web Audio, so there are no audio files. Phones also vibrate on some events.
- **PWA:** installable and works offline (except online play). Local games auto-save and can be continued later.
- **Controls:** touch and mouse. Tap the dice on your player badge (or the 3D die), then tap a glowing token. Drag to orbit and pinch or scroll to zoom. On a keyboard, Space rolls and 1–4 picks a pawn.

## Rules used

- You need a 6 to bring a pawn out.
- Rolling a 6, capturing a pawn or getting a pawn home gives you another roll. Three 6s in a row ends your turn.
- Start squares and star squares are safe.
- You need the exact roll to reach home.
- Finishing order is ranked. The game ends when one player is left.

## Run locally

ES modules and the service worker need an HTTP server (opening the file directly won't work):

```bash
node server.js            # http://localhost:8080 (no npm install needed)
PORT=3000 node server.js  # custom port
```

It also prints your network address so you can open the game on your phone.

To test on your phone on the same Wi-Fi, open `http://<your-computer-ip>:8080`. The service worker and install prompt only work on `localhost` or over HTTPS, and GitHub Pages provides HTTPS.

## Deploy to GitHub Pages

```bash
git init && git add . && git commit -m "Ludo 3D"
git branch -M main
git remote add origin https://github.com/<you>/ludo3d.git
git push -u origin main
```

Then go to **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose `main` / `(root)` and save.
The game will be at `https://<you>.github.io/ludo3d/`. All paths are relative, so any repo name works.

**After each deploy, bump `VERSION` in `sw.js`** (for example `ludo3d-v2`) so installed copies pick up the new files.

## Project layout

```
index.html              UI shell (menus, HUD)
css/style.css           Mobile-first styles
js/main.js              Game controller: modes, turns, UI, online sync
js/game.js              Pure deterministic rules engine
js/ai.js                Computer opponent heuristics
js/board.js             three.js scene: board, pawns, camera, picking, effects
js/dice.js              cannon-es dice simulation + replay
js/audio.js             Procedural Web Audio sound effects
js/net.js               PeerJS host/client wrappers
js/bgfx.js              Background firecrackers (2D canvas)
js/luck.js              Lucky dice rules (tunable via the LUCK constants)
js/constants.js         Board geometry
vendor/                 three.js r170, cannon-es 0.20, PeerJS 1.5.4 (MIT)
sw.js, manifest.webmanifest, icons/   PWA
```

## Online play notes

Online play uses the free public PeerJS broker (`0.peerjs.com`) only to connect players. After that, game data goes directly between devices.
The host's device runs the game: it rolls the dice and checks every move, and the other players only send requests to it.
On a few very strict networks (some corporate or mobile carrier NATs), a direct WebRTC connection can't be made without a TURN server.
To add one, pass a `config: { iceServers: [...] }` option where `new window.Peer(...)` is called in `js/net.js`.
