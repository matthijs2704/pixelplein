// Layout cycle dispatcher: loads layout descriptors, picks layout type,
// and routes every render through a shared lifecycle manager.

import { buildSubmissionWall } from './submissionwall.js';
import { createLayoutLifecycle } from '../layout-lifecycle.js';
import {
  pickPhotos,
  pickHeroPhoto,
  pickNewestPhotos,
  createSelectionContext,
  getRecentAvoidWindowMs,
  getReadyPhotoPoolSize,
} from '../photos.js';
import {
  getSubmissionWallState,
  pickSubmissionWindow,
  updateSubmissionWallSettings,
  getSubmissionWallOptions,
} from '../submissions.js';
import { sendHeroClaim } from '../ws-send.js';
import {
  initSlides,
  runNextSlide,
  getInterleaveEvery,
  hasPlaySoon,
  updateSlidesConfig,
  resetSlidesRuntime,
} from '../slides/index.js';
import { getBottomInset } from '../overlays/index.js';
import { getScreenCfg } from '../../shared/utils.js';
import { TEMPLATE_DEFS } from '../templates.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POST_SLIDE_DELAY_MS   = 500;    // pause after slide before next photo cycle
const NO_CONFIG_RETRY_MS    = 1000;   // retry interval when config not yet available
const DEFAULT_LAYOUT_DUR_MS = 8000;   // fallback layout duration
const DEFAULT_HERO_LOCK_SEC = 30;     // cross-screen hero lock TTL

// Layout module paths, keyed by layout name.
const _LAYOUT_PATHS = {
  fullscreen:   './fullscreen.js',
  sidebyside:   './sidebyside.js',
  featuredduo:  './featuredduo.js',
  polaroid:     './polaroid.js',
  mosaic:       './mosaic.js',
  dynamicsplit: './dynamicsplit.js',
  triptych:     './triptych.js',
  cascade:      './cascade.js',
  filmstrip:    './filmstrip.js',
};

// Display state shared with heartbeat
export const displayState = {
  layoutType:          null,
  focusGroup:          null,
  visibleIds:          [],
  lastCycleAt:         0,
  lastCycleDurationMs: null,
};

let _container             = null;
let _lifecycle             = null;
let _config                = null;
let _globalConfig          = null;
let _heroLocks             = new Map();
let _screenId              = null;
let _cycleTimer            = null;
let _running               = false;
let _photoCycleCount       = 0;       // completed photo cycles since last slide interleave
let _lastSubmissionWallAt  = Date.now();

/** @type {Map<string, Object>} name → layout descriptor */
let _layouts = new Map();

// ---------------------------------------------------------------------------
// Layout loading
// ---------------------------------------------------------------------------

async function _loadLayouts() {
  const entries = Object.entries(_LAYOUT_PATHS);
  const results = await Promise.allSettled(
    entries.map(([, path]) => import(path)),
  );

  for (let i = 0; i < entries.length; i++) {
    const [name] = entries[i];
    const result = results[i];
    if (result.status === 'fulfilled' && result.value?.layout) {
      _layouts.set(name, result.value.layout);
    } else {
      const reason = result.status === 'rejected' ? result.reason?.message : 'no layout export';
      console.warn(`[layouts] skipping ${name}: ${reason}`);
    }
  }
}

const _layoutsReady = _loadLayouts();

// ---------------------------------------------------------------------------
// Helpers object passed to layout.pick()
// ---------------------------------------------------------------------------

