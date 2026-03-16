// Image preloading queue with bounded concurrency.
// Keeps the display loop smooth on high-latency connections.

import { photoUrl } from '../shared/utils.js';

const MAX_CONCURRENT = 4;

const _queue            = [];
const _queuedUrls       = new Set();
const _inflightUrls     = new Set();
const _loadedUrls       = new Set();
const _loadedDisplayIds = new Set();

// ---------------------------------------------------------------------------
// Speed tracking — rolling window of (timestamp, bytes) completions
// ---------------------------------------------------------------------------

const SPEED_WINDOW_MS  = 5000;  // rolling 5-second window
const _completions     = [];    // [{ ts, bytes }]

function _recordCompletion(url) {
  // Use PerformanceResourceTiming to get actual transfer size if available.
  // transferSize is 0 when served from SW/browser cache — that's fine, it
  // still counts as a completed photo for the progress display.
  let bytes = 0;
  if (typeof performance !== 'undefined') {
    const entries = performance.getEntriesByName(url, 'resource');
    const entry   = entries[entries.length - 1];
    if (entry) bytes = entry.transferSize || entry.encodedBodySize || 0;
  }

  const now = Date.now();
  _completions.push({ ts: now, bytes });

  // Prune entries outside the window
  const cutoff = now - SPEED_WINDOW_MS;
  while (_completions.length && _completions[0].ts < cutoff) _completions.shift();
}

/**
 * Returns live preload statistics for the sync progress display.
 * @returns {{ preloaded: number, total: number, bytesPerSec: number }}
 */
export function getPreloadStats() {
  const preloaded = _loadedDisplayIds.size;

  // total = everything we know about (queued + inflight + loaded)
  const total = _loadedUrls.size + _inflightUrls.size + _queuedUrls.size + _queue.length;

  // bytes per second from rolling window
  let bytesPerSec = 0;
  if (_completions.length >= 2) {
    const windowMs = _completions[_completions.length - 1].ts - _completions[0].ts;
    if (windowMs > 0) {
      const totalBytes = _completions.reduce((s, c) => s + c.bytes, 0);
      bytesPerSec = Math.round((totalBytes / windowMs) * 1000);
    }
  }

  return { preloaded, total, bytesPerSec };
}

// ---------------------------------------------------------------------------
// Queue / drain
// ---------------------------------------------------------------------------

function _enqueue(url, onLoad) {
  if (!url) return;
  if (_loadedUrls.has(url) || _queuedUrls.has(url) || _inflightUrls.has(url)) return;
  _queue.push({ url, onLoad });
  _queuedUrls.add(url);
}

function _drain() {
  while (_inflightUrls.size < MAX_CONCURRENT && _queue.length) {
    const next = _queue.shift();
    if (!next) break;

    const { url, onLoad } = next;
    _queuedUrls.delete(url);
    _inflightUrls.add(url);

    const img = new Image();
    img.onload = () => {
      _inflightUrls.delete(url);
      _loadedUrls.add(url);
      _recordCompletion(url);
      if (onLoad) onLoad();
      _drain();
    };
    img.onerror = () => {
      _inflightUrls.delete(url);
      _drain();
    };
    img.src = url;
  }
}

export function preloadPhoto(photo) {
  if (!photo?.id) return;

  const displayUrl = photoUrl(photo);
  const thumbUrl   = photo.thumbUrl || '';

  if (displayUrl) {
    if (_loadedUrls.has(displayUrl)) {
      _loadedDisplayIds.add(photo.id);
    } else {
      _enqueue(displayUrl, () => {
        _loadedDisplayIds.add(photo.id);
      });
    }
  }

  if (thumbUrl) _enqueue(thumbUrl);
  _drain();
}

export function preloadBatch(photos) {
  if (!Array.isArray(photos)) return;
  for (const photo of photos) preloadPhoto(photo);
}

export function isPreloaded(photoId) {
  return _loadedDisplayIds.has(photoId);
}

export function clearPreloaded(photoId) {
  _loadedDisplayIds.delete(photoId);
}

export function getPreloadedCount() {
  return _loadedDisplayIds.size;
}
