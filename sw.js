// Service worker: cache-first app shell so the game works offline.
// Bump VERSION whenever you deploy changes.
const VERSION = 'ludo3d-v23';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './snakes.html',
  './css/snakes.css',
  './js/fx3d.js',
  './js/bgdice.js',
  './js/viewctl.js',
  './js/snakes/main.js',
  './js/snakes/scene.js',
  './js/snakes/rules.js',
  './js/main.js',
  './js/board.js',
  './js/dice.js',
  './js/game.js',
  './js/ai.js',
  './js/audio.js',
  './js/anim.js',
  './js/net.js',
  './js/bgfx.js',
  './js/luck.js',
  './js/constants.js',
  './vendor/three.module.min.js',
  './vendor/OrbitControls.js',
  './vendor/RoundedBoxGeometry.js',
  './vendor/RoomEnvironment.js',
  './vendor/cannon-es.js',
  './vendor/peerjs.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // PeerJS signalling etc. goes straight to network

  // Navigations: network first (fresh deploys), fall back to cached shell offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }

  // Static assets: stale-while-revalidate
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    }),
  );
});