function _buildHelpers(cfg, selectionContext) {
  const poolSize = _readyPoolSize(cfg);
  const _resolveCfg = (candidate) => candidate || cfg;
  const _resolveAvoidRecentMs = (activeCfg, count, options = {}) =>
    Number(options.avoidRecentMs ?? getRecentAvoidWindowMs(activeCfg, count, poolSize));

  return {
    pickPhotos: (count, c, excludeIds, hardExclude, options = {}) => {
      const activeCfg = _resolveCfg(c);
      const avoidRecentMs = _resolveAvoidRecentMs(activeCfg, count, options);
      return pickPhotos(count, activeCfg, excludeIds, hardExclude, { ...options, avoidRecentMs, selectionContext });
    },
    pickNewestPhotos: (count, c, excludeIds, options = {}) => {
      const activeCfg = _resolveCfg(c);
      const avoidRecentMs = _resolveAvoidRecentMs(activeCfg, count, options);
      return pickNewestPhotos(count, activeCfg, excludeIds, { ...options, avoidRecentMs, selectionContext });
    },
    pickAndClaimHero: (activeCfg, options = {}, useFallback = true) =>
      _pickAndClaimHero(activeCfg, options, useFallback, selectionContext),
  };
}

function _scheduleCycle(delayMs) {
  if (!_running) return;
  if (_cycleTimer) {
    clearTimeout(_cycleTimer);
    _cycleTimer = null;
  }
  _cycleTimer = setTimeout(runCycle, Math.max(0, Number(delayMs) || 0));
}

// ---------------------------------------------------------------------------
// Init / config
// ---------------------------------------------------------------------------

