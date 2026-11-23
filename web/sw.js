// Service worker: guarda la aplicación para que abra rápido y se pueda instalar.
// Solo cachea archivos propios; las llamadas a TIDAL y setlist.fm van siempre a la red.
const VERSION = 'v1';
const CACHE = `setlist2tidal-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'config.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'js/app.js',
  'js/i18n.js',
  'js/storage.js',
  'js/api/auth.js',
  'js/api/errors.js',
  'js/api/setlistfm.js',
  'js/api/tidal.js',
  'js/core/matcher.js',
  'js/core/setlist.js',
  'js/core/text.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Red primero (para recibir siempre la última versión) y caché si no hay conexión.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
