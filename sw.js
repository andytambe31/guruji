/* Guruji service worker — offline app shell.
   Cache-first for the shell so the app opens with no network. Bump
   CACHE_VERSION on any shell change to force clients to refresh. */
const CACHE_VERSION = 'guruji-v69';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/db.js',
  './js/store.js',
  './js/schedule.js',
  './js/ics.js',
  './js/migrations.js',
  './js/importexport.js',
  './js/util.js',
  './js/views/now.js',
  './js/views/prep.js',
  './js/views/focus.js',
  './js/views/plan.js',
  './js/views/day.js',
  './js/views/reading.js',
  './js/views/data.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  // Network-first for same-origin app code: when online, every reload gets the
  // freshly-deployed version (no more stale-cache after a fix ships); when
  // offline, fall back to the cached shell so the app still opens. The cache is
  // kept warm on each successful fetch.
  const isNav = request.mode === 'navigate';
  const key = isNav ? './index.html' : request;
  event.respondWith(
    fetch(request).then((resp) => {
      if (resp && resp.ok && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(key, copy));
      }
      return resp;
    }).catch(() => caches.match(key).then((c) => c || caches.match('./index.html')))
  );
});
