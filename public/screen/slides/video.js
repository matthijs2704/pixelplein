// Slide renderer: video
// Returns a Promise that resolves when the video has finished playing
// (or when durationSec elapses for looping videos).

import { el } from '../../shared/utils.js';

// Infer a MIME type hint from the filename so the browser can quickly decide
// whether it can decode the file, rather than downloading part of it first.
function _mimeType(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const map = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg' };
  return map[ext] || '';
}

/**
 * @param {object} slide  – the slide object from the library
 * @returns {{ el: HTMLElement, play: () => Promise<void> }}
 */
export function buildVideoSlide(slide) {
  const src  = `/slide-assets/videos/${encodeURIComponent(slide.filename)}`;
  const mime = _mimeType(slide.filename);

  const video = el('video', { attrs: { preload: 'auto' } });
  video.muted       = slide.muted !== false;
  video.playsInline = true;

  // Use <source> so we can supply a type hint; this lets the browser reject
  // unsupported formats immediately via error on the source element rather than
  // silently hanging or skipping.
  const source = document.createElement('source');
  source.src  = src;
  if (mime) source.type = mime;
  video.appendChild(source);

  const wrap = el('div', { cls: 'slide-video' }, video);

  const playCount = typeof slide.playCount === 'number' ? slide.playCount : 1;
  const MAX_DURATION_MS  = 5 * 60 * 1000;
  const MIN_ON_ERROR_MS  = 3000;  // show at least this long if video errors after loading

  function play() {
    return new Promise(resolve => {
      let playsLeft = playCount === 0 ? Infinity : playCount;
      let done      = false;

      const safetyTimer = setTimeout(finish, MAX_DURATION_MS);

      function finish() {
        if (done) return;
        done = true;
        clearTimeout(safetyTimer);
        video.removeEventListener('ended', onEnded);
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
        // If the browser decoded at least the first frame (readyState > 0) keep
        // it on screen for MIN_ON_ERROR_MS so it doesn't flash and vanish.
        if (video.readyState > 0) {
          setTimeout(finish, MIN_ON_ERROR_MS);
        } else {
          finish();
        }
      }

      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError, { once: true });

      // Wait for the browser to buffer enough before calling play().
      // Without this, play() races against buffering and can fail on slow
      // connections or when the codec is being probed.
      if (video.readyState >= 3 /* HAVE_FUTURE_DATA */) {
        video.play().catch(onError);
      } else {
        video.addEventListener('canplay', () => {
          video.play().catch(onError);
        }, { once: true });
      }
    });
  }

  return { el: wrap, play };
}
