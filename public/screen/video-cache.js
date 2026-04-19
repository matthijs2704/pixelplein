const VIDEO_CACHE = 'pixelplein-videos';
const _pending = new Map();

function _videoUrl(filename) {
  return `/slide-assets/videos/${encodeURIComponent(filename)}`;
}

export function getVideoRequestUrl(filename) {
  return _videoUrl(filename);
}

/**
 * Ensures the video is stored in the Cache API. Returns void.
 * Safe to call concurrently — duplicate in-flight fetches are deduplicated.
 */
export async function cacheVideoFile(filename) {
  if (!filename) throw new Error('Missing video filename');
  if (typeof caches === 'undefined') return;

  const url = _videoUrl(filename);
  const existing = _pending.get(url);
  if (existing) return existing;

  const work = (async () => {
    const cache = await caches.open(VIDEO_CACHE);
    if (await cache.match(url)) return; // already cached

    console.log('[video-cache] fetching:', url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Video fetch failed: ${response.status}`);
    console.log('[video-cache] storing in cache, content-type:', response.headers.get('content-type'), 'status:', response.status);
    await cache.put(url, response);
    console.log('[video-cache] cached:', url);
  })();

  _pending.set(url, work);
  try {
    await work;
  } finally {
    _pending.delete(url);
  }
}

/**
 * Returns a blob URL for the video, caching it first if needed.
 * Each call returns a fresh blob URL — caller must revoke it when done.
 * Reads a fresh Response from the Cache API so concurrent callers each
 * get their own independent body (Response bodies can only be consumed once).
 */
export async function getVideoObjectUrl(filename) {
  if (!filename) throw new Error('Missing video filename');

  const url = _videoUrl(filename);

  if (typeof caches !== 'undefined') {
    await cacheVideoFile(filename);
    const cache = await caches.open(VIDEO_CACHE);
    const response = await cache.match(url);
    console.log('[video-cache] cache.match result:', response ? `${response.status} ${response.headers.get('content-type')}` : 'null');
    if (response) {
      const blob = await response.blob();
      console.log('[video-cache] blob size:', blob.size, 'type:', blob.type);
      return URL.createObjectURL(blob);
    }
  }

  // Fallback: Cache API unavailable — fetch directly each time
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Video fetch failed: ${response.status}`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
