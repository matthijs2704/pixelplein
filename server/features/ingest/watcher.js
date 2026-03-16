'use strict';

const path     = require('path');
const fs       = require('fs');
const chokidar = require('chokidar');
const { upsertPhotoFromPath, removePhotoByPath, scanPhotos, PHOTOS_DIR } = require('./index');
const { createSlide, getSlides, updateSlide } = require('../slides/store');
const { broadcast }                           = require('../ws/broadcast');
const { needsTranscode, transcodeToMp4 }      = require('./transcode');

const VIDEOS_DIR = path.join(__dirname, '..', '..', '..', 'slide-assets', 'videos');

let rescanTimer = null;

function scheduleRescan() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(() => {
    scanPhotos().catch(err => console.warn('Rescan failed:', err.message));
  }, 1200);
}

function startWatcher() {
  // ── Photos watcher ────────────────────────────────────────────────────────
  const watcher = chokidar.watch(PHOTOS_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher.on('add', filePath => {
    upsertPhotoFromPath(filePath).catch(err => {
      console.warn('Add handling failed:', err.message);
      scheduleRescan();
    });
  });

  watcher.on('change', filePath => {
    upsertPhotoFromPath(filePath).catch(err => {
      console.warn('Change handling failed:', err.message);
      scheduleRescan();
    });
  });

  watcher.on('unlink', filePath => {
    removePhotoByPath(filePath).catch(err => {
      console.warn('Unlink handling failed:', err.message);
      scheduleRescan();
    });
  });

  watcher.on('error', err => {
    console.warn('Watcher error:', err.message);
    scheduleRescan();
  });

  // ── Videos watcher ────────────────────────────────────────────────────────
  // .mov and .m4v are not natively supported by Chromium on Linux — they are
  // transcoded to .mp4 (H.264/AAC) automatically when detected.  The slide is
  // registered against the resulting .mp4, not the original source file.
  const VIDEO_EXTS = /\.(mp4|webm|mov|m4v)$/i;

  // Track files currently being transcoded so duplicate chokidar 'add' events
  // (which can occur during slow copies) don't spawn multiple ffmpeg processes.
  const _transcoding = new Set();

  const videoWatcher = chokidar.watch(VIDEOS_DIR, {
    ignoreInitial: false, // pick up files already present on startup
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
  });

  videoWatcher.on('add', filePath => {
    if (!VIDEO_EXTS.test(filePath)) return;

    if (needsTranscode(filePath)) {
      const mp4Path = filePath.replace(/\.(mov|m4v)$/i, '.mp4');
      // Skip if already transcoded or a transcode is already running for this file
      if (fs.existsSync(mp4Path) || _transcoding.has(filePath)) return;
      _transcoding.add(filePath);
      transcodeToMp4(filePath)
        .catch(err => {
          console.warn(`[videos] Transcode failed for ${path.basename(filePath)}:`, err.message);
        })
        .finally(() => {
          _transcoding.delete(filePath);
        });
      // Do NOT register a slide here — the .mp4 appearing will trigger another
      // 'add' event which registers the slide normally below.
      return;
    }

    const filename = path.basename(filePath);
    const existing = getSlides().find(s => s.type === 'video' && s.filename === filename);
    if (existing) return; // already registered
    const slide = createSlide('video', { label: filename, filename, enabled: false });
    broadcast({ type: 'slides_update', slides: require('../slides/store').getSlides() });
    console.log(`[videos] Auto-registered new video: ${filename} (id: ${slide.id}, enabled: false)`);
  });

  videoWatcher.on('unlink', filePath => {
    if (!VIDEO_EXTS.test(filePath)) return;
    const filename = path.basename(filePath);

    // When the source .mov/.m4v is removed, also remove the transcoded .mp4
    if (needsTranscode(filePath)) {
      const mp4Path = filePath.replace(/\.(mov|m4v)$/i, '.mp4');
      fs.unlink(mp4Path, () => {}); // best-effort
      const mp4Name = path.basename(mp4Path);
      const mp4Slide = getSlides().find(s => s.type === 'video' && s.filename === mp4Name);
      if (mp4Slide) {
        updateSlide(mp4Slide.id, { enabled: false, _missing: true });
        broadcast({ type: 'slides_update', slides: require('../slides/store').getSlides() });
        console.log(`[videos] Source removed, transcoded video marked missing: ${mp4Name}`);
      }
      return;
    }

    const slide = getSlides().find(s => s.type === 'video' && s.filename === filename);
    if (!slide) return;
    // Mark as missing rather than deleting from library — operator may want to re-upload
    updateSlide(slide.id, { enabled: false, _missing: true });
    broadcast({ type: 'slides_update', slides: require('../slides/store').getSlides() });
    console.log(`[videos] Video file removed: ${filename}`);
  });

  return watcher;
}

module.exports = { startWatcher, scheduleRescan };
