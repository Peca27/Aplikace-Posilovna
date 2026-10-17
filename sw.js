/* Posilka — service worker: cache-first, plně offline */
const CACHE = 'posilka-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      // jen vlastní staré cache — na stejné doméně běží i Šachy (sachy/)
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('posilka-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  // Šachy (sachy/) mají vlastní service worker a cache
  if (new URL(ev.request.url).pathname.startsWith(new URL('sachy/', self.registration.scope).pathname)) return;
  ev.respondWith(
    caches.match(ev.request, { ignoreSearch: true }).then(
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
