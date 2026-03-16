// Slide runner: manages a per-screen playlist pointer and plays slides
// when the layout cycle requests an interleave.

import { buildVideoSlide }    from './video.js';
import { buildWebpageSlide }  from './webpage.js';
import { buildTextCardSlide } from './textcard.js';
import { buildQrSlide }       from './qr.js';
import { buildImageSlide }    from './image.js';
import { buildArticleSlide }  from './article.js';
import { runTransition }      from '../transitions.js';
import { getScreenCfg }       from '../../shared/utils.js';
import { sendSlideReady, sendSlideEnded } from '../ws-send.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _slides     = [];     // full slide library (from server)
let _playlists  = [];     // full playlist library (from server)
let _screenId   = null;
let _config     = null;   // current screen config slice
let _container  = null;

// Per-screen playlist pointer
let _playlistId   = null;  // active playlist ID (from screen config)
let _pointer      = 0;     // index into the active playlist's slideIds
let _playSoonIds  = [];    // queue of slide IDs to play soon (FIFO)

// Coordination: resolvers waiting for slide_advance from server
// Maps playlistId → resolve function (there is at most one pending per screen)
const _advanceWaiters = new Map();

// Lookahead: pre-built slide element for the next slide in the playlist.
// Building ahead of time gives videos an entire slide-duration to buffer
// before they need to play.
//
// @type {Map<string, { el: HTMLElement, play: () => Promise<void> }>}
const _lookahead = new Map();

// ---------------------------------------------------------------------------
// Public init / update hooks
// ---------------------------------------------------------------------------

export function initSlides(container, screenId) {
  _container = container;
  _screenId  = screenId;
}

export function updateSlidesConfig(config) {
  _config = getScreenCfg(config, _screenId);
  _playlistId = _config.playlistId || null;
}

export function updateSlides(slides) {
  _slides = slides || [];
  // Drop any lookahead entries whose slides were updated/removed
  for (const [id] of _lookahead) {
    const s = _slides.find(s => s.id === id);
    if (!s || s.enabled === false || s._missing) _lookahead.delete(id);
  }
}

export function updatePlaylists(playlists) {
  _playlists = playlists || [];
  _lookahead.clear(); // playlist order may have changed
}

/** Called when server broadcasts play_soon for a slideId */
export function triggerPlaySoon(slideId) {
  const slide = _slides.find(s => s.id === slideId);
  if (!slide || slide.enabled === false || slide._missing) return;

  const pl = _getActivePlaylist();
  if (!pl || pl.slideIds.includes(slideId)) {
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
  // ── 1. Choose which slide to play ────────────────────────────────────────
  let slideId;
  let usingPlaySoon = false;

  if (_playSoonIds.length > 0) {
    slideId      = _playSoonIds.shift();
    usingPlaySoon = true;
    const pl = _getActivePlaylist();
    if (pl) {
      const idx = pl.slideIds.indexOf(slideId);
      if (idx !== -1) _pointer = (idx + 1) % pl.slideIds.length;
    }
  } else {
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

  // ── 2. Use pre-built lookahead element, or build fresh ───────────────────
  let built = _lookahead.get(slideId);
  _lookahead.delete(slideId); // consume it

  if (!built) {
    try {
      built = await _buildSlide(slide);
    } catch (err) {
      console.warn('[slides] failed to build slide', slide.id, slide.type, err.message);
      return false;
    }
  }

  // ── 3. Kick off lookahead for the NEXT slide immediately ─────────────────
  // This happens in the background — the next slide starts buffering (for
  // videos) or rendering while the current slide is visible.
  _scheduleLookahead();

  // ── 4. Transition in + play ───────────────────────────────────────────────
  const { el, play } = built;
  el.style.opacity = '0';
  _container.appendChild(el);

  const transType = _config?.transition    || 'fade';
  const transMs   = _config?.transitionTime || 800;
  await runTransition(currentDisplayEl, el, transType, transMs);

  await play();

  // ── 5. Notify server ──────────────────────────────────────────────────────
  const activePl = _getActivePlaylist();
  if (activePl?.coordinated) {
    sendSlideReady(slide.id, activePl.id);
    await _waitForAdvance(activePl.id);
  } else {
    sendSlideEnded(slide.id);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Lookahead builder
// ---------------------------------------------------------------------------

let _lookaheadTimer = null;

/**
 * Schedule the pre-build of the next playlist slide.
 * Runs asynchronously on the next microtask to avoid blocking the
 * current slide's transition.
 */
function _scheduleLookahead() {
  clearTimeout(_lookaheadTimer);
  _lookaheadTimer = setTimeout(_buildLookahead, 0);
}

async function _buildLookahead() {
  const pl = _getActivePlaylist();
  if (!pl || !pl.slideIds.length) return;

  // Find the next enabled slide starting from the current pointer
  for (let i = 0; i < pl.slideIds.length; i++) {
    const id    = pl.slideIds[(_pointer + i) % pl.slideIds.length];
    const slide = _slides.find(s => s.id === id);
    if (!slide || slide.enabled === false || slide._missing) continue;

    // Skip if already pre-built
    if (_lookahead.has(id)) return;

    try {
      const built = await _buildSlide(slide);
      _lookahead.set(id, built);
    } catch {
      // Non-fatal — will build fresh when needed
    }
    return; // only pre-build one slide at a time
  }
}

// ---------------------------------------------------------------------------
// Slide builder (dispatches to per-type renderer)
// ---------------------------------------------------------------------------

async function _buildSlide(slide) {
  if (slide.type === 'video')          return buildVideoSlide(slide);
  if (slide.type === 'webpage')        return buildWebpageSlide(slide);
  if (slide.type === 'text-card')      return buildTextCardSlide(slide);
  if (slide.type === 'qr')             return buildQrSlide(slide);
  if (slide.type === 'image')          return buildImageSlide(slide);
  if (slide.type === 'article')        return buildArticleSlide(slide);
  throw new Error(`unknown slide type: ${slide.type}`);
}

// ---------------------------------------------------------------------------
// Coordination waiter
// ---------------------------------------------------------------------------

function _waitForAdvance(playlistId) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      _advanceWaiters.delete(playlistId);
      resolve();
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

export function getInterleaveEvery() {
  const pl = _getActivePlaylist();
  if (pl && typeof pl.interleaveEvery === 'number') return pl.interleaveEvery;
  return 0;
}
