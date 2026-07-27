// frontend-user/service-worker.js

const CACHE_VERSION = 'v2.2';   // Increment this when updating the app (e.g., v2.2, v2.3...)
const CACHE_NAME = `medexam-${CACHE_VERSION}`;

// List of assets to cache on install (update this list when adding new files)
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// Install event: cache static assets, ignoring external failures
self.addEventListener('install', event => {
  console.log(`[Service Worker] Installing version ${CACHE_VERSION}`);
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const results = await Promise.allSettled(
        STATIC_ASSETS.map(async url => {
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await cache.put(url, response);
            console.log(`[Service Worker] Cached: ${url}`);
          } catch (err) {
            console.warn(`[Service Worker] Failed to cache ${url}:`, err.message);
          }
        })
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      console.log(`[Service Worker] Cached ${results.length - failed} assets, ${failed} failed (ignored).`);
    }).then(() => self.skipWaiting())
  );
});

// Activate event: delete old caches and take control of all clients
self.addEventListener('activate', event => {
  console.log(`[Service Worker] Activating version ${CACHE_VERSION}`);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log(`[Service Worker] Deleting old cache: ${key}`);
          return caches.delete(key);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch event: serve from cache first, fallback to network
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Skip cross‑origin requests except fonts and CDNs (we still try to fetch them)
  if (!isSameOrigin && 
      !url.href.includes('fonts.googleapis.com') && 
      !url.href.includes('cdn.quilljs.com')) {
    return;
  }

  // API calls: network first, fallback to cache (optional)
  if (url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: cache first (including JSON question files)
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          // Optionally cache question JSONs for offline use
          if (url.pathname.includes('/data/questions/')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
      .catch(() => {
        // If offline and requesting a navigation, show offline page
        if (event.request.mode === 'navigation') {
          return caches.match('/pages/offline.html');
        }
        // Fallback for other resources: maybe a generic placeholder
        return new Response('Offline content not available.', { status: 404 });
      })
  );
});

// Background sync for exam results (unchanged)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-exam-results') {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(client => client.postMessage({ type: 'SYNC_EXAMS' }))
      )
    );
  }
});

// Message handling: allow page to trigger skipWaiting
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});