// Slide asset preloader — fetches images and starts video buffering for all
// slides in the active playlist so content is ready before it needs to play.
//
// Videos: creates a detached <video preload="auto"> element. The browser
//   starts downloading the first segment immediately, warming the HTTP cache
//   so the lookahead element in slides/index.js finds data ready to play.
//
// Images / article images: uses new Image() (same pattern as preload.js).
//
// Other slide types (text-card, qr, webpage): no network asset, instantly ready.

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Map<string, 'pending'|'ready'|'error'>} slideId → state */
const _state       = new Map();
const _totalByType = { video: 0, image: 0 };
let   _readyCount  = 0;

// Speed tracking — rolling 5-second window of (timestamp, bytes)
const SPEED_WINDOW_MS = 5_000;
/** @type {Array<{ ts: number, bytes: number }>} */
const _completions    = [];

function _recordCompletion(url) {
  let bytes = 0;
  if (typeof performance !== 'undefined') {
    const entries = performance.getEntriesByName(url, 'resource');
    const entry   = entries[entries.length - 1];
    if (entry) bytes = entry.transferSize || entry.encodedBodySize || 0;
  }
  const now    = Date.now();
  const cutoff = now - SPEED_WINDOW_MS;
  _completions.push({ ts: now, bytes });
  while (_completions.length && _completions[0].ts < cutoff) _completions.shift();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start preloading assets for all slides that appear in active playlists.
 * Safe to call multiple times — already-preloading entries are skipped.
 *
 * @param {object[]} slides     - full slide library
 * @param {object[]} playlists  - full playlist library
 */
export function preloadSlideAssets(slides, playlists) {
  if (!Array.isArray(slides) || !Array.isArray(playlists)) return;

  // Collect slide IDs that are actually in at least one active playlist
  const activeIds = new Set();
  for (const pl of playlists) {
    for (const id of (pl.slideIds || [])) activeIds.add(id);
  }

  for (const slide of slides) {
    if (!activeIds.has(slide.id))              continue;
    if (slide.enabled === false)               continue;
    if (slide._missing || slide._transcoding)  continue;
    if (_state.has(slide.id))                  continue; // already queued / done

    _state.set(slide.id, 'pending');
    _startPreload(slide);
  }
}

/**
 * @returns {{ preloaded: number, total: number, bytesPerSec: number }}
 */
export function getSlidePreloadStats() {
  const total    = _state.size;
  const preloaded = _readyCount;

  let bytesPerSec = 0;
  if (_completions.length >= 2) {
    const windowMs   = _completions[_completions.length - 1].ts - _completions[0].ts;
    const totalBytes = _completions.reduce((s, c) => s + c.bytes, 0);
    if (windowMs > 0) bytesPerSec = Math.round((totalBytes / windowMs) * 1000);
  }

  return { preloaded, total, bytesPerSec };
}

/** Returns true once the slide's asset has been preloaded (or if it needs none). */
export function isSlideAssetReady(slideId) {
  const s = _state.get(slideId);
  return s === 'ready' || s === 'error'; // treat error as "ready enough" — slide handles it
}

/** Reset all state — called when slides list changes significantly. */
export function resetSlidePreload() {
  _state.clear();
  _readyCount = 0;
  _completions.length = 0;
}

// ---------------------------------------------------------------------------
// Per-type preload logic
// ---------------------------------------------------------------------------

function _markReady(slideId, url) {
  if (_state.get(slideId) === 'pending') {
    _state.set(slideId, 'ready');
    _readyCount += 1;
    if (url) _recordCompletion(url);
  }
}

function _markError(slideId) {
  if (_state.get(slideId) === 'pending') {
    _state.set(slideId, 'error');
    _readyCount += 1; // still counts as "done" for progress purposes
  }
}

function _startPreload(slide) {
  switch (slide.type) {
    case 'video':   _preloadVideo(slide);        break;
    case 'image':   _preloadImage(slide);         break;
    case 'article': _preloadArticleImage(slide);  break;
    default:
      // text-card, qr, webpage — no network asset required
      _markReady(slide.id, null);
  }
}

// ── Video ──────────────────────────────────────────────────────────────────

function _preloadVideo(slide) {
  if (!slide.filename) { _markError(slide.id); return; }
  const src = `/slide-assets/videos/${encodeURIComponent(slide.filename)}`;

  // Create a detached <video> element. With preload="auto" the browser begins
  // downloading the first segment even without DOM insertion, which:
  //   1. Warms the browser's HTTP cache for range requests
  //   2. Gives the lookahead element in slides/index.js data to play immediately
  const video       = document.createElement('video');
  video.muted       = true;
  video.playsInline = true;
  video.preload     = 'auto';
  video.src         = src;

  // Resolve as soon as enough data exists to start playback
  video.addEventListener('canplay', () => {
    _markReady(slide.id, src);
    // Release the element once it's served its purpose — the lookahead
    // element in slides/index.js will create its own fresh instance.
    video.src = '';
    video.load();
  }, { once: true });

  video.addEventListener('error', () => _markError(slide.id), { once: true });

  // Safety: mark ready after 15 s even if canplay never fires (slow network /
  // large file where a few seconds is enough to start playing anyway).
  setTimeout(() => {
    if (_state.get(slide.id) === 'pending') _markReady(slide.id, src);
    video.src = '';
    video.load();
  }, 15_000);
}

// ── Image slide ────────────────────────────────────────────────────────────

function _preloadImage(slide) {
  if (!slide.filename) { _markError(slide.id); return; }
  const url = `/slide-assets/images/${encodeURIComponent(slide.filename)}`;
  _fetchImage(slide.id, url);
}

// ── Article slide ──────────────────────────────────────────────────────────

function _preloadArticleImage(slide) {
  if (slide.imageSource === 'pool' || !slide.imageFilename) {
    // Random pool photo — no fixed URL to preload; mark ready immediately
    _markReady(slide.id, null);
    return;
  }
  const url = `/slide-assets/images/${encodeURIComponent(slide.imageFilename)}`;
  _fetchImage(slide.id, url);
}

function _fetchImage(slideId, url) {
  const img   = new Image();
  img.onload  = () => _markReady(slideId, url);
  img.onerror = () => _markError(slideId);
  img.src     = url;
}
