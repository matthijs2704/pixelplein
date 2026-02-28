'use strict';

// ---------------------------------------------------------------------------
// Slides & playlists REST API
//
// GET    /api/slides              → all slides
// POST   /api/slides              → create slide (body: { type, ...fields })
// PATCH  /api/slides/:id          → update slide fields
// DELETE /api/slides/:id          → delete slide (also removes video file if any)
// POST   /api/slides/upload-video → multer: upload video file to slide-assets/videos/
//
// GET    /api/playlists           → all playlists
// POST   /api/playlists           → create playlist
// PATCH  /api/playlists/:id       → update playlist (name, slideIds, interleaveEvery…)
// DELETE /api/playlists/:id       → delete playlist
//
// POST   /api/slides/play-soon/:id → set playSoon flag + broadcast
//
// GET    /api/slides/qr?url=…    → returns (or generates) a QR PNG
// ---------------------------------------------------------------------------

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const fsp     = require('fs').promises;
const multer  = require('multer');
const QRCode  = require('qrcode');
const crypto  = require('crypto');

const router = express.Router();

const {
  getSlides, getSlideById, createSlide, updateSlide, deleteSlide,
  getPlaylists, getPlaylistById, createPlaylist, updatePlaylist, deletePlaylist,
} = require('./store');

const { broadcast } = require('../ws/broadcast');

const SLIDE_ASSETS_DIR = path.join(__dirname, '..', '..', '..', 'slide-assets');
const VIDEOS_DIR       = path.join(SLIDE_ASSETS_DIR, 'videos');
const IMAGES_DIR       = path.join(SLIDE_ASSETS_DIR, 'images');
const QR_CACHE_DIR     = path.join(__dirname, '..', '..', '..', 'cache', 'qr');

// Ensure directories exist
fs.mkdirSync(VIDEOS_DIR,   { recursive: true });
fs.mkdirSync(IMAGES_DIR,   { recursive: true });
fs.mkdirSync(QR_CACHE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Multer for video uploads
// ---------------------------------------------------------------------------

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIDEOS_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (_req, file, cb) => {
    const ok = /\.(mp4|webm|mov)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only mp4/webm/mov allowed'), ok);
  },
});

// ---------------------------------------------------------------------------
// Multer for image uploads
// ---------------------------------------------------------------------------

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, IMAGES_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ok = /\.(jpe?g|png|gif|webp|avif)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only jpg/png/gif/webp/avif allowed'), ok);
  },
});

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

function broadcastSlides() {
  broadcast({ type: 'slides_update', slides: getSlides() });
}

function broadcastPlaylists() {
  broadcast({ type: 'playlists_update', playlists: getPlaylists() });
}

// ---------------------------------------------------------------------------
// QR generation
// ---------------------------------------------------------------------------

async function ensureQr(url) {
  const hash     = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  const filePath = path.join(QR_CACHE_DIR, `${hash}.png`);
  const exists   = await fsp.access(filePath).then(() => true).catch(() => false);
  if (!exists) {
    await QRCode.toFile(filePath, url, { width: 300, margin: 2, type: 'png' });
  }
  return `/cache/qr/${hash}.png`;
}

// ---------------------------------------------------------------------------
// Slide routes
// ---------------------------------------------------------------------------

router.get('/', (_req, res) => {
  res.json(getSlides());
});

router.post('/', (req, res) => {
  const { type, ...rest } = req.body || {};
  if (!['video', 'text-card', 'qr', 'webpage', 'image', 'article'].includes(type)) {
    return res.status(400).json({ error: 'Invalid slide type' });
  }
  const slide = createSlide(type, rest);
  broadcastSlides();
  res.status(201).json(slide);
});

router.post('/upload-video', videoUpload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filename = req.file.filename;
  // Auto-create a slide entry (disabled by default until operator enables it)
  const slide = createSlide('video', {
    label: filename,
    filename,
    enabled: false,
  });
  broadcastSlides();
  res.status(201).json(slide);
});

router.post('/upload-image', imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filename = req.file.filename;
  const slide = createSlide('image', {
    label: filename,
    filename,
    enabled: true,
  });
  broadcastSlides();
  res.status(201).json(slide);
});

// Upload an image for an article slide (same storage, no auto-slide creation)
router.post('/upload-article-image', imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename });
});

router.post('/play-soon/:id', (req, res) => {
  const slide = getSlideById(req.params.id);
  if (!slide) return res.status(404).json({ error: 'Not found' });
  updateSlide(req.params.id, { playSoon: true });
  broadcast({ type: 'play_soon', slideId: req.params.id });
  broadcastSlides();
  res.json({ ok: true });
});

// QR PNG endpoint: GET /api/slides/qr?url=https://...
router.get('/qr', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url param required' });
  try {
    const imgPath = await ensureQr(url);
    res.json({ url: imgPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  const updated = updateSlide(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Not found' });
  // If playSoon was just cleared, no extra broadcast needed (handled by client)
  broadcastSlides();
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const slide = getSlideById(req.params.id);
  if (!slide) return res.status(404).json({ error: 'Not found' });

  // Delete asset file if applicable (best-effort — ignore missing files)
  if (slide.filename) {
    const dir = slide.type === 'image' ? IMAGES_DIR : VIDEOS_DIR;
    try { await fsp.unlink(path.join(dir, slide.filename)); } catch {}
  }
  // Article slides store their image separately
  if (slide.type === 'article' && slide.imageFilename) {
    try { await fsp.unlink(path.join(IMAGES_DIR, slide.imageFilename)); } catch {}
  }

  deleteSlide(req.params.id);
  broadcastSlides();
  broadcastPlaylists(); // playlists were updated too
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Playlist routes  — mounted at /api/playlists (see index.js)
// ---------------------------------------------------------------------------

const playlistRouter = express.Router();

playlistRouter.get('/', (_req, res) => {
  res.json(getPlaylists());
});

playlistRouter.post('/', (req, res) => {
  const pl = createPlaylist(req.body || {});
  broadcastPlaylists();
  res.status(201).json(pl);
});

playlistRouter.patch('/:id', (req, res) => {
  const updated = updatePlaylist(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcastPlaylists();
  res.json(updated);
});

playlistRouter.delete('/:id', (req, res) => {
  const ok = deletePlaylist(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  broadcastPlaylists();
  res.json({ ok: true });
});

module.exports = { slidesRouter: router, playlistRouter, ensureQr };
