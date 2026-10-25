// Offline cache. Bump VERSION when any cached file changes so installed copies pick it up.
const VERSION = 'v11';
const CACHE = `german-quiz-${VERSION}`;
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'src/app.js', 'src/domain.js', 'src/content.js', 'src/controller.js', 'src/store.js', 'src/i18n.js', 'src/strings.js',
  'vocab/nouns.json', 'vocab/prepositions.json', 'vocab/verbs.json', 'vocab/errors.json',
  'i18n/de.json', 'i18n/pt.json', 'i18n/es.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Network first, cache as the offline fallback. The network request revalidates ("no-cache"), because GitHub Pages sends
// max-age=600 and the browser would otherwise keep serving a deploy that is ten minutes old. After 4 s without an answer
// (bad connection) the cached copy is used, so the app still opens quickly offline.
const NETWORK_TIMEOUT_MILLIS = 4000;

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MILLIS));
      const res = await Promise.race([fetch(e.request, { cache: 'no-cache' }), timeout]);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(e.request, { ignoreSearch: true })) ?? Response.error();
    }
  })());
});
