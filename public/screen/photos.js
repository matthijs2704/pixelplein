// Photo pool management: recency-weighted selection, hero picking, slot assignment

import { lerp, shuffle }  from '../../shared/utils.js';
import { clearPreloaded, isPreloaded } from './preload.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECENTLY_SHOWN_TTL_MS   = 10 * 60 * 1000; // purge entries older than 10 min
const HERO_SHOWN_TTL_MS       = 15 * 60 * 1000; // purge hero timestamps older than 15 min
const SHOW_COUNT_HALVE_THRESH = 200;             // halve all counts when max exceeds this
const CLEANUP_INTERVAL_MS     = 60_000;          // periodic cleanup tick

const RECENTLY_SHOWN_PUSHBACK_MS = 90_000;  // within 90 s → heavy weight penalty
const RECENTLY_SHOWN_PENALTY     = 0.05;    // multiplier when inside pushback window
const RECENCY_FLOOR              = 0.05;    // weight floor for oldest photo at bias=100
const FAIRNESS_DECAY             = 0.5;     // penalty = 1 / (1 + count × decay)
const UNPRELOADED_PENALTY        = 0.15;    // multiplier for photos not yet in browser cache
const HERO_CANDIDATE_BOOST       = 2.0;     // weight boost for heroCandidate in normal picks
const HERO_CANDIDATE_HERO_BOOST  = 3.0;     // weight boost for heroCandidate in hero picks
const DEFAULT_ORIENTATION_BOOST  = 1.35;    // soft preference multiplier for matching orientation
const HERO_ORIENTATION_BOOST     = 1.25;    // orientation boost in hero picker

// Aspect-ratio scoring targets for arrangePhotosForSlots()
const PORTRAIT_SLOT_TARGET_RATIO = 0.82;    // ideal w/h for portrait slots (≈3:4)
const PORTRAIT_MATCH_BONUS       = 0.25;    // extra fit score when photo is actually portrait
const NORMAL_SLOT_TARGET_RATIO   = 1.3;     // ideal w/h for standard slots (≈4:3)
const HERO_LANDSCAPE_PENALTY     = 0.5;     // penalty multiplier for portrait photos in hero slots

/** @type {Map<string, Object>} All known photos keyed by id */
export const photoRegistry = new Map();

/** IDs visible on the other screen(s) (updated via health_update) */
export let otherScreenVisibleIds = new Set();

/**
 * Timestamps of when each photo was last shown in ANY slot.
 * Used to penalise recently-shown photos in the weighted pick.
 * id → shownAt (ms)
 */
const recentlyShown = new Map();

/**
 * Timestamps of when each photo was last shown in a HERO/fullscreen slot.
 * id → shownAt (ms)
 */
const heroShownAt = new Map();

/**
 * Per-photo show-count since last full rotation.
 * Used as a fairness penalty so no photo is starved even with aggressive recency.
 * id → count (integer)
 */
const showCounts = new Map();

// ---------------------------------------------------------------------------
// Registry management
// ---------------------------------------------------------------------------

export function addPhoto(photo) {
  photoRegistry.set(photo.id, photo);
  // New photo — reset its show-count so it competes fresh
  if (!showCounts.has(photo.id)) showCounts.set(photo.id, 0);
}

export function removePhoto(id) {
  photoRegistry.delete(id);
  recentlyShown.delete(id);
  heroShownAt.delete(id);
  showCounts.delete(id);
  clearPreloaded(id);
}

export function removePhotos(ids) {
  if (!Array.isArray(ids)) return;
  for (const id of ids) removePhoto(id);
}

export function updatePhoto(photo) {
  photoRegistry.set(photo.id, photo);
}

export function setOtherVisibleIds(ids) {
  otherScreenVisibleIds = new Set(ids);
}

// ---------------------------------------------------------------------------
// Periodic cleanup
// ---------------------------------------------------------------------------

setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of recentlyShown) {
    if (now - ts > RECENTLY_SHOWN_TTL_MS) recentlyShown.delete(id);
  }
  for (const [id, ts] of heroShownAt) {
    if (now - ts > HERO_SHOWN_TTL_MS) heroShownAt.delete(id);
  }

  // Periodically halve all show-counts so long-running events don't accumulate
  // unbounded numbers. Halving preserves relative order while preventing overflow.
  if (showCounts.size > 0) {
    let maxCount = 0;
    for (const c of showCounts.values()) { if (c > maxCount) maxCount = c; }
    if (maxCount > SHOW_COUNT_HALVE_THRESH) {
      for (const [id, c] of showCounts) showCounts.set(id, Math.floor(c / 2));
    }
  }
}, CLEANUP_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Group filtering
// ---------------------------------------------------------------------------

function _getReadyPhotos(cfg) {
  const all = Array.from(photoRegistry.values()).filter(p => p.status === 'ready');
  if (!all.length) return [];

  const groupMode   = cfg.groupMode  || 'auto';
  const activeGroup = cfg.activeGroup || 'ungrouped';
  const mixPct      = cfg.groupMixPct ?? 20;

  if (groupMode === 'manual') {
    const inGroup  = all.filter(p => p.eventGroup === activeGroup);
    const outGroup = all.filter(p => p.eventGroup !== activeGroup);
    if (!inGroup.length) return all;
    const mixCount = Math.round(all.length * (mixPct / 100));
    return [...inGroup, ...shuffle(outGroup).slice(0, mixCount)];
  }

  return all;
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
  const count        = showCounts.get(photo.id) || 0;
  const fairnessMult = 1 / (1 + count * FAIRNESS_DECAY);

  // 3. Recently-shown pushback (within last RECENTLY_SHOWN_PUSHBACK_MS)
  const shownAt    = recentlyShown.get(photo.id) || 0;
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
  const pool = _getReadyPhotos(cfg);
  if (!pool.length) return [];

  const orientation = options.orientation || 'any';
  const enforceOrientation = options.enforceOrientation !== false;
  const orientationBoost = Number(options.orientationBoost || DEFAULT_ORIENTATION_BOOST);
  const avoidRecentMs = Number(options.avoidRecentMs || 0);
  const allowRecentFallback = options.allowRecentFallback !== false;

  const recencyBias = cfg.recencyBias ?? 60;
  const now         = Date.now();
  const excludeSet  = new Set(excludeIds);
  const recencyMap  = _buildRelativeRecencyMap(pool, recencyBias);

  const picked   = [];
  const pickedSet = new Set();

  for (let i = 0; i < count; i++) {
    // Build scored candidate list excluding already-picked and hard-excluded IDs
    const candidates = [];
    const fallbacks  = [];
    const recentCandidates = [];
    const recentFallbacks = [];

    for (const photo of pool) {
      if (pickedSet.has(photo.id))  continue;
      if (excludeSet.has(photo.id)) continue;

      const isPortrait = _isPortrait(photo);

      if (_failsOrientationFilter(photo, orientation, enforceOrientation)) continue;

      let w = _photoWeight(photo, recencyMap, now);
      if (photo.heroCandidate) w *= HERO_CANDIDATE_BOOST;
      if (!enforceOrientation && _matchesOrientation(photo, orientation)) {
        w *= orientationBoost;
      }
      const shownAt = recentlyShown.get(photo.id) || 0;
      const isHardRecent = avoidRecentMs > 0 && (now - shownAt) < avoidRecentMs;

      if (isHardRecent && !allowRecentFallback) continue;

      if (otherScreenVisibleIds.has(photo.id)) {
        if (!hardExcludeOtherScreen) {
          if (isHardRecent) recentFallbacks.push({ photo, w });
          else fallbacks.push({ photo, w });
        }
      } else {
        if (isHardRecent) recentCandidates.push({ photo, w });
        else candidates.push({ photo, w });
      }
    }

    const bestPool = candidates.length > 0
      ? candidates
      : (fallbacks.length > 0
          ? fallbacks
          : (recentCandidates.length > 0 ? recentCandidates : recentFallbacks));
    if (!bestPool.length) break;

    const chosen = _weightedRandom(bestPool);
    if (!chosen) break;

    picked.push(chosen);
    pickedSet.add(chosen.id);
  }

  // Mark as recently shown and increment fairness counters
  for (const photo of picked) {
    recentlyShown.set(photo.id, now);
    showCounts.set(photo.id, (showCounts.get(photo.id) || 0) + 1);
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
  heroShownAt.set(photoId, Date.now());
  // Also count as a regular show
  showCounts.set(photoId, (showCounts.get(photoId) || 0) + 1);
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
  const pool = _getReadyPhotos(cfg);
  if (!pool.length) return null;

  const orientation = options.orientation || 'any';
  const enforceOrientation = options.enforceOrientation !== false;
  const orientationBoost = Number(options.orientationBoost || HERO_ORIENTATION_BOOST);

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

  for (const photo of pool) {
    if (_failsOrientationFilter(photo, orientation, enforceOrientation)) continue;

    // Cross-screen lock check
    const lock = heroLocks.get(photo.id);
    if (lock && lock.screenId !== myScreenId && lock.expiresAt > now) continue;

    // Hard-exclude photos currently visible on the other screen
    if (otherScreenVisibleIds.has(photo.id)) continue;

    // Hero cooldown check
    const shownAt = heroShownAt.get(photo.id) || 0;
    if (now - shownAt < cooldownMs) continue;

    // Score: base weight + heroCandidate boost (applied directly since
    // _photoWeight no longer includes hero multiplier)
    let w = _photoWeight(photo, recencyMap, now);
    if (photo.heroCandidate) w *= HERO_CANDIDATE_HERO_BOOST;

    if (!enforceOrientation && _matchesOrientation(photo, orientation)) {
      w *= orientationBoost;
    }

    candidates.push({ photo, w });
  }

  if (!candidates.length) return null;
  return _weightedRandom(candidates);
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
  const pool      = _getReadyPhotos(cfg);
  const excludeSet = new Set(excludeIds);
  const orientation = options.orientation || 'any';
  const enforceOrientation = options.enforceOrientation !== false;
  const orientationBonusMs = Number(options.orientationBonusMs || 45_000);

  const candidates = pool
    .filter(p => !excludeSet.has(p.id))
    .filter(p => !_failsOrientationFilter(p, orientation, enforceOrientation));

  const sorted = candidates.sort((a, b) => {
    const aMatch = _matchesOrientation(a, orientation);
    const bMatch = _matchesOrientation(b, orientation);

    const aScore = (a.addedAt || 0) + (!enforceOrientation && aMatch ? orientationBonusMs : 0);
    const bScore = (b.addedAt || 0) + (!enforceOrientation && bMatch ? orientationBonusMs : 0);
    return bScore - aScore;
  });

  const picked = sorted.slice(0, count);

  // Mark as recently shown so they don't spam other slots as well
  const now = Date.now();
  for (const photo of picked) {
    recentlyShown.set(photo.id, now);
    showCounts.set(photo.id, (showCounts.get(photo.id) || 0) + 1);
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

    const isPortraitSlot = Boolean(slot.portrait);
    // Never place portrait photos in horizontal slots.
    const candidates = isPortraitSlot
      ? [...remaining]
      : remaining.filter(p => !_isPortrait(p));
    if (!candidates.length) return null;

    let bestIdx = 0;
    let bestFit = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i];
      const ratio = _aspectRatio(p);
      let fit     = 0;

      if (slot.portrait) {
        fit = -Math.abs(ratio - PORTRAIT_SLOT_TARGET_RATIO);
        if (_isPortrait(p)) fit += PORTRAIT_MATCH_BONUS;
      } else if (slot.hero) {
        fit = ratio >= 1 ? ratio : ratio * HERO_LANDSCAPE_PENALTY;
      } else {
        fit = -Math.abs(ratio - NORMAL_SLOT_TARGET_RATIO);
      }

      if (fit > bestFit) {
        bestFit = fit;
        bestIdx = i;
      }
    }

    const chosen = candidates[bestIdx] || null;
    if (!chosen) return null;
    const idx = remaining.findIndex(p => p.id === chosen.id);
    if (idx < 0) return null;
    return remaining.splice(idx, 1)[0];
  });
}
