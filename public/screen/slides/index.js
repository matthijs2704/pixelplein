// Slide runner: manages a per-screen playlist pointer and plays slides
// when the layout cycle requests an interleave.

import { buildVideoSlide }    from './video.js';
import { buildWebpageSlide }  from './webpage.js';
import { buildTextCardSlide } from './textcard.js';
import { buildQrSlide }       from './qr.js';
import { buildImageSlide }    from './image.js';
import { buildArticleSlide }  from './article.js';
import { runTransition }      from '../transitions.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _slides     = [];     // full slide library (from server)
let _playlists  = [];     // full playlist library (from server)
let _screenId   = null;
let _config     = null;   // current screen config slice
let _ws         = null;
let _container  = null;

// Per-screen playlist pointer
let _playlistId   = null;  // active playlist ID (from screen config)
let _pointer      = 0;     // index into the active playlist's slideIds
let _playSoonIds  = [];    // queue of slide IDs to play soon (FIFO)

// Coordination: resolvers waiting for slide_advance from server
// Maps playlistId → resolve function (there is at most one pending per screen)
const _advanceWaiters = new Map();

// ---------------------------------------------------------------------------
// Public init / update hooks
// ---------------------------------------------------------------------------

export function initSlides(container, screenId) {
  _container = container;
  _screenId  = screenId;
}

export function updateSlidesWs(ws) {
  _ws = ws;
}

export function updateSlidesConfig(config) {
  _config = config?.screens?.[String(_screenId)] || config?.screens?.['1'] || {};
  _playlistId = _config.playlistId || null;
}

export function updateSlides(slides) {
  _slides = slides || [];
}

export function updatePlaylists(playlists) {
  _playlists = playlists || [];
}

/** Called when server broadcasts play_soon for a slideId */
export function triggerPlaySoon(slideId) {
  // Validate the slide exists, is enabled, and is not missing
  const slide = _slides.find(s => s.id === slideId);
  if (!slide || slide.enabled === false || slide._missing) return;

  // Accept if: this screen has no playlist (override mode), or the playlist contains the slide
  const pl = _getActivePlaylist();
  if (!pl || pl.slideIds.includes(slideId)) {
    // Avoid duplicate queuing
    if (!_playSoonIds.includes(slideId)) {
      _playSoonIds.push(slideId);
    }
  }
}

/**
 * Returns true if there is at least one Play Soon slide queued.
 * Used by the layout cycle to bypass the interleave counter.
 */
export function hasPlaySoon() {
  return _playSoonIds.length > 0;
}

/**
 * Called when server sends slide_advance for a coordinated playlist.
 * Resolves any pending waiter for that playlistId.
 */
export function handleSlideAdvance(playlistId) {
  const resolve = _advanceWaiters.get(playlistId);
  if (resolve) {
    _advanceWaiters.delete(playlistId);
    resolve();
  }
}

// ---------------------------------------------------------------------------
// Core: run one slide and return when done
// Returns true if a slide was played, false if nothing to play.
// ---------------------------------------------------------------------------

export async function runNextSlide(currentDisplayEl) {
  // Choose which slide to play
  let slideId;
  let usingPlaySoon = false;

  if (_playSoonIds.length > 0) {
    // Dequeue the next Play Soon slide
    slideId      = _playSoonIds.shift();
    usingPlaySoon = true;
    // Advance playlist pointer to just after this slide for continuity
    const pl = _getActivePlaylist();
    if (pl) {
      const idx = pl.slideIds.indexOf(slideId);
      if (idx !== -1) _pointer = (idx + 1) % pl.slideIds.length;
    }
  } else {
    // Normal playlist advance
    const pl = _getActivePlaylist();
    if (!pl || !pl.slideIds.length) return false;

    let found = false;
    for (let i = 0; i < pl.slideIds.length; i++) {
      const candidate = pl.slideIds[(_pointer + i) % pl.slideIds.length];
      const s = _slides.find(s => s.id === candidate);
      if (s && s.enabled !== false && !s._missing) {
        slideId = candidate;
        _pointer = (_pointer + i + 1) % pl.slideIds.length;
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  const slide = _slides.find(s => s.id === slideId);
  if (!slide || slide.enabled === false || slide._missing) return false;

  // Build slide element
  let built;
  try {
    if (slide.type === 'video')          built = buildVideoSlide(slide);
    else if (slide.type === 'webpage')   built = buildWebpageSlide(slide);
    else if (slide.type === 'text-card') built = buildTextCardSlide(slide);
    else if (slide.type === 'qr')        built = await buildQrSlide(slide);
    else if (slide.type === 'image')     built = buildImageSlide(slide);
    else if (slide.type === 'article')   built = await buildArticleSlide(slide);
    else return false;
  } catch { return false; }

  const { el, play } = built;

  // Transition in
  el.style.opacity = '0';
  _container.appendChild(el);
  const transType = _config?.transition    || 'fade';
  const transMs   = _config?.transitionTime || 800;
  await runTransition(currentDisplayEl, el, transType, transMs);

  // Play (waits for video end or durationSec)
  await play();

  // Notify server — coordinated playlists use slide_ready and wait for
  // slide_advance; non-coordinated use the legacy slide_ended.
  if (_ws && _ws.readyState === 1) {
    const activePl = _getActivePlaylist();
    if (activePl?.coordinated) {
      _ws.send(JSON.stringify({
        type: 'slide_ready',
        slideId: slide.id,
        playlistId: activePl.id,
        screenId: _screenId,
      }));
      // Wait for server to say "go" before returning control to the cycle
      await _waitForAdvance(activePl.id);
    } else {
      _ws.send(JSON.stringify({
        type: 'slide_ended',
        slideId: slide.id,
        screenId: _screenId,
      }));
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Coordination waiter
// ---------------------------------------------------------------------------

/**
 * Returns a Promise that resolves when the server sends slide_advance for
 * the given playlistId, or after a local safety timeout (20 s).
 */
function _waitForAdvance(playlistId) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      _advanceWaiters.delete(playlistId);
      resolve(); // advance unilaterally after timeout
    }, 20_000);

    _advanceWaiters.set(playlistId, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _getActivePlaylist() {
  if (!_playlistId) return null;
  return _playlists.find(p => p.id === _playlistId) || null;
}

/**
 * Returns the effective interleaveEvery for this screen.
 * Reads from the active playlist only (0 = disabled).
 */
export function getInterleaveEvery() {
  const pl = _getActivePlaylist();
  if (pl && typeof pl.interleaveEvery === 'number') return pl.interleaveEvery;
  return 0;
}
