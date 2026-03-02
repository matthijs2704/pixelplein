'use strict';

const path = require('path');
const fsp = require('fs').promises;
const sharp = require('sharp');
const state = require('../../state');
const { getConfig } = require('../../config');
const { broadcast } = require('../ws/broadcast');
const { serializePhoto } = require('../photos/serialize');
const { upsertPhotoMetadata } = require('../../db');

const PHOTOS_DIR = path.join(__dirname, '..', '..', '..', 'photos');
const CACHE_DIR  = path.join(__dirname, '..', '..', '..', 'cache', 'display');
const THUMB_DIR  = path.join(__dirname, '..', '..', '..', 'cache', 'thumb');

// Resolution is configurable via environment variables so 4K screens can get
// a higher-quality cache without modifying code.
// Defaults to 1920×1080 @ quality 84, which is fine for 1080p and scales down
// gracefully on 4K (CSS object-fit handles the upscaling).
// Set DISPLAY_WIDTH=3840 DISPLAY_HEIGHT=2160 for native 4K caches.
const DISPLAY_SETTINGS = {
  quality: parseInt(process.env.DISPLAY_QUALITY || '84', 10),
};

const THUMB_SETTINGS = {
  quality: parseInt(process.env.THUMB_QUALITY || '75', 10),
};

function _getDisplaySize() {
  const cfg = getConfig();
  return {
    width: Number(cfg.displayWidth ?? process.env.DISPLAY_WIDTH ?? 1920) || 1920,
    height: Number(cfg.displayHeight ?? process.env.DISPLAY_HEIGHT ?? 1080) || 1080,
  };
}

function _getThumbSize() {
  const display = _getDisplaySize();
  const envW = Number(process.env.THUMB_W);
  const envH = Number(process.env.THUMB_H);
  return {
    width: Number.isFinite(envW) ? Math.max(120, Math.floor(envW)) : Math.max(120, Math.ceil(display.width / 2)),
    height: Number.isFinite(envH) ? Math.max(120, Math.floor(envH)) : Math.max(120, Math.ceil(display.height / 2)),
  };
}

function toCacheFilePath(id) {
  const ext = path.extname(id);
  const noExt = ext ? id.slice(0, -ext.length) : id;
  return path.join(CACHE_DIR, `${noExt}.jpg`);
}

function toCacheUrl(id, version) {
  const ext = path.extname(id);
  const noExt = ext ? id.slice(0, -ext.length) : id;
  return `/photos/${noExt}.jpg?v=${version}`;
}

function toThumbFilePath(id) {
  const ext = path.extname(id);
  const noExt = ext ? id.slice(0, -ext.length) : id;
  return path.join(THUMB_DIR, `${noExt}.jpg`);
}

function toThumbUrl(id, version) {
  const ext = path.extname(id);
  const noExt = ext ? id.slice(0, -ext.length) : id;
  return `/thumbs/${noExt}.jpg?v=${version}`;
}

async function processPhoto(id) {
  const photo = state.photosById.get(id);
  if (!photo) return;

  photo.status = 'processing';
  photo.error  = null;

  try {
    const meta      = await sharp(photo.sourcePath).metadata();
    const cachePath = toCacheFilePath(id);
    const thumbPath = toThumbFilePath(id);
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.mkdir(path.dirname(thumbPath), { recursive: true });

    const displaySize = _getDisplaySize();
    const thumbSize   = _getThumbSize();

    await sharp(photo.sourcePath)
      .rotate()
      .resize(displaySize.width, displaySize.height, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: DISPLAY_SETTINGS.quality, mozjpeg: true })
      .toFile(cachePath);

    await sharp(photo.sourcePath)
      .rotate()
      .resize(thumbSize.width, thumbSize.height, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: THUMB_SETTINGS.quality, mozjpeg: true })
      .toFile(thumbPath);

    const cacheMeta = await sharp(cachePath).metadata();

    photo.status        = 'ready';
    // addedAt is set at upsert time (server arrival) and intentionally NOT
    // overwritten here so recency bias reflects when photos entered the system.
    photo.width         = meta.width  || null;
    photo.height        = meta.height || null;
    photo.displayWidth  = cacheMeta.width  || null;
    photo.displayHeight = cacheMeta.height || null;
    photo.cachePath     = cachePath;
    photo.thumbPath     = thumbPath;
    photo.processedAt   = Date.now();
    const version       = Math.floor(photo.processedAt);
    photo.displayUrl    = toCacheUrl(id, version);
    photo.thumbUrl      = toThumbUrl(id, version);
    photo.error         = null;

    state.metrics.queueCompleted  += 1;
    state.metrics.cacheReadyCount += 1;  // incremental — avoids O(n) scan per photo
    state.metrics.lastIngestAt    = Date.now();

    upsertPhotoMetadata(photo).catch(err => {
      console.warn(`[process] failed to persist metadata for ${id}: ${err.message}`);
    });

    broadcast({ type: 'new_photo', photo: serializePhoto(photo) });
  } catch (err) {
    photo.status = 'failed';
    photo.error  = err.message;
    state.metrics.queueFailed += 1;
    upsertPhotoMetadata(photo).catch(dbErr => {
      console.warn(`[process] failed to persist failed metadata for ${id}: ${dbErr.message}`);
    });
    console.warn(`Cache generation failed for ${id}: ${err.message}`);
  }
}

module.exports = {
  processPhoto,
  toCacheFilePath,
  toThumbFilePath,
  PHOTOS_DIR,
  CACHE_DIR,
  THUMB_DIR,
};
