'use strict';

const path    = require('path');
const chokidar = require('chokidar');
const { upsertPhotoFromPath, removePhotoByPath, scanPhotos, PHOTOS_DIR } = require('./index');
const { createSlide, getSlides, updateSlide } = require('../slides/store');
const { broadcast } = require('../ws/broadcast');

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
  const VIDEO_EXTS = /\.(mp4|webm|mov)$/i;

  const videoWatcher = chokidar.watch(VIDEOS_DIR, {
    ignoreInitial: false, // pick up files already present on startup
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
  });

  videoWatcher.on('add', filePath => {
    if (!VIDEO_EXTS.test(filePath)) return;
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
