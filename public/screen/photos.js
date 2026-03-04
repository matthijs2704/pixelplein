// Photo pool management: registry, state tracking, periodic cleanup

import { clearPreloaded } from './preload.js';

// Re-export selection API so existing callers that import from photos.js
// continue to work without changes.
export {
  pickPhotos,
  pickHeroPhoto,
  pickNewestPhotos,
  arrangePhotosForSlots,
  markAsHeroShown,
} from './photo-selection.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECENTLY_SHOWN_TTL_MS   = 10 * 60 * 1000; // purge entries older than 10 min
const HERO_SHOWN_TTL_MS       = 15 * 60 * 1000; // purge hero timestamps older than 15 min
const SHOW_COUNT_HALVE_THRESH = 200;             // halve all counts when max exceeds this
const CLEANUP_INTERVAL_MS     = 60_000;          // periodic cleanup tick

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Map<string, Object>} All known photos keyed by id */
export const photoRegistry = new Map();

/** IDs visible on the other screen(s) (updated via health_update) */
export let otherScreenVisibleIds = new Set();

/**
 * Timestamps of when each photo was last shown in ANY slot.
 * Used to penalise recently-shown photos in the weighted pick.
 * id → shownAt (ms)
 *
 * Exported with _ prefix for use by photo-selection.js only.
 */
export const _recentlyShown = new Map();

/**
 * Timestamps of when each photo was last shown in a HERO/fullscreen slot.
 * id → shownAt (ms)
 *
 * Exported with _ prefix for use by photo-selection.js only.
 */
export const _heroShownAt = new Map();

/**
 * Per-photo show-count since last full rotation.
 * Used as a fairness penalty so no photo is starved even with aggressive recency.
 * id → count (integer)
 *
 * Exported with _ prefix for use by photo-selection.js only.
 */
export const _showCounts = new Map();

// ---------------------------------------------------------------------------
// Registry management
// ---------------------------------------------------------------------------

export function addPhoto(photo) {
  photoRegistry.set(photo.id, photo);
  // New photo — reset its show-count so it competes fresh
  if (!_showCounts.has(photo.id)) _showCounts.set(photo.id, 0);
}

export function removePhoto(id) {
  photoRegistry.delete(id);
  _recentlyShown.delete(id);
  _heroShownAt.delete(id);
  _showCounts.delete(id);
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
  for (const [id, ts] of _recentlyShown) {
    if (now - ts > RECENTLY_SHOWN_TTL_MS) _recentlyShown.delete(id);
  }
  for (const [id, ts] of _heroShownAt) {
    if (now - ts > HERO_SHOWN_TTL_MS) _heroShownAt.delete(id);
  }

  // Periodically halve all show-counts so long-running events don't accumulate
  // unbounded numbers. Halving preserves relative order while preventing overflow.
  if (_showCounts.size > 0) {
    let maxCount = 0;
    for (const c of _showCounts.values()) { if (c > maxCount) maxCount = c; }
    if (maxCount > SHOW_COUNT_HALVE_THRESH) {
      for (const [id, c] of _showCounts) _showCounts.set(id, Math.floor(c / 2));
    }
  }
}, CLEANUP_INTERVAL_MS);
