// PixelPlein screen Service Worker
// Caches the screen app shell and all photo/thumb assets so the display NUC
// keeps running when the server or internet is temporarily unreachable.
//
// IMPORTANT: bump SHELL_VERSION whenever screen JS or CSS files change so
// that all NUC clients pick up the new app shell on their next load.

const SHELL_VERSION = 7;
const SHELL_CACHE   = `pixelplein-shell-v${SHELL_VERSION}`;
const MEDIA_CACHE   = 'pixelplein-media';
const VIDEO_CACHE   = 'pixelplein-videos';

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
  if (p.startsWith('/slide-assets/images/')) {
    event.respondWith(_cacheFirst(request, MEDIA_CACHE));
    return;
  }

  // Slide videos: cache the full file locally, then serve byte ranges from the
  // cached copy so <video> playback still works offline.
  if (p.startsWith('/slide-assets/videos/')) {
    event.respondWith(_videoCache(request));
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

  // Everything else (API, admin, WS, themes): Network-only
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

async function _videoCache(request) {
  const cacheKey = request.url;
  const cache    = await caches.open(VIDEO_CACHE);
  const range    = request.headers.get('range');

  try {
    let cached = await cache.match(cacheKey);
    if (!cached) {
      const fullResponse = await fetch(new Request(cacheKey, { method: 'GET' }));
      if (!fullResponse.ok) return fullResponse;
      await cache.put(cacheKey, fullResponse.clone());
      cached = fullResponse;
    }

    if (!range) return cached;
    return _buildRangeResponse(cached, range);
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function _buildRangeResponse(response, rangeHeader) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader || '');
  if (!match) {
    return new Response('Invalid Range', { status: 416, statusText: 'Range Not Satisfiable' });
  }

  const buffer = await response.arrayBuffer();
  const size   = buffer.byteLength;

  let start = match[1] === '' ? NaN : Number(match[1]);
  let end   = match[2] === '' ? NaN : Number(match[2]);

  if (Number.isNaN(start) && Number.isNaN(end)) {
    return new Response('Invalid Range', { status: 416, statusText: 'Range Not Satisfiable' });
  }

  if (Number.isNaN(start)) {
    const suffixLength = end;
    start = Math.max(0, size - suffixLength);
    end   = size - 1;
  } else {
    if (Number.isNaN(end) || end >= size) end = size - 1;
  }

  if (start < 0 || start >= size || end < start) {
    return new Response('Invalid Range', {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }

  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String((end - start) + 1));

  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers,
  });
}
