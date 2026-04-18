// Slide renderer: video

import { el } from '../../shared/utils.js';
import { getVideoObjectUrl } from '../video-cache.js';

/**
 * @param {object} slide
 * @returns {{ el: HTMLElement, play: () => Promise<void> }}
 */
export async function buildVideoSlide(slide) {
  const src = await getVideoObjectUrl(slide.filename);
  const muted = slide.muted !== false;

  const video = el('video', { attrs: { preload: 'auto' } });
  video.muted       = muted;
  video.defaultMuted = muted;
  if (muted) video.setAttribute('muted', '');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.autoplay    = true;
  video.src         = src;

  const wrap = el('div', { cls: 'slide-video' }, video);

  const playCount       = typeof slide.playCount === 'number' ? slide.playCount : 1;
  const MAX_DURATION_MS = 5 * 60 * 1000;
  const ERROR_HOLD_MS   = 2_000; // if a frame decoded, show it briefly before advancing
  const STARTUP_GRACE_MS = 4_000;

  function play(signal) {
    return new Promise(resolve => {
      if (signal?.aborted) {
        resolve();
        return;
      }

      let playsLeft = playCount === 0 ? Infinity : playCount;
      let done      = false;
      let started   = false;
      let startupTimer = null;

      const safetyTimer = setTimeout(finish, MAX_DURATION_MS);

      function finish() {
        if (done) return;
        done = true;
        clearTimeout(safetyTimer);
        if (startupTimer) clearTimeout(startupTimer);
        video.removeEventListener('ended',  onEnded);
        video.removeEventListener('error',  onError);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('loadedmetadata', tryStart);
        video.removeEventListener('canplay', tryStart);
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }

      function onAbort() {
        try { video.pause(); } catch {}
        finish();
      }

      function onEnded() {
        playsLeft -= 1;
        if (playsLeft <= 0) {
          finish();
        } else {
          video.currentTime = 0;
          tryStart();
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

      function onPlaying() {
        started = true;
        if (startupTimer) {
          clearTimeout(startupTimer);
          startupTimer = null;
        }
      }

      function tryStart() {
        if (done) return;
        video.play().catch(onError);
      }

      // Register listeners BEFORE calling play() so nothing is missed.
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError, { once: true });
      video.addEventListener('playing', onPlaying);
      video.addEventListener('loadedmetadata', tryStart);
      video.addEventListener('canplay', tryStart);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      // Safari is stricter about autoplay/media startup than Chromium.
      // Give the element a short grace window to transition into playback
      // before treating startup as a failure.
      startupTimer = setTimeout(() => {
        if (!started) onError();
      }, STARTUP_GRACE_MS);

      if (video.readyState >= 1) {
        tryStart();
      } else {
        try { video.load(); } catch {}
      }
    });
  }

  return {
    el: wrap,
    play,
    destroy() {
      try { video.pause(); } catch {}
      try {
        video.removeAttribute('src');
        video.load();
      } catch {}
      try { URL.revokeObjectURL(src); } catch {}
    },
  };
}
