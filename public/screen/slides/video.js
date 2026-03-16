// Slide renderer: video
// Streams directly from /slide-assets/videos/ via HTTP range requests.
// The browser's native HTTP cache (not the SW) handles video caching since
// the SW Cache API cannot correctly serve 206 Partial Content responses.

import { el } from '../../shared/utils.js';

/**
 * @param {object} slide
 * @returns {{ el: HTMLElement, play: () => Promise<void> }}
 */
export function buildVideoSlide(slide) {
  const src = `/slide-assets/videos/${encodeURIComponent(slide.filename)}`;

  const video = el('video', { attrs: { preload: 'auto' } });
  video.muted       = slide.muted !== false;
  video.playsInline = true;
  video.src         = src; // set src directly — no <source> type hint which causes
                           // Chrome to immediately reject video/quicktime on both
                           // macOS and Linux regardless of actual codec

  const wrap = el('div', { cls: 'slide-video' }, video);

  const playCount       = typeof slide.playCount === 'number' ? slide.playCount : 1;
  const MAX_DURATION_MS = 5 * 60 * 1000;
  const ERROR_HOLD_MS   = 2_000; // if a frame decoded, show it briefly before advancing

  function play() {
    return new Promise(resolve => {
      let playsLeft = playCount === 0 ? Infinity : playCount;
      let done      = false;

      const safetyTimer = setTimeout(finish, MAX_DURATION_MS);

      function finish() {
        if (done) return;
        done = true;
        clearTimeout(safetyTimer);
        video.removeEventListener('ended',  onEnded);
        video.removeEventListener('error',  onError);
        resolve();
      }

      function onEnded() {
        playsLeft -= 1;
        if (playsLeft <= 0) {
          finish();
        } else {
          video.currentTime = 0;
          video.play().catch(finish);
        }
      }

      function onError() {
        // readyState >= 1 means at least metadata (and usually the first frame)
        // was decoded — hold it on screen briefly rather than flashing past.
        if (video.readyState >= 1) {
          setTimeout(finish, ERROR_HOLD_MS);
        } else {
          finish();
        }
      }

      // Register listeners BEFORE calling play() so nothing is missed.
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError, { once: true });

      // Call play() immediately — if the browser needs more data it queues
      // the request internally; the promise only rejects on actual failures
      // (unsupported codec, network error, autoplay policy).
      // readyState >= 2 means canplay already fired; we can start immediately.
      // readyState < 2 means the browser will begin buffering and start when ready.
      video.play().catch(onError);
    });
  }

  return { el: wrap, play };
}
