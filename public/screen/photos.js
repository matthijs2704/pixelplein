// Photo pool management: recency-weighted selection, hero picking, slot assignment

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
}

export function updatePhoto(photo) {
  photoRegistry.set(photo.id, photo);
}

/**
 * Replace the entire photo registry (e.g. on reconnect).
 */
export function setPhotos(photos) {
  photoRegistry.clear();
  recentlyShown.clear();
  heroShownAt.clear();
  showCounts.clear();

  for (const p of photos) {
    photoRegistry.set(p.id, p);
    showCounts.set(p.id, 0);
  }
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
    if (now - ts > 10 * 60 * 1000) recentlyShown.delete(id);
  }
  for (const [id, ts] of heroShownAt) {
    if (now - ts > 15 * 60 * 1000) heroShownAt.delete(id);
  }

  // Periodically halve all show-counts so long-running events don't accumulate
  // unbounded numbers. Halving preserves relative order while preventing overflow.
  if (showCounts.size > 0) {
    let maxCount = 0;
    for (const c of showCounts.values()) { if (c > maxCount) maxCount = c; }
    if (maxCount > 200) {
      for (const [id, c] of showCounts) showCounts.set(id, Math.floor(c / 2));
    }
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Group filtering
// ---------------------------------------------------------------------------

function getReadyPhotos(cfg) {
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
function buildRelativeRecencyMap(pool, recencyBias) {
  const map = new Map();
  if (!pool.length) return map;

  // Sort a copy newest-first
  const sorted = [...pool].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const n      = sorted.length;

  // floor: bias=0 → 1.0 (flat), bias=100 → 0.05
  const floor = lerp(1.0, 0.05, recencyBias / 100);

  sorted.forEach((photo, rank) => {
    // t=0 for newest, t=1 for oldest
    const t    = n > 1 ? rank / (n - 1) : 0;
    const mult = lerp(1.0, floor, t);
    map.set(photo.id, mult);
  });

  return map;
}

/**
 * Compute the selection weight for a single photo.
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
 *  4. heroCandidate flag — 2× boost (hero picker handles the main hero logic;
 *     this just makes candidates appear slightly more in non-hero slots too).
 *
 * @param {Object}          photo
 * @param {Map<string,number>} recencyMap - pre-built relative recency multipliers
 * @param {number}          now
 * @returns {number} weight (> 0)
 */
function photoWeight(photo, recencyMap, now) {
  // 1. Relative recency multiplier
  const recencyMult = recencyMap.get(photo.id) ?? 1.0;

  // 2. Fairness penalty
  const count        = showCounts.get(photo.id) || 0;
  const fairnessMult = 1 / (1 + count * 0.5);

  // 3. Recently-shown pushback (within last 90 s)
  const shownAt    = recentlyShown.get(photo.id) || 0;
  const recentAge  = now - shownAt;
  const recentMult = recentAge < 90_000 ? 0.05 : 1.0;

  // 4. heroCandidate flag
  const heroBump = photo.heroCandidate ? 2.0 : 1.0;

  return recencyMult * fairnessMult * recentMult * heroBump;
}

function lerp(a, b, t) { return a + (b - a) * t; }

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
 * @returns {Object[]}
 */
export function pickPhotos(count, cfg, excludeIds = [], hardExcludeOtherScreen = false) {
  const pool = getReadyPhotos(cfg);
  if (!pool.length) return [];

  const recencyBias = cfg.recencyBias ?? 60;
  const now         = Date.now();
  const excludeSet  = new Set(excludeIds);
  const recencyMap  = buildRelativeRecencyMap(pool, recencyBias);

  const picked   = [];
  const pickedSet = new Set();

  // Soft-exclude candidates (other-screen dupes) used as fallback
  const softExcluded = [];

  for (let i = 0; i < count; i++) {
    // Build scored candidate list excluding already-picked and hard-excluded IDs
    const candidates = [];
    const fallbacks  = [];

    for (const photo of pool) {
      if (pickedSet.has(photo.id))  continue;
      if (excludeSet.has(photo.id)) continue;

      const w = photoWeight(photo, recencyMap, now);

      if (otherScreenVisibleIds.has(photo.id)) {
        if (!hardExcludeOtherScreen) fallbacks.push({ photo, w });
      } else {
        candidates.push({ photo, w });
      }
    }

    const pool2 = candidates.length > 0 ? candidates : fallbacks;
    if (!pool2.length) break;

    const chosen = weightedRandom(pool2);
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
function weightedRandom(candidates) {
  const total = candidates.reduce((s, c) => s + c.w, 0);
  if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)]?.photo || null;

  let r = Math.random() * total;
  for (const { photo, w } of candidates) {
    r -= w;
    if (r <= 0) return photo;
  }
  return candidates[candidates.length - 1]?.photo || null;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
export function pickHeroPhoto(cfg, heroLocks, myScreenId) {
  const pool = getReadyPhotos(cfg);
  if (!pool.length) return null;

  const now           = Date.now();
  const recencyBias   = cfg.recencyBias ?? 60;
  const recencyMap    = buildRelativeRecencyMap(pool, recencyBias);

  // Scale cooldown: smaller pool → shorter cooldown so screens don't go blank
  const baseCooldownSec  = cfg.heroCooldownSec || 30;
  const scaledCooldownSec = pool.length >= 10
    ? baseCooldownSec
    : Math.max(5, Math.round(baseCooldownSec * (pool.length / 10)));
  const cooldownMs = scaledCooldownSec * 1000;

  const candidates = [];

  for (const photo of pool) {
    // Cross-screen lock check
    const lock = heroLocks.get(photo.id);
    if (lock && lock.screenId !== myScreenId && lock.expiresAt > now) continue;

    // Hard-exclude photos currently visible on the other screen
    if (otherScreenVisibleIds.has(photo.id)) continue;

    // Hero cooldown check
    const shownAt = heroShownAt.get(photo.id) || 0;
    if (now - shownAt < cooldownMs) continue;

    // Score: use recency weight, then boost heroCandidate to 3× (replaces base 2×)
    let w = photoWeight(photo, recencyMap, now);
    if (photo.heroCandidate) w = (w / 2.0) * 3.0; // undo base 2× and apply 3×

    candidates.push({ photo, w });
  }

  if (!candidates.length) return null;
  return weightedRandom(candidates);
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
export function pickNewestPhotos(count, cfg, excludeIds = []) {
  const pool      = getReadyPhotos(cfg);
  const excludeSet = new Set(excludeIds);
  const sorted    = pool
    .filter(p => !excludeSet.has(p.id))
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

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
 * @param {Object[]} slots  - Template slot definitions
 * @param {Object[]} photos - Candidate photos
 * @returns {Object[]}      - Photos in slot order (same length as slots)
 */
export function arrangePhotosForSlots(slots, photos) {
  const remaining = [...photos];
  return slots.map(slot => {
    if (!remaining.length) return null;

    let bestIdx = 0;
    let bestFit = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const p     = remaining[i];
      const w     = p.displayWidth  || p.width  || 1;
      const h     = p.displayHeight || p.height || 1;
      const ratio = w / h;
      let fit     = 0;

      if (slot.portrait) {
        fit = ratio < 0.8 ? (0.8 - ratio) * 10 : -ratio;
      } else if (slot.hero) {
        fit = ratio >= 1 ? ratio : ratio * 0.5;
      } else {
        fit = -Math.abs(ratio - 1.3);
      }

      if (fit > bestFit) {
        bestFit = fit;
        bestIdx = i;
      }
    }

    return remaining.splice(bestIdx, 1)[0];
  });
}
