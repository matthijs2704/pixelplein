'use strict';

const path = require('path');
const fsp  = require('fs').promises;
const state = require('../../state');
const { broadcast } = require('../ws/broadcast');
const { getReadyPhotos } = require('../photos/serialize');
const { processPhoto, readCapturedAtFromPath, toCacheFilePath, toThumbFilePath, PHOTOS_DIR } = require('./process');
const { getPublicConfig } = require('../../config');
const { serializeHeroLocks } = require('../ws/handlers');
const { upsertPhotoMetadata, deletePhotoMetadata } = require('../../db');

const VALID_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);
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

function isIgnoredPhotoPath(filePath) {
  const relativePath = path.relative(PHOTOS_DIR, filePath);
  if (!relativePath || relativePath.startsWith('..')) return false;

  return normalizeSlashes(relativePath)
    .split('/')
    .some(part => part.startsWith('.'));
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
  if (isIgnoredPhotoPath(filePath) || !isValidPhoto(filePath)) return;
  const id       = toPhotoId(filePath);
  const filename = path.basename(id);
  const existing = state.photosById.get(id);

  // Fast-path: photo was already processed and its cache is at least as new as
  // the source file → nothing to do.  Only update the live mutable fields.
  if (existing?.status === 'ready' && existing.cachePath) {
    try {
      const [srcStat, cacheStat] = await Promise.all([
        fsp.stat(filePath),
        fsp.stat(existing.cachePath),
      ]);
      if (srcStat.mtimeMs <= cacheStat.mtimeMs) {
        // Source unchanged — keep existing state, skip reprocessing
        existing.sourcePath  = filePath;
        existing.sourceUrl   = `/photos-original/${id}`;
        if (existing.capturedAt == null) {
          existing.capturedAt = await readCapturedAtFromPath(filePath);
          upsertPhotoMetadata(existing).catch(err => {
            console.warn(`[ingest] failed to persist capturedAt for ${id}: ${err.message}`);
          });
        }
        return;
      }
    } catch {
      // One of the files is missing — fall through to reprocess
    }
  }

  // Determine addedAt for photos not yet in state:
  // - Brand-new (no cache): Date.now() so recency bias reflects true arrival.
  // - Restored from disk after cache wipe: use cache mtime to preserve order.
  let addedAt = existing?.addedAt || Date.now();
  if (!existing) {
    const cachePath = toCacheFilePath(id);
    try {
      const cStat = await fsp.stat(cachePath);
      addedAt = cStat.mtimeMs;
    } catch {
      // No cache file → genuinely new
    }
  }

  const derivedGroup = toEventGroup(id);
  const photo = existing || {
    id,
    relativePath: id,
    name:         filename,
    eventGroup:   derivedGroup,
    sourcePath:   filePath,
    sourceUrl:    `/photos-original/${id}`,
    displayUrl:   '',
    addedAt,
    capturedAt:   existing?.capturedAt ?? null,
    processedAt:  null,
    status:       'queued',
  };

  photo.sourcePath   = filePath;
  photo.sourceUrl    = `/photos-original/${id}`;
  photo.relativePath = id;
  photo.name         = filename;
  if (!existing) photo.eventGroup = derivedGroup;
  state.photosById.set(id, photo);
  upsertPhotoMetadata(photo).catch(err => {
    console.warn(`[ingest] failed to persist metadata for ${id}: ${err.message}`);
  });
  ensureQueued(id);
  runQueue();
}

async function removePhotoByPath(filePath) {
  if (isIgnoredPhotoPath(filePath)) return;
  const id       = toPhotoId(filePath);
  const existing = state.photosById.get(id);
  state.photosById.delete(id);
  state.queuedSet.delete(id);
  const qi = state.queue.indexOf(id);
  if (qi >= 0) state.queue.splice(qi, 1);

  if (existing?.cachePath) {
    try { await fsp.unlink(existing.cachePath); } catch {}
  }

  const thumbPath = existing?.thumbPath || toThumbFilePath(id);
  try { await fsp.unlink(thumbPath); } catch {}

  deletePhotoMetadata(id).catch(err => {
    console.warn(`[ingest] failed to delete metadata for ${id}: ${err.message}`);
  });

  broadcast({ type: 'remove_photo', id, name: path.basename(id) });
}

// ---------------------------------------------------------------------------
// Full scan (on startup and rescan)
// ---------------------------------------------------------------------------

async function walkPhotoFiles(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files   = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkPhotoFiles(full));
      continue;
    }
    if (isValidPhoto(full)) files.push(full);
  }
  return files;
}

async function scanPhotos(isInitialScan = false) {
  const files = await walkPhotoFiles(PHOTOS_DIR);
  const alive = new Set(files.map(toPhotoId));
  state.metrics.lastScanAt = Date.now();

  for (const file of files) {
    await upsertPhotoFromPath(file);
  }

  // Remove stale entries and broadcast individual removals
  for (const [id, photo] of state.photosById.entries()) {
    if (!alive.has(id)) {
      state.photosById.delete(id);
      if (photo.cachePath) {
        try { await fsp.unlink(photo.cachePath); } catch {}
      }
      const thumbPath = photo.thumbPath || toThumbFilePath(id);
      try { await fsp.unlink(thumbPath); } catch {}
      deletePhotoMetadata(id).catch(err => {
        console.warn(`[ingest] failed to delete stale metadata for ${id}: ${err.message}`);
      });
      broadcast({ type: 'remove_photo', id, name: photo.name });
    }
  }

  // On initial startup no clients are connected yet — send init so the first
  // connecting screen gets the full state. On rescans (watcher recovery), skip
  // the full init to avoid resetting live screens; individual new_photo /
  // remove_photo messages already keep clients up to date.
  if (isInitialScan) {
    broadcast({
      type: 'init',
      config: getPublicConfig(),
      heroLocks: serializeHeroLocks(),
      totalPhotos: getReadyPhotos().length,
    });
  }

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
  isIgnoredPhotoPath,
  PHOTOS_DIR,
};
