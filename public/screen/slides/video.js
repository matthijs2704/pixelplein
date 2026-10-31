// Slide renderer: video

import { el } from '../../shared/utils.js';
import { getVideoObjectUrl } from '../video-cache.js';

/**
 * @param {object} slide
 * @returns {{ el: HTMLElement, play: () => Promise<void> }}
 */
export async function buildVideoSlide(slide) {
  console.log('[video] building slide, filename:', slide.filename);
  const src = await getVideoObjectUrl(slide.filename);
  console.log('[video] got blob URL:', src.slice(0, 40));
  const muted = slide.muted !== false;

  const video = el('video', { attrs: { preload: 'auto' } });
  video.muted       = muted;
  video.defaultMuted = muted;
  if (muted) video.setAttribute('muted', '');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.src         = src;
  if (slide.fit && slide.fit !== 'contain') video.style.objectFit = slide.fit;

  const wrap = el('div', { cls: 'slide-video' }, video);

  const playCount       = typeof slide.playCount === 'number' ? slide.playCount : 1;
  const MAX_DURATION_MS = 5 * 60 * 1000;
  const ERROR_HOLD_MS   = 2_000; // if a frame decoded, show it briefly before advancing
  const STARTUP_GRACE_MS = 9_000; // slow blob decode warm-up on weaker kiosk hardware

  function play(signal) {
    return new Promise(resolve => {
      if (signal?.aborted) {
        resolve();
        return;
      }

      let playsLeft      = playCount === 0 ? Infinity : playCount;
      let done           = false;
      let started        = false;
      let playRequested  = false;
      let startupTimer   = null;

      const safetyTimer = setTimeout(finish, MAX_DURATION_MS);

      try {
        if (video.currentTime > 0) video.currentTime = 0;
      } catch {}

      function finish() {
        if (done) return;
        done = true;
        clearTimeout(safetyTimer);
        if (startupTimer) clearTimeout(startupTimer);
        video.removeEventListener('ended',  onEnded);
        video.removeEventListener('error',  onError);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('canplay', tryStart);
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }

      function onAbort() {
        console.warn('[video] aborted externally — layout/slide was cut short, not a playback failure. currentTime:', video.currentTime.toFixed(1), '/', video.duration);
        try { video.pause(); } catch {}
        finish();
      }

      function onEnded() {
        console.log('[video] ended — currentTime:', video.currentTime.toFixed(1), '/ reported duration:', video.duration);
        if (Number.isFinite(video.duration) && video.duration - video.currentTime > 1) {
          console.warn('[video] "ended" fired', (video.duration - video.currentTime).toFixed(1), 's before the reported duration — likely bad container/duration metadata on this file, not a code bug.');
        }
        playsLeft -= 1;
        if (playsLeft <= 0) {
          finish();
        } else {
          video.currentTime = 0;
          playRequested = false;
          tryStart();
        }
      }

      function onError() {
        console.warn('[video] onError, readyState:', video.readyState, 'error:', video.error?.message, 'currentTime:', video.currentTime.toFixed(1), '/', video.duration, 'started:', started);
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
        if (done || playRequested) return;
        playRequested = true;
        video.play().catch(err => {
          if (done) return;
          playRequested = false;
          console.error('[video] play() rejected:', err.name, err.message);
          onError();
        });
      }

      // Register listeners BEFORE calling play() so nothing is missed.
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError, { once: true });
      video.addEventListener('playing', onPlaying);
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
