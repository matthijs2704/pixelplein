// Photo selection: recency-weighted picking, hero picking, slot assignment

import { lerp, shuffle } from '../../shared/utils.js';
import { isPreloaded } from './preload.js';
import {
  photoRegistry,
  otherScreenVisibleIds,
  _recentlyShown,
  _heroShownAt,
  _showCounts,
} from './photos.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECENTLY_SHOWN_PUSHBACK_MS = 90_000;  // within 90 s → heavy weight penalty
const RECENTLY_SHOWN_PENALTY     = 0.05;    // multiplier when inside pushback window
const MIN_RECENT_HARD_AVOID_MS   = 15_000;  // keep photos out for at least ~2 cycles
const MAX_RECENT_HARD_AVOID_MS   = 120_000; // but don't freeze them out for too long
const MAX_RECENT_ROTATION_CYCLES = 6;       // cap long-pool cooldown growth
const RECENCY_FLOOR              = 0.05;    // weight floor for oldest photo at bias=100
const FAIRNESS_DECAY             = 1.5;     // penalty = 1 / (1 + count × decay)
const UNPRELOADED_PENALTY        = 0.6;     // mild tie-breaker, not a fairness override
const HERO_CANDIDATE_BOOST       = 2.0;     // weight boost for heroCandidate in normal picks
const HERO_CANDIDATE_HERO_BOOST  = 3.0;     // weight boost for heroCandidate in hero picks
const DEFAULT_ORIENTATION_BOOST  = 1.35;    // soft preference multiplier for matching orientation
const HERO_ORIENTATION_BOOST     = 1.25;    // orientation boost in hero picker

// Aspect-ratio scoring targets for arrangePhotosForSlots()
const PORTRAIT_SLOT_TARGET_RATIO = 0.82;    // ideal w/h for portrait slots (≈3:4)
const PORTRAIT_MATCH_BONUS       = 0.25;    // extra fit score when photo is actually portrait
const NORMAL_SLOT_TARGET_RATIO   = 1.3;     // ideal w/h for standard slots (≈4:3)
const HERO_LANDSCAPE_PENALTY     = 0.5;     // penalty multiplier for portrait photos in hero slots
const PORTRAIT_IN_LANDSCAPE_PENALTY = 0.6;  // fit penalty for portrait photos in landscape slots

// ---------------------------------------------------------------------------
// Selection context
// ---------------------------------------------------------------------------

