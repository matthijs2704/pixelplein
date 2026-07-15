// Slide runner: manages playlist pointers and renders slide interleaves
// through the shared layout lifecycle manager.

import { buildVideoSlide }    from './video.js';
import { buildWebpageSlide }  from './webpage.js';
import { buildTextCardSlide } from './textcard.js';
import { buildQrSlide }       from './qr.js';
import { buildImageSlide }    from './image.js';
import { buildArticleSlide }  from './article.js';
import { getScreenCfg }       from '../../shared/utils.js';
import { sendSlideReady, sendSlideEnded } from '../ws-send.js';
import { getModuleSlideBuilder } from '../module-registry.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _slides    = [];
let _playlists = [];
let _screenId  = null;
let _config    = null;

// Per-screen playlist pointer
let _playlistId  = null;
let _pointer     = 0;
let _playSoonIds = [];

// Coordination waiters
const _advanceWaiters = new Map();

// Lookahead pre-build cache
/** @type {Map<string, { el: HTMLElement, play?: Function, destroy?: Function, _disposed?: boolean }>} */
const _lookahead = new Map();
let _lookaheadTimer = null;
let _lookaheadRev   = 0;

// ---------------------------------------------------------------------------
// Public init / update hooks
// ---------------------------------------------------------------------------

export function initSlides(container, screenId) {
  void container; // lifecycle manager owns DOM insertion/removal
  _screenId = screenId;
}

export function updateSlidesConfig(config) {
  _config = getScreenCfg(config, _screenId);
  _playlistId = _config.playlistId || null;
}

export function updateSlides(slides) {
  _slides = slides || [];
  _lookaheadRev += 1;
  _clearLookahead();
}

export function updatePlaylists(playlists) {
  _playlists = playlists || [];
  _lookaheadRev += 1;
  _clearLookahead();
}

export function triggerPlaySoon(slideId) {
  const slide = _slides.find(s => s.id === slideId);
  if (!slide || slide.enabled === false || slide._missing) return;

  const pl = _getActivePlaylist();
  if (!pl || pl.slideIds.includes(slideId)) {
    if (!_playSoonIds.includes(slideId)) _playSoonIds.push(slideId);
  }
}

export function hasPlaySoon() {
  return _playSoonIds.length > 0;
}

export function handleSlideAdvance(playlistId) {
  const resolve = _advanceWaiters.get(playlistId);
  if (resolve) {
    _advanceWaiters.delete(playlistId);
    resolve();
  }
}

export function resetSlidesRuntime() {
  _playSoonIds = [];
  _lookaheadRev += 1;
  _clearLookahead();
  _advanceWaiters.clear();
}

// ---------------------------------------------------------------------------
// Core: run one slide and return when done
// Returns true if a slide was played, false if nothing to play.
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   transition?: 'fade'|'slide'|'zoom',
 *   transitionMs?: number,
 *   showRenderable: (renderable: Object, transition: string, transitionMs: number) => Promise<boolean>,
 * }} opts
 */
export async function runNextSlide(opts = {}) {
  if (typeof opts.showRenderable !== 'function') return false;

  const transition   = opts.transition || _config?.transition || 'fade';
  const transitionMs = opts.transitionMs || _config?.transitionTime || 800;

  // ── 1. Choose which slide to play ────────────────────────────────────────
  let slideId;

  if (_playSoonIds.length > 0) {
    slideId = _playSoonIds.shift();
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
      const s = _slides.find(sl => sl.id === candidate);
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
  _lookahead.delete(slideId);

  if (!built) {
    try {
      built = await _buildSlide(slide);
    } catch (err) {
      console.warn('[slides] failed to build slide', slide.id, slide.type, err.message);
      return false;
    }
  }

  // ── 3. Kick off lookahead for the NEXT slide immediately ─────────────────
  _scheduleLookahead();

  // ── 4. Render + play via lifecycle manager ───────────────────────────────
  const shown = await opts.showRenderable({
    el: built.el,
    async onDidShow({ signal }) {
      await _playBuilt(built, signal);
      if (signal.aborted) return;

      const activePl = _getActivePlaylist();
      if (activePl?.coordinated) {
        sendSlideReady(slide.id, activePl.id);
        await _waitForAdvance(activePl.id, signal);
      } else {
        sendSlideEnded(slide.id);
      }
    },
    destroy() {
      _disposeBuilt(built);
    },
  }, transition, transitionMs);

  if (!shown) {
    _disposeBuilt(built);
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Lookahead builder
// ---------------------------------------------------------------------------

function _scheduleLookahead() {
  const rev = _lookaheadRev;
  clearTimeout(_lookaheadTimer);
  _lookaheadTimer = setTimeout(() => {
    _buildLookahead(rev).catch(() => {});
  }, 0);
}

async function _buildLookahead(rev) {
  if (rev !== _lookaheadRev) return;

  const pl = _getActivePlaylist();
  if (!pl || !pl.slideIds.length) return;

  for (let i = 0; i < pl.slideIds.length; i++) {
    const id    = pl.slideIds[(_pointer + i) % pl.slideIds.length];
    const slide = _slides.find(s => s.id === id);
    if (!slide || slide.enabled === false || slide._missing) continue;

    if (_lookahead.has(id)) return;

    let built = null;
    try {
      built = await _buildSlide(slide);
      if (rev !== _lookaheadRev) {
        _disposeBuilt(built);
        return;
      }
      _lookahead.set(id, built);
    } catch {
      _disposeBuilt(built);
    }
    return; // only pre-build one slide at a time
  }
}

function _clearLookahead() {
  clearTimeout(_lookaheadTimer);
  _lookaheadTimer = null;
  for (const built of _lookahead.values()) {
    _disposeBuilt(built);
  }
  _lookahead.clear();
}

// ---------------------------------------------------------------------------
// Slide builder (dispatches to per-type renderer)
// ---------------------------------------------------------------------------

async function _buildSlide(slide) {
  // Module builders are checked first so active modules can wrap built-in types.
  const moduleBuilder = getModuleSlideBuilder(slide.type);
  if (moduleBuilder) return moduleBuilder(slide);
  if (slide.type === 'video')          return buildVideoSlide(slide);
  if (slide.type === 'webpage')        return buildWebpageSlide(slide);
  if (slide.type === 'text-card')      return buildTextCardSlide(slide);
  if (slide.type === 'qr')             return buildQrSlide(slide);
  if (slide.type === 'image')          return buildImageSlide(slide);
  if (slide.type === 'article')        return buildArticleSlide(slide);
  throw new Error(`unknown slide type: ${slide.type}`);
}

async function _playBuilt(built, signal) {
  if (!built || typeof built.play !== 'function') return;
  if (signal?.aborted) return;
  try {
    await built.play(signal);
  } catch {}
}

function _disposeBuilt(built) {
  if (!built || built._disposed) return;
  built._disposed = true;
  if (typeof built.destroy === 'function') {
    try { built.destroy(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Coordination waiter
// ---------------------------------------------------------------------------

function _waitForAdvance(playlistId, signal) {
  return new Promise(resolve => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      _advanceWaiters.delete(playlistId);
      resolve();
    };

    const onAbort = () => finish();
    const timer = setTimeout(finish, 20_000);

    _advanceWaiters.set(playlistId, finish);
    if (signal) {
      if (signal.aborted) {
        finish();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
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