export function initCycle(container, screenId) {
  _container = container;
  _screenId  = screenId;
  _lifecycle = createLayoutLifecycle(container);
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

export function startCycle() {
  if (_running) return;
  _running = true;
  const phaseMs = _config?.cyclePhaseMs || 0;
  _scheduleCycle(phaseMs);
}

export function stopCycle() {
  _running = false;
  _photoCycleCount = 0;
  if (_cycleTimer) {
    clearTimeout(_cycleTimer);
    _cycleTimer = null;
  }
  _lifecycle?.clear('stop');
  resetSlidesRuntime();
}

// ---------------------------------------------------------------------------
// Pool size helpers
// ---------------------------------------------------------------------------

function _readyPoolSize(cfg) {
  return getReadyPhotoPoolSize(cfg);
}

function _layoutSlotNeed(name, cfg, poolSize) {
  if (name === 'mosaic') {
    if (poolSize < 6) return Infinity;
    const enabled = (cfg.templateEnabled || Object.keys(TEMPLATE_DEFS))
      .filter(id => TEMPLATE_DEFS[id])
      .filter(id => TEMPLATE_DEFS[id].slots.length <= poolSize);
    return enabled.length ? 1 : Infinity;
  }
  if (name === 'polaroid')  return 8;
  if (name === 'filmstrip') return 6;
  return _layouts.get(name)?.minPhotos || 1;
}

// ---------------------------------------------------------------------------
// Submission wall (separate code path — not a photo layout)
// ---------------------------------------------------------------------------

function _buildSubmissionWallLayout(cycleStart, submissionMode, hasSubmissions, hideWhenEmpty, wallOptions) {
  const mode = submissionMode === 'off' ? 'both' : submissionMode;
  const pageSize = Math.max(3, Math.min(12, Number(wallOptions?.pageSize) || 6));
  const count = mode === 'single' ? 1 : pageSize * 4;
  const items = hasSubmissions ? pickSubmissionWindow(count, Math.max(24, pageSize * 8)) : [];

  if (!items.length && hideWhenEmpty) return null;

  const effectiveMode = items.length ? mode : 'single';
  const built = buildSubmissionWall(items, effectiveMode, { ...wallOptions, pageSize });
  const duration = Math.max(5000, Math.min(120000, Number(_globalConfig?.submissionDisplayDurationSec || 12) * 1000));
  _lastSubmissionWallAt = cycleStart;

  return { built, layoutType: 'submissionwall', duration };
}

// ---------------------------------------------------------------------------
// Layout selection (pool-size aware)
// ---------------------------------------------------------------------------

function _selectCandidates(cfg, poolSize) {
  const allNames = Array.from(_layouts.keys());

  let eligible = allNames.filter(name => {
    const desc = _layouts.get(name);
    return poolSize >= (desc?.minPhotos || 1) && poolSize >= _layoutSlotNeed(name, cfg, poolSize);
  });

  if (eligible.includes('mosaic')) {
    const enabled = (cfg.templateEnabled || Object.keys(TEMPLATE_DEFS))
      .filter(id => TEMPLATE_DEFS[id])
      .filter(id => TEMPLATE_DEFS[id].slots.length <= poolSize);
    cfg = { ...cfg, templateEnabled: enabled };
    if (!cfg.templateEnabled.length) {
      eligible = eligible.filter(name => name !== 'mosaic');
    }
  }

  const adminEnabled = cfg.enabledLayouts || allNames;
  let candidates = eligible.filter(l => adminEnabled.includes(l));
  if (!candidates.length) candidates = ['fullscreen'];

  return { candidates, cfg };
}

// ---------------------------------------------------------------------------
// Core cycle
// ---------------------------------------------------------------------------

async function runCycle() {
  await _layoutsReady;

  if (!_running || !_config || !_lifecycle) {
    _scheduleCycle(NO_CONFIG_RETRY_MS);
    return;
  }

  let cfg = _config;
  const transType = cfg.transition || 'fade';
  const transMs   = cfg.transitionTime || 800;

  // ── Slide interleave check ────────────────────────────────────────────────
  const interleaveEvery = getInterleaveEvery();
  const shouldPlaySlide = hasPlaySoon()
    || (interleaveEvery > 0 && _photoCycleCount >= interleaveEvery);

  if (shouldPlaySlide) {
    _photoCycleCount = 0;
    const played = await runNextSlide({
      transition: transType,
      transitionMs: transMs,
      showRenderable: (renderable, transitionType, transitionMs) =>
        _lifecycle.showRenderable(renderable, transitionType, transitionMs),
    });

    if (!_running) return;
    if (played) {
      _scheduleCycle(POST_SLIDE_DELAY_MS);
      return;
    }
    // Nothing played (no playlist / all disabled) — fall through to photo cycle
  }

  const cycleStart = Date.now();
  const submissionMode = _globalConfig?.submissionDisplayMode || 'off';
  const wallOptions = { ...getSubmissionWallOptions(), bottomInset: getBottomInset() };
  const wallState = getSubmissionWallState();
  const hasSubmissions = wallState.totalCount > 0;
  const hideWhenEmpty = wallOptions.hideWhenEmpty !== false;
  const submissionsEnabled = wallOptions.enabled !== false
    && submissionMode !== 'off'
    && (wallState.canShow || (hasSubmissions && !hideWhenEmpty));
  const submissionIntervalMs = wallState.intervalMs;
  const shouldRunSubmissionWall = submissionsEnabled && ((cycleStart - _lastSubmissionWallAt) >= submissionIntervalMs);

  const poolSize = _readyPoolSize(cfg);
  const { candidates, cfg: adjustedCfg } = _selectCandidates(cfg, poolSize);
  cfg = adjustedCfg;

  let layoutType = candidates[Math.floor(Math.random() * candidates.length)];
  if (shouldRunSubmissionWall) {
    layoutType = 'submissionwall';
  }

  let built, resolvedType, slotEls, layoutDesc, selectionContext;

  if (layoutType === 'submissionwall') {
    const result = _buildSubmissionWallLayout(cycleStart, submissionMode, hasSubmissions, hideWhenEmpty, wallOptions);
    if (result) {
      built        = result.built;
      resolvedType = result.layoutType;
      cfg = { ...cfg, _overrideDuration: result.duration };
    } else {
      layoutType = 'fullscreen';
    }
  }

  if (!built) {
    layoutDesc = _layouts.get(layoutType) || _layouts.get('fullscreen');
    selectionContext = createSelectionContext(cfg, displayState.visibleIds);
    const helpers = _buildHelpers(cfg, selectionContext);
    const picked  = layoutDesc.pick(cfg, helpers);
    built         = layoutDesc.build(picked, cfg);
    resolvedType  = built.templateName || layoutDesc.name;
    slotEls       = built.slotEls || null;
  }

  // Mosaic duration: scale up with swap rounds so each "scene" gets comparable
  // screen time to other layouts.  Each round adds 40% of layoutDuration.
  // mosaicDurationFactor (30-100%) then optionally trims the result.
  if (!cfg._overrideDuration && layoutType === 'mosaic') {
    const base   = cfg.layoutDuration || DEFAULT_LAYOUT_DUR_MS;
    const rounds = cfg.mosaicSwapRounds ?? 1;
    const factor = (cfg.mosaicDurationFactor ?? 100) / 100;
    const scaled = Math.round(base * (1 + rounds * 0.4) * Math.max(0.3, Math.min(1.0, factor)));
    cfg = { ...cfg, _overrideDuration: scaled };
  }

  const duration = cfg._overrideDuration || cfg.layoutDuration || DEFAULT_LAYOUT_DUR_MS;
  const visibleIds = built.visibleIds || [];
  const startMotionAfterShow = resolvedType === 'submissionwall';

  const shown = await _lifecycle.showRenderable({
    el: built.el,
    onWillShow() {
      if (!startMotionAfterShow && cfg.kenBurnsEnabled !== false && built.startMotion) {
        built.startMotion(duration);
      }
    },
    async onDidShow({ signal }) {
      if (startMotionAfterShow && built.startMotion) {
        built.startMotion(duration);
      }

      selectionContext?.commitShown(visibleIds);

      if (!layoutDesc?.postMount || !slotEls || signal.aborted) return;

      // Fire postMount as a background task so onDidShow returns immediately.
      // This lets showRenderable complete right after the transition, so
      // _scheduleCycle(duration) fires at the correct baseline — giving the
      // layout exactly `duration` ms on screen with swaps running inside that
      // window instead of extending it.
      layoutDesc.postMount({
        slotEls,
        cfg,
        cycleStart,
        visibleIds,
        signal,
        pickMorePhotos: (count, options = {}) => {
          const avoidRecentMs = Number(options.avoidRecentMs ?? getRecentAvoidWindowMs(cfg, count));
          return pickPhotos(
            count,
            cfg,
            [...visibleIds, ...(options.excludeIds || [])],
            false,
            {
              orientation: options.orientation || 'any',
              enforceOrientation: options.enforceOrientation,
              orientationBoost: options.orientationBoost,
              avoidRecentMs,
              selectionContext,
            },
          );
        },
      }).then(newIds => {
        if (!signal.aborted && newIds?.length) {
          selectionContext?.commitShown(newIds);
          displayState.visibleIds = [...new Set([...displayState.visibleIds, ...newIds])];
        }
      }).catch(() => {});
    },
    destroy: built.destroy || null,
  }, transType, transMs);

  if (!_running || !shown) return;

  displayState.layoutType          = resolvedType;
  displayState.visibleIds          = visibleIds;
  displayState.lastCycleAt         = cycleStart;
  displayState.lastCycleDurationMs = Date.now() - cycleStart;
  displayState.focusGroup          = cfg.groupMode === 'manual' ? cfg.activeGroup : null;

  _photoCycleCount += 1;
  _scheduleCycle(duration);
}

// ---------------------------------------------------------------------------
// Hero picking helpers
// ---------------------------------------------------------------------------

function _claimHero(photoId, ttlSec) {
  sendHeroClaim(photoId, ttlSec);
}

function _pickAndClaimHero(cfg, options = {}, useFallback = true, selectionContext = null) {
  const hero = pickHeroPhoto(cfg, _heroLocks, _screenId, { ...options, selectionContext });
  const avoidRecentMs = Number(options.avoidRecentMs ?? getRecentAvoidWindowMs(cfg, 1));
  const photo = hero || (useFallback
    ? pickPhotos(1, cfg, [], true, { ...options, avoidRecentMs, selectionContext })[0] || null
    : null);

  if (photo) {
    selectionContext?.heroIds?.add(photo.id);
    _claimHero(photo.id, cfg.crossScreenHeroLockSec || DEFAULT_HERO_LOCK_SEC);
  }

  return photo;
}
