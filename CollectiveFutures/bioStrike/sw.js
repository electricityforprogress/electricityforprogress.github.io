const CACHE_NAME = 'biostrike-pwa-v1';
const CORE_ASSETS = [
    './',
    './bioStrike.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// Pre-cache core local assets on installation
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
    );
    self.skipWaiting();
});

// Clean up old caches when a new version activates
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        ))
    );
    self.clients.claim();
});

// Intercept network requests
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // Serve from cache if available (instant loading)
            if (cachedResponse) {
                return cachedResponse;
            }
            
            // If not in cache (e.g., Tailwind CDN, Google Fonts), fetch and dynamically cache
            return fetch(event.request).then((response) => {
                // Ensure we only cache valid responses
                if (!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors') {
                    return response;
                }
                
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                
                return response;
            }).catch(() => {
                // Failsafe for when completely offline and resource isn't cached yet
                console.log('Offline and resource not cached:', event.request.url);
            });
        })
    );
});