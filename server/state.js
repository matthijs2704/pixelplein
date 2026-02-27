'use strict';

// ---------------------------------------------------------------------------
// Shared in-memory state
// All mutable runtime state lives here so any server module can import it
// without circular dependencies.
// ---------------------------------------------------------------------------

/** @type {Map<string, import('./types').Photo>} */
const photosById = new Map();

/** Processing queue — array of photo IDs waiting to be processed */
const queue = [];

/** Set of IDs currently in the queue (for O(1) dedup) */
const queuedSet = new Set();

/** Number of concurrent sharp workers running */
let activeWorkers = 0;

/** @type {Map<string, import('./types').ScreenHealth>} */
const screenHealth = new Map();

/**
 * Hero locks: photoId → { screenId, expiresAt }
 * A screen locks a hero photo to prevent the other screen using it simultaneously.
 * @type {Map<string, { screenId: string, expiresAt: number }>}
 */
const heroLocks = new Map();

/**
 * Photo overrides: photoId → { heroCandidate }
 * Persisted to config.json under photoOverrides key.
 * @type {Map<string, { heroCandidate: boolean }>}
 */
const photoOverrides = new Map();

/** Ingest / cache metrics */
const metrics = {
  queueCompleted: 0,
  queueFailed: 0,
  queueEnqueued: 0,
  cacheReadyCount: 0,
  cacheFallbackServed: 0,
  cacheFileServed: 0,
  lastIngestAt: 0,
  lastScanAt: 0,
};

module.exports = {
  photosById,
  queue,
  queuedSet,
  get activeWorkers() { return activeWorkers; },
  set activeWorkers(v) { activeWorkers = v; },
  screenHealth,
  heroLocks,
  photoOverrides,
  metrics,
};
