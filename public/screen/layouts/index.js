// Layout cycle dispatcher: picks layout type, builds DOM, runs transitions

import { buildFullscreen }  from './fullscreen.js';
import { buildSideBySide }  from './sidebyside.js';
import { buildFeaturedDuo } from './featuredduo.js';
import { buildPolaroid }    from './polaroid.js';
import { buildMosaic, runMosaicTransitions } from './mosaic.js';
import { buildSubmissionWall } from './submissionwall.js';
import { runTransition }    from '../transitions.js';
import { pickTemplate, TEMPLATE_DEFS } from '../templates.js';
import {
  pickPhotos,
  pickHeroPhoto,
  markAsHeroShown,
  photoRegistry,
} from '../photos.js';
import {
  hasApprovedSubmissions,
  pickSubmissionWindow,
  updateSubmissionWallSettings,
  getSubmissionWallOptions,
} from '../submissions.js';
import { claimHero } from '../heartbeat.js';
import {
  initSlides,
  runNextSlide,
  getInterleaveEvery,
  hasPlaySoon,
  updateSlidesWs,
  updateSlidesConfig,
} from '../slides/index.js';
import { getBottomInset } from '../overlays/index.js';
import { getScreenCfg } from '../../shared/utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POST_SLIDE_DELAY_MS   = 500;    // pause after slide before next photo cycle
const NO_CONFIG_RETRY_MS    = 1000;   // retry interval when config not yet available
const DEFAULT_LAYOUT_DUR_MS = 8000;   // fallback layout duration
const DEFAULT_HERO_LOCK_SEC = 30;     // cross-screen hero lock TTL
const POLAROID_MIN_COUNT    = 5;
const POLAROID_MAX_COUNT    = 10;

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
let _globalConfig    = null;
let _heroLocks       = new Map();
let _screenId        = null;
let _ws              = null;
let _recentTemplates = [];
let _cycleTimer      = null;
let _running         = false;
let _photoCycleCount = 0;   // counts photo layouts since last slide interleave
let _lastSubmissionWallAt = Date.now();

/**
 * Initialise the cycle engine.
 */
export function initCycle(container, screenId) {
  _container = container;
  _screenId  = screenId;
  initSlides(container, screenId);
}

