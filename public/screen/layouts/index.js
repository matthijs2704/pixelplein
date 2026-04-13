// Layout cycle dispatcher: loads layout descriptors, picks layout type,
// and routes every render through a shared lifecycle manager.

import { buildSubmissionWall } from './submissionwall.js';
import { createLayoutLifecycle } from '../layout-lifecycle.js';
import {
  pickPhotos,
  pickHeroPhoto,
  markAsHeroShown,
  photoRegistry,
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POST_SLIDE_DELAY_MS   = 500;    // pause after slide before next photo cycle
const NO_CONFIG_RETRY_MS    = 1000;   // retry interval when config not yet available
const DEFAULT_LAYOUT_DUR_MS = 8000;   // fallback layout duration
const DEFAULT_HERO_LOCK_SEC = 30;     // cross-screen hero lock TTL

// Layout module paths, keyed by layout name.
const _LAYOUT_PATHS = {
  fullscreen:  './fullscreen.js',
  sidebyside:  './sidebyside.js',
  featuredduo: './featuredduo.js',
  polaroid:    './polaroid.js',
  mosaic:      './mosaic.js',
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

function _buildHelpers() {
  return {
    pickPhotos,
    pickAndClaimHero: _pickAndClaimHero,
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
  const groupMode   = cfg.groupMode   || 'auto';
  const activeGroup = cfg.activeGroup || 'ungrouped';
  const all = Array.from(photoRegistry.values()).filter(p => p.status === 'ready');
  if (groupMode !== 'manual') return all.length;
  return all.filter(p => p.eventGroup === activeGroup).length || all.length;
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
    return poolSize >= (desc?.minPhotos || 1);
  });

  if (poolSize <= 5 && eligible.includes('mosaic')) {
    cfg = { ...cfg, templateEnabled: (cfg.templateEnabled || []).filter(t => t.startsWith('uniform')) };
    if (!cfg.templateEnabled.length) cfg = { ...cfg, templateEnabled: ['uniform-4', 'uniform-6'] };
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

  let built, resolvedType, slotEls, layoutDesc;

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
    const helpers = _buildHelpers();
    const picked  = layoutDesc.pick(cfg, helpers);
    built         = layoutDesc.build(picked, cfg);
    resolvedType  = built.templateName || layoutDesc.name;
    slotEls       = built.slotEls || null;
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

      if (!layoutDesc?.postMount || !slotEls || signal.aborted) return;

      try {
        const newIds = await layoutDesc.postMount({
          slotEls,
          cfg,
          cycleStart,
          visibleIds,
          signal,
          pickMorePhotos: (count, options = {}) =>
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
            ),
        });

        if (!signal.aborted && newIds?.length) {
          displayState.visibleIds = [...new Set([...displayState.visibleIds, ...newIds])];
        }
      } catch {}
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