export function createSelectionContext(cfg, previousVisibleIds = []) {
  const reservedIds = new Set();
  const previousIds = new Set(previousVisibleIds || []);
  const heroIds     = new Set();

  return {
    cfg: cfg || {},
    reservedIds,
    previousIds,
    heroIds,
    reserve(photo, options = {}) {
      if (!photo?.id) return;
      reservedIds.add(photo.id);
      if (options.hero) heroIds.add(photo.id);
    },
    commitShown(ids, shownAt = Date.now()) {
      const uniqueIds = new Set(ids || []);
      for (const id of uniqueIds) {
        if (!id) continue;
        _recentlyShown.set(id, shownAt);
        _showCounts.set(id, (_showCounts.get(id) || 0) + 1);
        if (heroIds.has(id)) _heroShownAt.set(id, shownAt);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Group filtering
// ---------------------------------------------------------------------------

function _photoGroup(photo) {
  return photo?.eventGroup || 'ungrouped';
}

function _hiddenGroupSet(cfg) {
  return new Set(Array.isArray(cfg?.hiddenGroups) ? cfg.hiddenGroups : []);
}

export function getReadyPhotoPool(cfg) {
  const all = Array.from(photoRegistry.values()).filter(p => p.status === 'ready');
  if (!all.length) return [];

  const groupMode    = cfg.groupMode  || 'auto';
  const activeGroup  = cfg.activeGroup || 'ungrouped';
  const hiddenGroups = _hiddenGroupSet(cfg);
  const mixPct       = cfg.groupMixPct ?? 20;

  if (groupMode === 'manual') {
    const visible = all.filter(p => {
      const group = _photoGroup(p);
      return group === activeGroup || !hiddenGroups.has(group);
    });
    const inGroup  = all.filter(p => _photoGroup(p) === activeGroup);
    const outGroup = visible.filter(p => _photoGroup(p) !== activeGroup);
    if (!inGroup.length) return visible;
    const mixCount = Math.round(visible.length * (mixPct / 100));
    return [...inGroup, ...shuffle(outGroup).slice(0, mixCount)];
  }

  return all.filter(p => !hiddenGroups.has(_photoGroup(p)));
}

export function getReadyPhotoPoolSize(cfg) {
  return getReadyPhotoPool(cfg).length;
}

export function getRecentAvoidWindowMs(cfg, requestedCount = 1, poolSize = null) {
  const baseMs = Math.max(3000, Number(cfg?.layoutDuration) || 8000);
  const slots  = Math.max(1, Number(requestedCount) || 1);
  const rawPool = poolSize == null ? getReadyPhotoPoolSize(cfg) : Number(poolSize);
  const pool    = Math.max(0, Number.isFinite(rawPool) ? rawPool : getReadyPhotoPoolSize(cfg));

  if (!pool) return baseMs;

  const rotationCycles = Math.max(1, Math.min(MAX_RECENT_ROTATION_CYCLES, Math.ceil(pool / slots)));
  return Math.max(
    MIN_RECENT_HARD_AVOID_MS,
    Math.min(MAX_RECENT_HARD_AVOID_MS, Math.round(baseMs * rotationCycles)),
  );
}

// ---------------------------------------------------------------------------
// Recency-weighted scoring
// ---------------------------------------------------------------------------

/**
 * Build a map of id → relative recency multiplier for the given pool.
 *
 * Photos are ranked by addedAt (newest = rank 0, oldest = rank n-1).
 * The multiplier is linearly interpolated by rank:
 *   newest → 1.0
 *   oldest → floor  (lerp from 1.0 down to floor based on recencyBias)
 *     bias=0   → floor = 1.0  (all photos equal)
 *     bias=100 → floor = 0.05 (oldest photo gets minimum weight)
 *
 * With only one photo in the pool it always gets 1.0.
 *
 * @param {Object[]} pool
 * @param {number}   recencyBias - 0..100
 * @returns {Map<string, number>}
 */
function _buildRelativeRecencyMap(pool, recencyBias) {
  const map = new Map();
  if (!pool.length) return map;

  // Sort a copy newest-first
  const sorted = [...pool].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const n      = sorted.length;

  // floor: bias=0 → 1.0 (flat), bias=100 → RECENCY_FLOOR
  const floor = lerp(1.0, RECENCY_FLOOR, recencyBias / 100);

  sorted.forEach((photo, rank) => {
    // t=0 for newest, t=1 for oldest
    const t    = n > 1 ? rank / (n - 1) : 0;
    const mult = lerp(1.0, floor, t);
    map.set(photo.id, mult);
  });

  return map;
}

/**
 * Compute the base selection weight for a single photo.
 *
 * Weight components:
 *  1. Recency multiplier — relative rank within the current pool.
 *     Newest photo scores 1.0, oldest scores down to a floor controlled by
 *     recencyBias (0=flat/all equal, 100=oldest gets 0.05).
 *  2. Fairness penalty — photos shown more times get a lower weight,
 *     preventing any photo from being completely starved.
 *     penalty = 1 / (1 + showCount × 0.5)
 *  3. Recently-shown pushback — if shown in the last ~90 s, weight is
 *     scaled down further so the same photo doesn't repeat too quickly.
 *  4. preload readiness — photos already preloaded on the client are strongly
 *     preferred so transitions avoid visible pop-in on slower links.
 *
 * Note: heroCandidate boosting is NOT included here — callers apply their own
 * hero multiplier (HERO_CANDIDATE_BOOST or HERO_CANDIDATE_HERO_BOOST) so the
 * two picking paths are decoupled.
 *
 * @param {Object}          photo
 * @param {Map<string,number>} recencyMap - pre-built relative recency multipliers
 * @param {number}          now
 * @returns {number} weight (> 0)
 */
function _photoWeight(photo, recencyMap, now) {
  // 1. Relative recency multiplier
  const recencyMult = recencyMap.get(photo.id) ?? 1.0;

  // 2. Fairness penalty
  const count        = _showCounts.get(photo.id) || 0;
  const fairnessMult = 1 / (1 + count * FAIRNESS_DECAY);

  // 3. Recently-shown pushback (within last RECENTLY_SHOWN_PUSHBACK_MS)
  const shownAt    = _recentlyShown.get(photo.id) || 0;
  const recentAge  = now - shownAt;
  const recentMult = recentAge < RECENTLY_SHOWN_PUSHBACK_MS ? RECENTLY_SHOWN_PENALTY : 1.0;

  // 4. Prefer images already preloaded in browser cache
  const preloadMult = isPreloaded(photo.id) ? 1.0 : UNPRELOADED_PENALTY;

  return recencyMult * fairnessMult * recentMult * preloadMult;
}

function _aspectRatio(photo) {
  const w = photo.displayWidth || photo.width || 1;
  const h = photo.displayHeight || photo.height || 1;
  return w / h;
}

function _isPortrait(photo) {
  return _aspectRatio(photo) < 1.0;
}

/**
 * Does the photo match the requested orientation?
 * Returns false when orientation is 'any'.
 *
 * @param {Object} photo
 * @param {'any'|'portrait'|'landscape'} orientation
 * @returns {boolean}
 */
function _matchesOrientation(photo, orientation) {
  if (orientation === 'any') return false;
  const portrait = _isPortrait(photo);
  return orientation === 'portrait' ? portrait : !portrait;
}

/**
 * Should the photo be hard-excluded based on orientation enforcement?
 *
 * @param {Object} photo
 * @param {'any'|'portrait'|'landscape'} orientation
 * @param {boolean} enforce
 * @returns {boolean}
 */
function _failsOrientationFilter(photo, orientation, enforce) {
  if (!enforce || orientation === 'any') return false;
  return !_matchesOrientation(photo, orientation);
}

// ---------------------------------------------------------------------------
// Weighted-random pick (no queue — O(n) scoring pass)
// ---------------------------------------------------------------------------

/**
 * Pick N photos from the pool using recency-weighted random selection.
 *
 * @param {number}   count
 * @param {Object}   cfg
 * @param {string[]} excludeIds             - IDs already selected in this layout
 * @param {boolean}  hardExcludeOtherScreen - never pick a photo visible on the
 *                                            other screen (fullscreen/sidebyside)
 * @param {Object}   options
 * @param {'any'|'portrait'|'landscape'} [options.orientation='any']
 * @param {boolean}  [options.enforceOrientation=true] - strict filter when true
 * @param {number}   [options.orientationBoost=1.35] - multiplier when preferring
 * @param {number}   [options.avoidRecentMs=0] - hard avoid recently shown photos
 * @param {boolean}  [options.allowRecentFallback=true]
 * @returns {Object[]}
 */
export function pickPhotos(count, cfg, excludeIds = [], hardExcludeOtherScreen = false, options = {}) {
  const ctx = options.selectionContext || null;
  const pool = getReadyPhotoPool(cfg);
  if (!pool.length) return [];

  const orientation = options.orientation || 'any';
  const enforceOrientation = options.enforceOrientation !== false;
  const orientationBoost = Number(options.orientationBoost || DEFAULT_ORIENTATION_BOOST);
  const avoidRecentMs = Number(options.avoidRecentMs ?? 0);
  const allowRecentFallback = options.allowRecentFallback !== false;

  const recencyBias = cfg.recencyBias ?? 60;
  const now         = Date.now();
  const excludeSet  = new Set(excludeIds);
  for (const id of (ctx?.reservedIds || [])) excludeSet.add(id);
  const recencyMap  = _buildRelativeRecencyMap(pool, recencyBias);

  const picked   = [];
  const pickedSet = new Set();

  for (let i = 0; i < count; i++) {
    // Build scored candidate list excluding already-picked and hard-excluded IDs
    const candidates = [];
    const fallbacks  = [];
    const previousCandidates = [];
    const previousFallbacks = [];
    const recentCandidates = [];
    const recentFallbacks = [];
    const recentPreviousCandidates = [];
    const recentPreviousFallbacks = [];

    for (const photo of pool) {
      if (pickedSet.has(photo.id))  continue;
      if (excludeSet.has(photo.id)) continue;

      if (_failsOrientationFilter(photo, orientation, enforceOrientation)) continue;

      let w = _photoWeight(photo, recencyMap, now);
      if (photo.heroCandidate) w *= HERO_CANDIDATE_BOOST;
      if (!enforceOrientation && _matchesOrientation(photo, orientation)) {
        w *= orientationBoost;
      }
      const shownAt = _recentlyShown.get(photo.id) || 0;
      const isHardRecent = avoidRecentMs > 0 && (now - shownAt) < avoidRecentMs;
      const isPrevious = ctx?.previousIds?.has(photo.id);

      if (isHardRecent && !allowRecentFallback) continue;

      if (otherScreenVisibleIds.has(photo.id)) {
        if (!hardExcludeOtherScreen) {
          if (isHardRecent && isPrevious) recentPreviousFallbacks.push({ photo, w });
          else if (isHardRecent) recentFallbacks.push({ photo, w });
          else if (isPrevious) previousFallbacks.push({ photo, w });
          else fallbacks.push({ photo, w });
        }
      } else {
        if (isHardRecent && isPrevious) recentPreviousCandidates.push({ photo, w });
        else if (isHardRecent) recentCandidates.push({ photo, w });
        else if (isPrevious) previousCandidates.push({ photo, w });
        else candidates.push({ photo, w });
      }
    }

    const bestPool = candidates.length > 0
      ? candidates
      : (fallbacks.length > 0
          ? fallbacks
          : (previousCandidates.length > 0
              ? previousCandidates
              : (previousFallbacks.length > 0
                  ? previousFallbacks
                  : (recentCandidates.length > 0
                      ? recentCandidates
                      : (recentFallbacks.length > 0
                          ? recentFallbacks
                          : (recentPreviousCandidates.length > 0 ? recentPreviousCandidates : recentPreviousFallbacks))))));
    if (!bestPool.length) break;

    const chosen = _weightedRandom(bestPool);
    if (!chosen) break;

    picked.push(chosen);
    pickedSet.add(chosen.id);
    ctx?.reserve(chosen);
  }

  if (!ctx) {
    for (const photo of picked) {
      _recentlyShown.set(photo.id, now);
      _showCounts.set(photo.id, (_showCounts.get(photo.id) || 0) + 1);
    }
  }

  return picked;
}

/**
 * Weighted random selection from an array of { photo, w } objects.
 * @param {{ photo: Object, w: number }[]} candidates
 * @returns {Object|null} the selected photo
 */
function _weightedRandom(candidates) {
  const total = candidates.reduce((s, c) => s + c.w, 0);
  if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)]?.photo || null;

  let r = Math.random() * total;
  for (const { photo, w } of candidates) {
    r -= w;
    if (r <= 0) return photo;
  }
  return candidates[candidates.length - 1]?.photo || null;
}

// ---------------------------------------------------------------------------
// Hero shown tracking
// ---------------------------------------------------------------------------

export function markAsHeroShown(photoId) {
  const now = Date.now();
  _heroShownAt.set(photoId, now);
  _recentlyShown.set(photoId, now);
  _showCounts.set(photoId, (_showCounts.get(photoId) || 0) + 1);
}

// ---------------------------------------------------------------------------
// Hero photo picking
// ---------------------------------------------------------------------------

/**
 * Pick the best hero photo using recency-weighted scoring with cooldown.
 *
 * Scoring:
 *  - Same recency-weighted base as pickPhotos
 *  - heroCandidate flag: ×3.0 (strong preference, overrides base ×2)
 *  - Cooldown: skip if shown as hero within heroCooldownSec
 *    (scales down when pool is small)
 *  - Cross-screen lock: skip if another screen holds a lock
 *
 * @param {Object} cfg
 * @param {Map<string, Object>} heroLocks
 * @param {string} myScreenId
 * @returns {Object|null}
 */
export function pickHeroPhoto(cfg, heroLocks, myScreenId, options = {}) {
  const ctx = options.selectionContext || null;
  const pool = getReadyPhotoPool(cfg);
  if (!pool.length) return null;

  const orientation = options.orientation || 'any';
  const enforceOrientation = options.enforceOrientation !== false;
  const orientationBoost = Number(options.orientationBoost || HERO_ORIENTATION_BOOST);
  const avoidRecentMs = Number(options.avoidRecentMs ?? getRecentAvoidWindowMs(cfg, 1, pool.length));
  const allowRecentFallback = options.allowRecentFallback !== false;

  const now           = Date.now();
  const recencyBias   = cfg.recencyBias ?? 60;
  const recencyMap    = _buildRelativeRecencyMap(pool, recencyBias);

  // Scale cooldown: smaller pool → shorter cooldown so screens don't go blank
  const baseCooldownSec  = cfg.heroCooldownSec || 30;
  const scaledCooldownSec = pool.length >= 10
    ? baseCooldownSec
    : Math.max(5, Math.round(baseCooldownSec * (pool.length / 10)));
  const cooldownMs = scaledCooldownSec * 1000;

  const candidates = [];
  const previousCandidates = [];
  const recentCandidates = [];
  const recentPreviousCandidates = [];

  for (const photo of pool) {
    if (ctx?.reservedIds?.has(photo.id)) continue;
    if (_failsOrientationFilter(photo, orientation, enforceOrientation)) continue;

    // Cross-screen lock check
    const lock = heroLocks.get(photo.id);
    if (lock && lock.screenId !== myScreenId && lock.expiresAt > now) continue;

    // Hard-exclude photos currently visible on the other screen
    if (otherScreenVisibleIds.has(photo.id)) continue;

    const recentlyShownAt = _recentlyShown.get(photo.id) || 0;
    const isHardRecent = avoidRecentMs > 0 && (now - recentlyShownAt) < avoidRecentMs;
    const isPrevious = ctx?.previousIds?.has(photo.id);
    if (isHardRecent && !allowRecentFallback) continue;

    // Hero cooldown check
    const shownAt = _heroShownAt.get(photo.id) || 0;
    if (now - shownAt < cooldownMs) continue;

    // Score: base weight + heroCandidate boost (applied directly since
    // _photoWeight no longer includes hero multiplier)
    let w = _photoWeight(photo, recencyMap, now);
    if (photo.heroCandidate) w *= HERO_CANDIDATE_HERO_BOOST;

    if (!enforceOrientation && _matchesOrientation(photo, orientation)) {
      w *= orientationBoost;
    }

    if (isHardRecent && isPrevious) recentPreviousCandidates.push({ photo, w });
    else if (isHardRecent) recentCandidates.push({ photo, w });
    else if (isPrevious) previousCandidates.push({ photo, w });
    else candidates.push({ photo, w });
  }

  const bestPool = candidates.length
    ? candidates
    : (previousCandidates.length
        ? previousCandidates
        : (recentCandidates.length ? recentCandidates : recentPreviousCandidates));
  if (!bestPool.length) return null;
  const chosen = _weightedRandom(bestPool);
  if (chosen) ctx?.reserve(chosen, { hero: true });
  return chosen;
}

// ---------------------------------------------------------------------------
// Newest-first photo picking (for recent-strip slots)
// ---------------------------------------------------------------------------

/**
 * Return the N most recently-added ready photos, excluding given IDs.
 * Used by the recent-strip template to fill its dedicated "newest" slots.
 *
 * @param {number}   count
 * @param {Object}   cfg
 * @param {string[]} excludeIds
 * @returns {Object[]}
 */
export function pickNewestPhotos(count, cfg, excludeIds = [], options = {}) {
  const ctx                = options.selectionContext || null;
  const pool               = getReadyPhotoPool(cfg);
  const excludeSet         = new Set(excludeIds);
  for (const id of (ctx?.reservedIds || [])) excludeSet.add(id);
  const orientation        = options.orientation || 'any';
  const enforceOrientation = options.enforceOrientation !== false;
  const orientationBonusMs = Number(options.orientationBonusMs || 45_000);
  const avoidRecentMs      = Number(options.avoidRecentMs ?? getRecentAvoidWindowMs(cfg, count, pool.length));
  const allowRecentFallback = options.allowRecentFallback !== false;
  const now                = Date.now();

  const candidates = pool
    .filter(p => !excludeSet.has(p.id))
    .filter(p => !_failsOrientationFilter(p, orientation, enforceOrientation));

  const fresh = [];
  const previous = [];
  const recent = [];
  const recentPrevious = [];

  for (const photo of candidates) {
    const shownAt = _recentlyShown.get(photo.id) || 0;
    const isRecent = avoidRecentMs > 0 && (now - shownAt) < avoidRecentMs;
    const isPrevious = ctx?.previousIds?.has(photo.id);
    if (isRecent && isPrevious) recentPrevious.push(photo);
    else if (isRecent) recent.push(photo);
    else if (isPrevious) previous.push(photo);
    else fresh.push(photo);
  }

  const _sortNewest = (list) => list.sort((a, b) => {
    const aMatch = _matchesOrientation(a, orientation);
    const bMatch = _matchesOrientation(b, orientation);

    const aScore = (a.addedAt || 0) + (!enforceOrientation && aMatch ? orientationBonusMs : 0);
    const bScore = (b.addedAt || 0) + (!enforceOrientation && bMatch ? orientationBonusMs : 0);
    return bScore - aScore;
  });

  const picked = _sortNewest(fresh).slice(0, count);
  if (picked.length < count) {
    picked.push(..._sortNewest(previous).slice(0, count - picked.length));
  }
  if (allowRecentFallback && picked.length < count) {
    picked.push(..._sortNewest(recent).slice(0, count - picked.length));
  }
  if (allowRecentFallback && picked.length < count) {
    picked.push(..._sortNewest(recentPrevious).slice(0, count - picked.length));
  }

  for (const photo of picked) ctx?.reserve(photo);

  if (!ctx) {
    for (const photo of picked) {
      _recentlyShown.set(photo.id, now);
      _showCounts.set(photo.id, (_showCounts.get(photo.id) || 0) + 1);
    }
  }

  return picked;
}

// ---------------------------------------------------------------------------
// Aspect-ratio-aware slot assignment
// ---------------------------------------------------------------------------

/**
 * Assign photos to slots based on aspect-ratio compatibility.
 *
 * For each slot, scores every remaining candidate by how well its aspect
 * ratio fits the slot type, then picks the best match:
 *
 *  - Portrait slots: scored by closeness to PORTRAIT_SLOT_TARGET_RATIO
 *    (≈3:4), with a bonus for actually-portrait photos.
 *  - Hero slots: wider landscape photos score higher; portrait photos
 *    receive a penalty multiplier (HERO_LANDSCAPE_PENALTY).
 *  - Normal slots: scored by closeness to NORMAL_SLOT_TARGET_RATIO (≈4:3).
 *    Portrait photos receive a soft penalty but are not excluded.
 *
 * Photos are consumed greedily — once assigned to a slot they are removed
 * from the candidate list.  Returns one photo per slot (or null when no
 * suitable candidate remains).
 *
 * @param {Object[]} slots  - Template slot definitions ({portrait?, hero?})
 * @param {Object[]} photos - Candidate photos
 * @returns {(Object|null)[]} - Photos in slot order (same length as slots)
 */
export function arrangePhotosForSlots(slots, photos) {
  const remaining = [...photos];
  return slots.map(slot => {
    if (!remaining.length) return null;

    let bestIdx = 0;
    let bestFit = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      const ratio = _aspectRatio(p);
      let fit     = 0;

      if (slot.portrait) {
        fit = -Math.abs(ratio - PORTRAIT_SLOT_TARGET_RATIO);
        if (_isPortrait(p)) fit += PORTRAIT_MATCH_BONUS;
      } else if (slot.hero) {
        fit = ratio >= 1 ? ratio : ratio * HERO_LANDSCAPE_PENALTY;
      } else {
        fit = -Math.abs(ratio - NORMAL_SLOT_TARGET_RATIO);
        // Penalise portrait photos in landscape slots — prefer landscape but
        // don't hard-exclude so we never leave a slot empty.
        if (_isPortrait(p)) fit -= PORTRAIT_IN_LANDSCAPE_PENALTY;
      }

      if (fit > bestFit) {
        bestFit = fit;
        bestIdx = i;
      }
    }

    return remaining.splice(bestIdx, 1)[0];
  });
}
