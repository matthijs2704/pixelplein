// Layout cycle dispatcher: picks layout type, builds DOM, runs transitions

import { buildFullscreen }  from './fullscreen.js';
import { buildSideBySide }  from './sidebyside.js';
import { buildFeaturedDuo } from './featuredduo.js';
import { buildPolaroid }    from './polaroid.js';
import { buildMosaic, runMosaicTransitions } from './mosaic.js';
import { runTransition }    from '../transitions.js';
import { pickTemplate, TEMPLATE_DEFS } from '../templates.js';
import {
  pickPhotos,
  pickHeroPhoto,
  markAsHeroShown,
  photoRegistry,
} from '../photos.js';
import { claimHero } from '../heartbeat.js';
import {
  initSlides,
  runNextSlide,
  getInterleaveEvery,
  hasPlaySoon,
  updateSlidesWs,
  updateSlidesConfig,
} from '../slides/index.js';

// Display state shared with heartbeat
export const displayState = {
  layoutType:          null,
  focusGroup:          null,
  visibleIds:          [],
  lastCycleAt:         0,
  lastCycleDurationMs: null,
};

let _container       = null;
let _currentEl       = null;
let _config          = null;
let _heroLocks       = new Map();
let _screenId        = null;
let _ws              = null;
let _recentTemplates = [];
let _cycleTimer      = null;
let _running         = false;
let _photoCycleCount = 0;   // counts photo layouts since last slide interleave

/**
 * Initialise the cycle engine.
 */
export function initCycle(container, screenId) {
  _container = container;
  _screenId  = screenId;
  initSlides(container, screenId);
}

export function updateConfig(config) {
  _config = config?.screens?.[String(_screenId)] || config?.screens?.['1'] || {};
  updateSlidesConfig(config);
}

export function updateHeroLocks(locks) {
  _heroLocks = new Map(locks.map(l => [l.photoId, l]));
}

export function updateWs(ws) {
  _ws = ws;
  updateSlidesWs(ws);
}

/**
 * Start the layout cycle loop.
 */
export function startCycle() {
  if (_running) return;
  _running = true;

  const phaseMs = _config?.cyclePhaseMs || 0;
  setTimeout(runCycle, phaseMs);
}

export function stopCycle() {
  _running = false;
  if (_cycleTimer) { clearTimeout(_cycleTimer); _cycleTimer = null; }
}

// ---------------------------------------------------------------------------
// Pool size helpers
// ---------------------------------------------------------------------------

/**
 * Count ready photos in the current pool (respects group filtering).
 * Used to downgrade layouts when the pool is too small.
 */
function readyPoolSize(cfg) {
  const groupMode   = cfg.groupMode  || 'auto';
  const activeGroup = cfg.activeGroup || 'ungrouped';
  const all = Array.from(photoRegistry.values()).filter(p => p.status === 'ready');
  if (groupMode !== 'manual') return all.length;
  return all.filter(p => p.eventGroup === activeGroup).length || all.length;
}

// ---------------------------------------------------------------------------
// Core cycle
// ---------------------------------------------------------------------------

