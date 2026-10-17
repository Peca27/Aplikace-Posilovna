/* Šachy — service worker: cache-first, plně offline */
const CACHE = 'sachy-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './engine.js',
  './ai-worker.js',
  './pieces.js',
  './rules.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  // mažeme jen vlastní staré cache — na stejné doméně může běžet i jiná aplikace
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sachy-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    // hledáme jen ve vlastní cache, ne v cache jiné aplikace na stejné doméně
    caches.open(CACHE).then((c) => c.match(ev.request, { ignoreSearch: true })).then(
      (cached) =>
        cached ||
        fetch(ev.request).then((resp) => {
          if (resp.ok && new URL(ev.request.url).origin === self.location.origin) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(ev.request, copy));
          }
          return resp;
        })
    )
  );
});
