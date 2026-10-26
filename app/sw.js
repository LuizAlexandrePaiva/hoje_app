// Service worker: cache-first para os arquivos do app (funciona 100% offline
// depois da primeira visita). Ao publicar mudanças, aumente CACHE_VERSION.

const CACHE_VERSION = '1.4.0';
const CACHE = `hoje-${CACHE_VERSION}`;

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/favicon-48.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/app.js',
  './js/version.js',
  './js/core/dates.js',
  './js/core/money.js',
  './js/core/businessDays.js',
  './js/core/schedule.js',
  './js/core/budget.js',
  './js/core/refill.js',
  './js/core/projection.js',
  './js/data/ledger.js',
  './js/data/store.js',
  './js/data/sync.js',
  './js/core/vault.js',
  './js/ui/backup.js',
  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/editors.js',
  './js/ui/screens/today.js',
  './js/ui/screens/spend.js',
  './js/ui/screens/timeline.js',
  './js/ui/screens/accounts.js',
  './js/ui/screens/goals.js',
  './js/ui/screens/settings.js',
  './js/ui/screens/setup.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hoje-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // a API do backup nunca passa pelo cache
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Navegação (abrir o app): sempre o index.html do cache
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
