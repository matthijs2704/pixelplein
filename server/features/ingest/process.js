'use strict';

const path = require('path');
const fsp = require('fs').promises;
const sharp = require('sharp');
const state = require('../../state');
const { getConfig } = require('../../config');
const { broadcast } = require('../ws/broadcast');
const { serializePhoto } = require('../photos/serialize');

const PHOTOS_DIR = path.join(__dirname, '..', '..', '..', 'photos');
const CACHE_DIR  = path.join(__dirname, '..', '..', '..', 'cache', 'display');

// Resolution is configurable via environment variables so 4K screens can get
// a higher-quality cache without modifying code.
// Defaults to 1920×1080 @ quality 84, which is fine for 1080p and scales down
// gracefully on 4K (CSS object-fit handles the upscaling).
// Set DISPLAY_WIDTH=3840 DISPLAY_HEIGHT=2160 for native 4K caches.
const DISPLAY_SIZE = {
  quality: parseInt(process.env.DISPLAY_QUALITY || '84', 10),
};

function _getDisplaySize() {
  const cfg = getConfig();
  return {
    width: Number(cfg.displayWidth ?? process.env.DISPLAY_WIDTH ?? 1920) || 1920,
    height: Number(cfg.displayHeight ?? process.env.DISPLAY_HEIGHT ?? 1080) || 1080,
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

async function processPhoto(id) {
  const photo = state.photosById.get(id);
  if (!photo) return;

  photo.status = 'processing';
  photo.error  = null;

  try {
    const meta      = await sharp(photo.sourcePath).metadata();
    const cachePath = toCacheFilePath(id);
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });

    const size = _getDisplaySize();

    await sharp(photo.sourcePath)
      .rotate()
      .resize(size.width, size.height, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: DISPLAY_SIZE.quality, mozjpeg: true })
      .toFile(cachePath);

    const cacheMeta = await sharp(cachePath).metadata();

    photo.status        = 'ready';
    // addedAt is set at upsert time (server arrival) and intentionally NOT
    // overwritten here so recency bias reflects when photos entered the system.
    photo.width         = meta.width  || null;
    photo.height        = meta.height || null;
    photo.displayWidth  = cacheMeta.width  || null;
    photo.displayHeight = cacheMeta.height || null;
    photo.cachePath     = cachePath;
    photo.displayUrl    = toCacheUrl(id, Math.floor(photo.addedAt));
    photo.error         = null;

    state.metrics.queueCompleted  += 1;
    state.metrics.cacheReadyCount += 1;  // incremental — avoids O(n) scan per photo
    state.metrics.lastIngestAt    = Date.now();

    broadcast({ type: 'new_photo', photo: serializePhoto(photo) });
  } catch (err) {
    photo.status = 'failed';
    photo.error  = err.message;
    state.metrics.queueFailed += 1;
    console.warn(`Cache generation failed for ${id}: ${err.message}`);
  }
}

module.exports = { processPhoto, toCacheFilePath, PHOTOS_DIR, CACHE_DIR };
