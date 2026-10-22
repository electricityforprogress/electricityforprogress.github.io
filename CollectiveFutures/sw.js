const CACHE_NAME = 'bioquad-offline-v1';
const urlsToCache = [
  './',
  './index.html',
  './css/styles.css?v=11',
  './js/globals.js?v=11',
  './js/audioEngine.js?v=11',
  './js/uiController.js?v=11',
  './js/visualizer.js?v=11',
  './js/bleMidi.js?v=11',
  './js/main.js?v=11'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response; // Return cached version
        }
        return fetch(event.request); // Otherwise fetch from network
      })
  );
});
