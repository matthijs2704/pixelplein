'use strict';

const path = require('path');
const fsp  = require('fs').promises;
const state = require('../../state');
const { broadcast } = require('../ws/broadcast');
const { serializePhoto, getReadyPhotos } = require('../photos/serialize');
const { processPhoto, toCacheFilePath, PHOTOS_DIR } = require('./process');
const { getConfig } = require('../../config');
const { serializeHeroLocks } = require('../ws/handlers');

const VALID_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_CONCURRENT = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSlashes(p) {
  return p.split(path.sep).join('/');
}

function toPhotoId(filePath) {
  return normalizeSlashes(path.relative(PHOTOS_DIR, filePath));
}

function toEventGroup(id) {
  const parts = id.split('/');
  return parts.length > 1 ? parts[0] : 'ungrouped';
}

function isValidPhoto(filePath) {
  return VALID_EXTS.has(path.extname(filePath).toLowerCase());
}

// ---------------------------------------------------------------------------
// Queue management — priority queue (newest addedAt processed first)
// ---------------------------------------------------------------------------

function ensureQueued(id) {
  if (state.queuedSet.has(id)) return;
  state.queuedSet.add(id);
  state.queue.push(id);
  state.metrics.queueEnqueued += 1;
}

/**
 * Drain the queue in priority order: sort by addedAt descending so newly
 * arrived photos are processed (and appear on-screen) before older ones.
 * Sorting is cheap at event scale (≤500 photos) and only runs when a worker
 * slot opens up.
 */
function runQueue() {
  if (state.activeWorkers >= MAX_CONCURRENT) return;

  // Sort pending queue: newest addedAt first so fresh photos become ready ASAP.
  if (state.queue.length > 1) {
    state.queue.sort((a, b) => {
      const pa = state.photosById.get(a);
      const pb = state.photosById.get(b);
      return (pb?.addedAt || 0) - (pa?.addedAt || 0);
    });
  }

  while (state.activeWorkers < MAX_CONCURRENT && state.queue.length) {
    const id = state.queue.shift();
    state.queuedSet.delete(id);
    state.activeWorkers += 1;
    processPhoto(id).finally(() => {
      state.activeWorkers -= 1;
      runQueue();
    });
  }
}

// ---------------------------------------------------------------------------
// Upsert / remove
// ---------------------------------------------------------------------------

async function upsertPhotoFromPath(filePath) {
  if (!isValidPhoto(filePath)) return;
  const id       = toPhotoId(filePath);
  const filename = path.basename(id);
  const existing = state.photosById.get(id);

  // Determine addedAt for new photos:
  // - For brand-new photos (not in state and no existing cache): use Date.now()
  //   so recency bias correctly reflects when they entered the system.
  // - For photos restored on startup/rescan (cache file exists): use file mtime
  //   as a reasonable approximation of original arrival order. This is imperfect
  //   (camera timestamps may be off) but prevents all photos from competing as
  //   "brand new" on every server restart.
  let addedAt = Date.now();
  if (!existing) {
    const cachePath = require('./process').toCacheFilePath(id);
    try {
      const cStat = await fsp.stat(cachePath);
      // Cache exists → this photo was processed in a previous run; use mtime
      addedAt = cStat.mtimeMs;
    } catch {
      // No cache → genuinely new photo; keep Date.now()
    }
  }

  const photo = existing || {
    id,
    relativePath: id,
    name: filename,
    eventGroup: toEventGroup(id),
    sourcePath: filePath,
    sourceUrl: `/photos-original/${id}`,
    displayUrl: '',
    addedAt,
    status: 'queued',
  };

  photo.sourcePath  = filePath;
  photo.sourceUrl   = `/photos-original/${id}`;
  photo.relativePath = id;
  photo.name        = filename;
  photo.eventGroup  = toEventGroup(id);
  state.photosById.set(id, photo);
  ensureQueued(id);
  runQueue();
}

async function removePhotoByPath(filePath) {
  const id       = toPhotoId(filePath);
  const existing = state.photosById.get(id);
  state.photosById.delete(id);
  state.queuedSet.delete(id);
  const qi = state.queue.indexOf(id);
  if (qi >= 0) state.queue.splice(qi, 1);

  if (existing?.cachePath) {
    try { await fsp.unlink(existing.cachePath); } catch {}
  }

  broadcast({ type: 'remove_photo', id, name: path.basename(id) });
}

// ---------------------------------------------------------------------------
// Full scan (on startup and rescan)
// ---------------------------------------------------------------------------

async function walkPhotoFiles(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files   = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkPhotoFiles(full));
      continue;
    }
    if (isValidPhoto(full)) files.push(full);
  }
  return files;
}

async function scanPhotos() {
  const files = await walkPhotoFiles(PHOTOS_DIR);
  const alive = new Set(files.map(toPhotoId));
  state.metrics.lastScanAt = Date.now();

  for (const file of files) {
    await upsertPhotoFromPath(file);
  }

  // Remove stale entries
  for (const [id, photo] of state.photosById.entries()) {
    if (!alive.has(id)) {
      state.photosById.delete(id);
      if (photo.cachePath) {
        try { await fsp.unlink(photo.cachePath); } catch {}
      }
    }
  }

  broadcast({ type: 'init', photos: getReadyPhotos(), config: getConfig(), heroLocks: serializeHeroLocks() });
  console.log(`Scanned ${files.length} photos`);
}

module.exports = {
  upsertPhotoFromPath,
  removePhotoByPath,
  scanPhotos,
  runQueue,
  ensureQueued,
  toPhotoId,
  toEventGroup,
  isValidPhoto,
  normalizeSlashes,
  PHOTOS_DIR,
};
