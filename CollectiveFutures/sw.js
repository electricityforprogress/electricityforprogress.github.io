/**
 * bioQuad Stream - Offline-First Service Worker
 * Designed for pure vanilla static hosting and GitHub Pages.
 */

const CACHE_NAME = 'bioquad-stream-v2.0.2';

const PRECACHE_URLS = [
  './',
  './index.html',
  './flasher.html',
  './manifest.json',
  './css/styles.css',
  './css/flasher.css',
  './css/bioquad-icon.svg',
  './js/syncCore.js',
  './js/globals.js',
  './js/audioEngine.js',
  './js/uiController.js',
  './js/visualizer.js',
  './js/bleMidi.js',
  './js/usbSerial.js',
  './js/mqttFeeds.js',
  './js/dataStreamer.js',
  './js/streamPortalUI.js',
  './js/pwa.js',
  './js/main.js',
  './js/flasher.js',
  './firmware/manifest.json',
  './firmware/biodata_quad.ino',
  './datasets/nasa_telemetry_iss.csv',
  './datasets/ekg_heart_biometrics.csv',
  './datasets/market_crypto_hft.csv',
  './datasets/deep_forest_mycelium.csv'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Some precache assets failed:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  if (url.origin.includes('fonts.googleapis.com') ||
      url.origin.includes('fonts.gstatic.com') ||
      url.origin.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const response = await fetch(event.request);
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch (e) {
          return cached || new Response('', { status: 408 });
        }
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
