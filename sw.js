// Offline cache. Bump VERSION when any cached file changes so installed copies pick it up.
const VERSION = 'v1';
const CACHE = `german-quiz-${VERSION}`;
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'src/app.js', 'src/domain.js', 'src/content.js', 'src/controller.js', 'src/store.js',
  'vocab/nouns.json', 'vocab/prepositions.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Cache first, refresh in the background: instant and offline, and new versions arrive on the next open.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const network = fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || network;
    }));
});