async function runCycle() {
  if (!_running || !_config) {
    _cycleTimer = setTimeout(runCycle, 1000);
    return;
  }

  let cfg = _config;

  // ── Slide interleave check ────────────────────────────────────────────────
  // Trigger if: counter reached the threshold, OR a Play Soon is pending.
  // Play Soon can fire even without a playlist (interleaveEvery === 0).
  const interleaveEvery = getInterleaveEvery();
  const shouldPlaySlide = hasPlaySoon() ||
    (interleaveEvery > 0 && _photoCycleCount >= interleaveEvery);

  if (shouldPlaySlide) {
    _photoCycleCount = 0;
    const played = await runNextSlide(_currentEl);
    if (played) {
      // The slide runner swapped _currentEl via runTransition.
      // Sync our pointer to the new element.
      const children = Array.from(_container.children);
      _currentEl = children[children.length - 1] || _currentEl;
      for (const child of children.slice(0, -1)) child.remove();

      _cycleTimer = setTimeout(runCycle, 500);
      return;
    }
    // Nothing played (no playlist / all disabled) — fall through to photo cycle
  }

  const cycleStart = Date.now();
  const poolSize   = readyPoolSize(cfg);

  // Choose layout with graceful warm-up based on pool size:
  //   1 photo     → fullscreen only
  //   2-3 photos  → fullscreen or sidebyside / featuredduo
  //   4-5 photos  → add simple mosaics (uniform-4/6)
  //   6+          → full set including polaroid (needs ≥5, but 6+ gives variety)
  const ALL_LAYOUTS = ['fullscreen', 'sidebyside', 'featuredduo', 'polaroid', 'mosaic'];
  let effectiveEnabled;
  if (poolSize <= 1) {
    effectiveEnabled = ['fullscreen'];
  } else if (poolSize <= 3) {
    effectiveEnabled = ['fullscreen', 'sidebyside', 'featuredduo'];
  } else if (poolSize <= 5) {
    effectiveEnabled = ['fullscreen', 'sidebyside', 'featuredduo', 'mosaic'];
    // Restrict mosaic templates to simple uniform ones for tiny pools
    cfg = { ...cfg, templateEnabled: (cfg.templateEnabled || []).filter(t => t.startsWith('uniform')) };
    if (!cfg.templateEnabled.length) cfg = { ...cfg, templateEnabled: ['uniform-4', 'uniform-6'] };
  } else {
    effectiveEnabled = (cfg.enabledLayouts || ALL_LAYOUTS).filter(l => ALL_LAYOUTS.includes(l));
  }

  // Intersect with admin-enabled layouts (but always keep at least fullscreen)
  const adminEnabled = cfg.enabledLayouts || ALL_LAYOUTS;
  let candidates = effectiveEnabled.filter(l => adminEnabled.includes(l));
  if (!candidates.length) candidates = ['fullscreen'];

  const layoutType = candidates[Math.floor(Math.random() * candidates.length)];

  let built;
  let mosaicSlotEls = null;

  // --- Fullscreen ---
  if (layoutType === 'fullscreen') {
    const hero  = pickHeroPhoto(cfg, _heroLocks, _screenId);
    const photo = hero || pickPhotos(1, cfg, [], true)[0] || null;

    if (photo) {
      _claimHero(photo.id, cfg.crossScreenHeroLockSec || 30);
      markAsHeroShown(photo.id);
    }

    built = buildFullscreen(photo);
    displayState.layoutType = 'fullscreen';
  }

  // --- Side by side ---
  else if (layoutType === 'sidebyside') {
    const photos = pickPhotos(2, cfg, [], true);
    built = buildSideBySide(photos);
    displayState.layoutType = 'sidebyside';
  }

  // --- Featured duo ---
  else if (layoutType === 'featuredduo') {
    const hero   = pickHeroPhoto(cfg, _heroLocks, _screenId);
    const heroP  = hero || pickPhotos(1, cfg, [], true)[0] || null;
    if (heroP) {
      _claimHero(heroP.id, cfg.crossScreenHeroLockSec || 30);
      markAsHeroShown(heroP.id);
    }
    const support = pickPhotos(1, cfg, heroP ? [heroP.id] : [], true);
    built = buildFeaturedDuo([heroP, support[0] || null].filter(Boolean));
    displayState.layoutType = 'featuredduo';
  }

  // --- Polaroid ---
  else if (layoutType === 'polaroid') {
    const polaroidCount = 5 + Math.floor(Math.random() * 6); // 5–10
    const photos = pickPhotos(Math.min(polaroidCount, 10), cfg, [], false);
    built = buildPolaroid(photos);
    displayState.layoutType = 'polaroid';
  }

  // --- Mosaic ---
  else {
    const heroSide = cfg.preferHeroSide || 'auto';
    const tplName  = pickTemplate(cfg, _recentTemplates, heroSide);
    _recentTemplates = [..._recentTemplates.slice(-3), tplName];

    const tplDef     = TEMPLATE_DEFS[tplName];
    const tplHasHero = tplDef ? tplDef.slots.some(s => s.hero) : false;

    let heroPhoto = null;
    if (tplHasHero) {
      heroPhoto = pickHeroPhoto(cfg, _heroLocks, _screenId);
      if (heroPhoto) {
        _claimHero(heroPhoto.id, cfg.crossScreenHeroLockSec || 30);
        markAsHeroShown(heroPhoto.id);
      }
    }

    const totalSlots = tplDef ? tplDef.slots.filter(s => !s.recent).length : 6;
    const slotCount  = totalSlots - (heroPhoto ? 1 : 0);
    const others     = pickPhotos(Math.max(slotCount, 3), cfg, heroPhoto ? [heroPhoto.id] : []);

    built         = buildMosaic(tplName, heroPhoto, others, cfg.minTilePx || 170, cfg);
    mosaicSlotEls = built.slotEls;
    displayState.layoutType = tplName;
  }

  const newEl      = built.el;
  const visibleIds = built.visibleIds;

  // Mount new element (hidden behind current)
  newEl.style.opacity = '0';
  _container.appendChild(newEl);

  // Start Ken Burns BEFORE the layout transition so the image is already in
  // motion when it fades in. This avoids any snap/jump that occurs when Ken
  // Burns is started after the transition completes (active CSS transitions on
  // the element interfere with setting a new transform state).
  const duration = cfg.layoutDuration || 8000;
  if (cfg.kenBurnsEnabled !== false && built.startMotion) {
    built.startMotion(duration);
  }

  // Transition
  await runTransition(_currentEl, newEl, cfg.transition || 'fade', cfg.transitionTime || 800);
  _currentEl = newEl;

  // Update display state
  displayState.visibleIds          = visibleIds;
  displayState.lastCycleAt         = cycleStart;
  displayState.lastCycleDurationMs = Date.now() - cycleStart;
  displayState.focusGroup          = cfg.groupMode === 'manual' ? cfg.activeGroup : null;

  // Run mosaic tile swaps if applicable
  if (mosaicSlotEls) {
    runMosaicTransitions(mosaicSlotEls, cfg, cycleStart, (count) =>
      pickPhotos(count, cfg, visibleIds)
    ).then(newIds => {
      if (newIds) displayState.visibleIds = [...new Set([...displayState.visibleIds, ...newIds])];
    }).catch(() => {});
  }

  // Count completed photo cycles (for slide interleave)
  _photoCycleCount += 1;

  // Schedule next cycle
  _cycleTimer = setTimeout(runCycle, duration);
}

function _claimHero(photoId, ttlSec) {
  if (_ws) claimHero(_ws, _screenId, photoId, ttlSec);
}