export function updateConfig(config) {
  _globalConfig = config || {};
  _config = getScreenCfg(config, _screenId);
  updateSubmissionWallSettings(config || {});
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
// Layout builders — each returns { built, layoutType, duration?, slotEls? }
// ---------------------------------------------------------------------------

const _layoutBuilders = {
  fullscreen(cfg) {
    const photo = _pickAndClaimHero(cfg, { orientation: 'landscape' });
    return { built: buildFullscreen(photo), layoutType: 'fullscreen' };
  },

  sidebyside(cfg) {
    const photos = pickPhotos(2, cfg, [], true, {
      orientation: 'portrait',
      enforceOrientation: false,
      orientationBoost: 1.25,
      avoidRecentMs: 120_000,
      allowRecentFallback: true,
    });
    return { built: buildSideBySide(photos), layoutType: 'sidebyside' };
  },

  featuredduo(cfg) {
    const heroP = _pickAndClaimHero(cfg, { orientation: 'landscape' });
    const support = pickPhotos(1, cfg, heroP ? [heroP.id] : [], true, {
      orientation: 'portrait',
      enforceOrientation: false,
      orientationBoost: 1.25,
      avoidRecentMs: 120_000,
      allowRecentFallback: true,
    });
    return {
      built: buildFeaturedDuo([heroP, support[0] || null].filter(Boolean)),
      layoutType: 'featuredduo',
    };
  },

  polaroid(cfg) {
    const polaroidCount = POLAROID_MIN_COUNT + Math.floor(Math.random() * (POLAROID_MAX_COUNT - POLAROID_MIN_COUNT + 1));
    const photos = pickPhotos(Math.min(polaroidCount, POLAROID_MAX_COUNT), cfg, [], false);
    return { built: buildPolaroid(photos), layoutType: 'polaroid' };
  },

  mosaic(cfg) {
    const heroSide = cfg.preferHeroSide || 'auto';
    const tplName  = pickTemplate(cfg, _recentTemplates, heroSide);
    _recentTemplates = [..._recentTemplates.slice(-3), tplName];

    const tplDef     = TEMPLATE_DEFS[tplName];
    const tplHasHero = tplDef ? tplDef.slots.some(s => s.hero) : false;

    let heroPhoto = null;
    if (tplHasHero) {
      const heroSlot = tplDef.slots.find(s => s.hero) || null;
      const heroOptions = heroSlot?.portrait
        ? { orientation: 'portrait', enforceOrientation: false, orientationBoost: 1.25 }
        : { orientation: 'landscape' };
      heroPhoto = _pickAndClaimHero(cfg, heroOptions, false);
    }

    const totalSlots = tplDef ? tplDef.slots.filter(s => !s.recent).length : 6;
    const slotCount  = totalSlots - (heroPhoto ? 1 : 0);
    const others     = pickPhotos(Math.max(slotCount, 3), cfg, heroPhoto ? [heroPhoto.id] : []);

    const built = buildMosaic(tplName, heroPhoto, others, cfg.minTilePx || 170, cfg);
    return { built, layoutType: tplName, slotEls: built.slotEls };
  },
};

/**
 * Build a submission wall layout.  Returns null when the wall should be
 * skipped (empty items + hideWhenEmpty), signalling runCycle to fall back.
 */
function _buildSubmissionWallLayout(cycleStart, submissionMode, hasSubmissions, hideWhenEmpty, wallOptions) {
  const mode = submissionMode === 'off' ? 'both' : submissionMode;
  const pageSize = 6;
  const count = mode === 'single' ? 1 : pageSize * 4;
  const items = hasSubmissions ? pickSubmissionWindow(count, Math.max(24, pageSize * 8)) : [];

  if (!items.length && hideWhenEmpty) return null;

  const effectiveMode = items.length ? mode : 'single';
  const built = buildSubmissionWall(items, effectiveMode, wallOptions);
  const duration = Math.max(5000, Math.min(120000, Number(_globalConfig?.submissionDisplayDurationSec || 12) * 1000));
  _lastSubmissionWallAt = cycleStart;

  return { built, layoutType: 'submissionwall', duration };
}

// ---------------------------------------------------------------------------
// Core cycle
// ---------------------------------------------------------------------------

async function runCycle() {
  if (!_running || !_config) {
    _cycleTimer = setTimeout(runCycle, NO_CONFIG_RETRY_MS);
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
    if (!_running) return;
    if (played) {
      // The slide runner swapped _currentEl via runTransition.
      // Sync our pointer to the new element.
      const children = Array.from(_container.children);
      _currentEl = children[children.length - 1] || _currentEl;
      for (const child of children.slice(0, -1)) child.remove();

      _cycleTimer = setTimeout(runCycle, POST_SLIDE_DELAY_MS);
      return;
    }
    // Nothing played (no playlist / all disabled) — fall through to photo cycle
  }

  const cycleStart = Date.now();
  const submissionMode = _globalConfig?.submissionDisplayMode || 'off';
  const wallOptions = { ...getSubmissionWallOptions(), bottomInset: getBottomInset() };
  const hasSubmissions = hasApprovedSubmissions();
  const hideWhenEmpty = wallOptions.hideWhenEmpty !== false;
  const submissionsEnabled = submissionMode !== 'off' && (hasSubmissions || !hideWhenEmpty);
  const submissionIntervalMs = Math.max(10, Number(_globalConfig?.submissionDisplayIntervalSec || 45)) * 1000;
  const shouldRunSubmissionWall = submissionsEnabled && ((cycleStart - _lastSubmissionWallAt) >= submissionIntervalMs);

  const poolSize = readyPoolSize(cfg);

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

  let layoutType = candidates[Math.floor(Math.random() * candidates.length)];
  if (shouldRunSubmissionWall) {
    layoutType = 'submissionwall';
  }

  // ── Build the chosen layout ──────────────────────────────────────────────
  let result;
  if (layoutType === 'submissionwall') {
    result = _buildSubmissionWallLayout(cycleStart, submissionMode, hasSubmissions, hideWhenEmpty, wallOptions);
    if (!result) layoutType = 'fullscreen';  // fall back when wall is empty
  }
  if (!result) {
    const builder = _layoutBuilders[layoutType] || _layoutBuilders.fullscreen;
    result = builder(cfg);
  }

  const { built, layoutType: resolvedType, slotEls = null } = result;
  const duration = result.duration || cfg.layoutDuration || DEFAULT_LAYOUT_DUR_MS;

  displayState.layoutType = resolvedType;

  const newEl      = built.el;
  const visibleIds = built.visibleIds;

  // Mount new element (hidden behind current)
  newEl.style.opacity = '0';
  _container.appendChild(newEl);

  // Start Ken Burns BEFORE the layout transition so the image is already in
  // motion when it fades in. This avoids any snap/jump that occurs when Ken
  // Burns is started after the transition completes (active CSS transitions on
  // the element interfere with setting a new transform state).
  if (cfg.kenBurnsEnabled !== false && built.startMotion) {
    built.startMotion(duration);
  }

  // Transition
  await runTransition(_currentEl, newEl, cfg.transition || 'fade', cfg.transitionTime || 800);
  if (!_running) return;
  _currentEl = newEl;

  // Update display state
  displayState.visibleIds          = visibleIds;
  displayState.lastCycleAt         = cycleStart;
  displayState.lastCycleDurationMs = Date.now() - cycleStart;
  displayState.focusGroup          = cfg.groupMode === 'manual' ? cfg.activeGroup : null;

  // Run mosaic tile swaps if applicable
  if (slotEls) {
    runMosaicTransitions(slotEls, cfg, cycleStart, (count, options = {}) =>
      pickPhotos(
        count,
        cfg,
        [...visibleIds, ...(options.excludeIds || [])],
        false,
        {
          orientation: options.orientation || 'any',
          enforceOrientation: options.enforceOrientation,
          orientationBoost: options.orientationBoost,
        },
      )
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

/**
 * Pick a hero photo, claim the cross-screen lock, and mark it as hero-shown.
 * Falls back to pickPhotos when no hero candidate passes the cooldown check.
 *
 * @param {Object}  cfg
 * @param {Object}  [options]        - orientation options forwarded to pickHeroPhoto
 * @param {boolean} [useFallback=true] - try pickPhotos if pickHeroPhoto returns null
 * @returns {Object|null} the chosen photo, or null if pool is empty
 */
function _pickAndClaimHero(cfg, options = {}, useFallback = true) {
  const hero = pickHeroPhoto(cfg, _heroLocks, _screenId, options);
  const photo = hero || (useFallback
    ? pickPhotos(1, cfg, [], true, options)[0] || null
    : null);

  if (photo) {
    _claimHero(photo.id, cfg.crossScreenHeroLockSec || DEFAULT_HERO_LOCK_SEC);
    markAsHeroShown(photo.id);
  }

  return photo;
}
