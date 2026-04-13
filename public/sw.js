// PixelPlein screen Service Worker
// Caches the screen app shell and all photo/thumb assets so the display NUC
// keeps running when the server or internet is temporarily unreachable.
//
// IMPORTANT: bump SHELL_VERSION whenever screen JS or CSS files change so
// that all NUC clients pick up the new app shell on their next load.

const SHELL_VERSION = 5;
const SHELL_CACHE   = `pixelplein-shell-v${SHELL_VERSION}`;
const MEDIA_CACHE   = 'pixelplein-media';

// ---------------------------------------------------------------------------
// App shell manifest — every file the screen page needs to run offline
// ---------------------------------------------------------------------------

const SHELL_URLS = [
  '/screen.html',
  '/favicon.svg',

  // Screen JS modules
  '/screen/app.js',
  '/screen/fit.js',
  '/screen/heartbeat.js',
  '/screen/idb.js',
  '/screen/photo-selection.js',
  '/screen/photos.js',
  '/screen/preload.js',
  '/screen/slide-preload.js',
  '/screen/submissions.js',
  '/screen/sync-status.js',
  '/screen/templates.js',
  '/screen/theme.js',
  '/screen/transitions.js',
  '/screen/ws-send.js',

  // Layouts
  '/screen/layouts/index.js',
  '/screen/layouts/featuredduo.js',
  '/screen/layouts/fullscreen.js',
  '/screen/layouts/mosaic.js',
  '/screen/layouts/polaroid.js',
  '/screen/layouts/sidebyside.js',
  '/screen/layouts/submissionwall.js',

  // Overlays
  '/screen/overlays/index.js',
  '/screen/overlays/_overlay-utils.js',
  '/screen/overlays/alerts.js',
  '/screen/overlays/bug.js',
  '/screen/overlays/event-resolver.js',
  '/screen/overlays/infobar.js',
  '/screen/overlays/qr-bug.js',
  '/screen/overlays/ticker.js',

  // Slide renderers
  '/screen/slides/index.js',
  '/screen/slides/article.js',
  '/screen/slides/image.js',
  '/screen/slides/qr.js',
  '/screen/slides/textcard.js',
  '/screen/slides/video.js',
  '/screen/slides/webpage.js',

  // Shared utilities
  '/shared/utils.js',
  '/shared/icons.js',

  // Stylesheets
  '/styles/base.css',
  '/styles/screen.css',
  '/styles/screen-layouts.css',
  '/styles/screen-overlays.css',
  '/styles/screen-slides.css',
];

// ---------------------------------------------------------------------------
// Install — pre-cache the app shell
// ---------------------------------------------------------------------------

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[sw] Shell pre-cache failed:', err.message)),
  );
});

// ---------------------------------------------------------------------------
// Activate — delete stale shell caches
// ---------------------------------------------------------------------------

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => k.startsWith('pixelplein-shell-') && k !== SHELL_CACHE)
        .map(k => {
          console.log('[sw] Deleting stale cache:', k);
          return caches.delete(k);
        }),
    )).then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------------------------
// Fetch — route requests to the appropriate cache strategy
// ---------------------------------------------------------------------------

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const p = url.pathname;

  // Photos and thumbs: Cache-first (URLs are already versioned with ?v=...)
  if (p.startsWith('/photos/') || p.startsWith('/thumbs/')) {
    event.respondWith(_cacheFirst(request, MEDIA_CACHE));
    return;
  }

  // Slide images: Cache-first — images are immutable once uploaded, same
  // bucket as photos so they survive offline.
  // Videos are intentionally excluded: the SW Cache API cannot correctly serve
  // 206 Partial Content range requests, so we let the browser's native HTTP
  // cache (warmed by slide-preload.js + 7-day max-age from the server) handle it.
  if (p.startsWith('/slide-assets/images/')) {
    event.respondWith(_cacheFirst(request, MEDIA_CACHE));
    return;
  }

  // App shell files: Cache-first
  if (
    p === '/screen.html' ||
    p.startsWith('/screen/') ||
    p.startsWith('/styles/screen') ||
    p === '/styles/base.css' ||
    p.startsWith('/shared/') ||
    p === '/favicon.svg'
  ) {
    event.respondWith(_cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Everything else (API, admin, WS, videos, themes): Network-only
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cache-first strategy.
 * Serves from cache if available; on miss fetches from network and stores.
 * If both fail, returns a bare 503 so the caller can handle gracefully.
 */
async function _cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}
