const CACHE_NAME = 'ritual-tracker-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/style-overrides-meditation.css',
  '/schedule.js',
  '/meditation-cloud.js',
  '/ritual_tracker.png',
  '/ritual_tracker-192.png',
  '/ritual_tracker-180.png',
  '/rohto.html',
  '/manifest-rohto.json',
  '/rhoto_v5.png',
  '/rice-bran.html',
  '/manifest-rice-bran.json',
  '/rice_bran.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ネットワーク優先・失敗時はキャッシュから返す
self.addEventListener('fetch', event => {
  // APIリクエストはキャッシュしない
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
