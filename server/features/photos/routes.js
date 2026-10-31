'use strict';

const { execFile } = require('child_process');
const crypto       = require('crypto');
const fs           = require('fs');
const fsp          = require('fs').promises;
const path         = require('path');
const { promisify }  = require('util');

const express = require('express');
const multer  = require('multer');
const sharp   = require('sharp');

const state   = require('../../state');
const { getConfig, getPublicConfig, saveConfig } = require('../../config');
const { broadcast }  = require('../ws/broadcast');
const { serializePhoto, getAllPhotos } = require('./serialize');
const { upsertPhotoFromPath, PHOTOS_DIR } = require('../ingest/index');
const { toCacheFilePath, toThumbFilePath } = require('../ingest/process');
const db = require('../../db');
const { setHeroCandidate, deletePhotoMetadata, upsertPhotoMetadata, clearAllPhotoMetadata, run: dbRun } = db;
const { clearModulePhotoData } = require('../../modules/loader');

const router = express.Router();
const UPLOAD_TMP_DIR = path.join(__dirname, '..', '..', '..', 'cache', 'upload-tmp');
const execFileAsync = promisify(execFile);

fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

// Multer writes to a temp directory first so large multi-file uploads do not
// buffer the full request in RAM before we can persist anything.
const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, UPLOAD_TMP_DIR);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per file
  fileFilter(_req, file, cb) {
    const valid = /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.originalname);
    cb(null, valid);
  },
});

// Validate a group name: alphanumeric, hyphens, underscores, max 50 chars
function isValidGroupName(name) {
  return /^[a-zA-Z0-9_-]{1,50}$/.test(name);
}

function sanitizeUploadFilename(name) {
  const safeName = path.basename(name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
  return safeName || `upload-${Date.now()}.jpg`;
}

function isHeicUpload(name) {
  return /\.(heic|heif)$/i.test(name || '');
}

function toJpegUploadFilename(name) {
  const safeName = sanitizeUploadFilename(name);
  const ext      = path.extname(safeName);
  const base     = ext ? safeName.slice(0, -ext.length) : safeName;
  return `${base || `upload-${Date.now()}`}.jpg`;
}

async function uniqueUploadPath(destDir, safeName) {
  const ext  = path.extname(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;

  for (let i = 0; i < 1000; i++) {
    const name = i === 0 ? safeName : `${base}-${i}${ext}`;
    const candidate = path.join(destDir, name);
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
  }

  return path.join(destDir, `${base}-${Date.now()}${ext}`);
}

async function cleanupTempFiles(files) {
  await Promise.all((files || []).map(async file => {
    if (!file?.path) return;
    try { await fsp.unlink(file.path); } catch {}
  }));
}

async function moveUploadedFile(srcPath, destPath) {
  try {
    await fsp.rename(srcPath, destPath);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(srcPath, destPath);
    try { await fsp.unlink(srcPath); } catch {}
  }
}

async function convertUploadedHeicToJpeg(srcPath, destPath) {
  const errors = [];

  try {
    await sharp(srcPath)
      .rotate()
      .jpeg({ quality: 92, mozjpeg: true })
      .toFile(destPath);
    try { await fsp.unlink(srcPath); } catch {}
    return;
  } catch (err) {
    errors.push(`sharp: ${err.message}`);
    try { await fsp.unlink(destPath); } catch {}
  }

  try {
    await execFileAsync('heif-convert', [srcPath, destPath], { timeout: 60_000 });
    try { await fsp.unlink(srcPath); } catch {}
    return;
  } catch (err) {
    errors.push(`heif-convert: ${err.message}`);
    try { await fsp.unlink(destPath); } catch {}
  }

  try {
    await execFileAsync('magick', [srcPath, destPath], { timeout: 60_000 });
    try { await fsp.unlink(srcPath); } catch {}
    return;
  } catch (err) {
    errors.push(`magick: ${err.message}`);
    try { await fsp.unlink(destPath); } catch {}
  }

  throw new Error(`Could not convert HEIC upload to JPG (${errors.join('; ')})`);
}

function handleUploadMiddleware(req, res, next) {
  upload.array('files', 200)(req, res, async err => {
    if (!err) return next();
    await cleanupTempFiles(req.files);
    const status = err instanceof multer.MulterError ? 400 : 500;
    return res.status(status).json({ ok: false, error: err.message });
  });
}

async function _deletePhotoFiles(photo) {
  const deleteFile = async filePath => {
    try { await fsp.unlink(filePath); } catch {}
  };

  await deleteFile(photo.sourcePath);

  const cachePath = photo.cachePath || toCacheFilePath(photo.id);
  const thumbPath = photo.thumbPath || toThumbFilePath(photo.id);
  await deleteFile(cachePath);
  await deleteFile(thumbPath);
}

async function _deletePhotoRecord(photo) {
  const id = photo.id;

  state.photosById.delete(id);
  state.queuedSet.delete(id);
  const qi = state.queue.indexOf(id);
  if (qi >= 0) state.queue.splice(qi, 1);
  state.photoOverrides.delete(id);

  broadcast({ type: 'remove_photo', id, name: photo.name });

  await _deletePhotoFiles(photo);

  deletePhotoMetadata(id).catch(err => {
    console.warn(`[photos] failed to delete metadata for ${id}: ${err.message}`);
  });
}

function _cleanupGroupConfig(group) {
  const config = getConfig();
  let changed  = false;

  for (const screenCfg of Object.values(config.screens || {})) {
    if (!screenCfg || typeof screenCfg !== 'object') continue;

    const hiddenGroups = Array.isArray(screenCfg.hiddenGroups) ? screenCfg.hiddenGroups : [];
    const nextHidden   = hiddenGroups.filter(name => name !== group);
    if (nextHidden.length !== hiddenGroups.length) {
      screenCfg.hiddenGroups = nextHidden;
      changed = true;
    }

    if (screenCfg.activeGroup === group) {
      screenCfg.activeGroup = 'ungrouped';
      if (screenCfg.groupMode === 'manual') screenCfg.groupMode = 'auto';
      changed = true;
    }
  }

  if (changed) {
    saveConfig();
    broadcast({ type: 'config_update', config: getPublicConfig() });
  }

  return changed;
}

// ---------------------------------------------------------------------------
// GET /api/photos — all photos (newest first)
// Query params (all optional):
//   status=ready|queued|processing|failed  — filter by status
//   limit=N                                — return at most N results
//   random=1                               — shuffle before slicing
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  let photos = getAllPhotos();

  const { status, limit, random } = req.query;

  if (status) {
    photos = photos.filter(p => p.status === status);
  }

  if (random === '1' || random === 'true') {
    for (let i = photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [photos[i], photos[j]] = [photos[j], photos[i]];
    }
  }

  const limitN = Number(limit);
  if (Number.isInteger(limitN) && limitN > 0) {
    photos = photos.slice(0, limitN);
  }

  res.json(photos);
});

// ---------------------------------------------------------------------------
// POST /api/photos/upload — multipart upload with optional group
// ---------------------------------------------------------------------------
router.post('/upload', handleUploadMiddleware, async (req, res) => {
  const rawGroup = (req.body.group || '').trim();
  const group    = rawGroup && rawGroup !== 'ungrouped' ? rawGroup : null;
  const files    = Array.isArray(req.files) ? req.files : [];

  if (group && !isValidGroupName(group)) {
    await cleanupTempFiles(files);
    return res.status(400).json({ ok: false, error: 'Invalid group name. Use letters, numbers, hyphens or underscores (max 50 chars).' });
  }

  if (files.length === 0) {
    return res.status(400).json({ ok: false, error: 'No files received.' });
  }

  const destDir = group ? path.join(PHOTOS_DIR, group) : PHOTOS_DIR;
  await Promise.all([
    fsp.mkdir(UPLOAD_TMP_DIR, { recursive: true }),
    fsp.mkdir(destDir, { recursive: true }),
  ]);

  const uploaded = [];
  const errors   = [];

  for (const file of files) {
    const convertHeic = isHeicUpload(file.originalname);
    const safeName = convertHeic
      ? toJpegUploadFilename(file.originalname)
      : sanitizeUploadFilename(file.originalname);
    const destPath = await uniqueUploadPath(destDir, safeName);
    const finalName = path.basename(destPath);

    try {
      if (convertHeic) await convertUploadedHeicToJpeg(file.path, destPath);
      else             await moveUploadedFile(file.path, destPath);

      // chokidar will pick this up; also kick off processing immediately.
      // If the enqueue step fails, the file is still on disk and the watcher
      // can recover it, so keep the upload itself successful.
      await upsertPhotoFromPath(destPath).catch(err => {
        console.warn(`[photos] failed to enqueue ${finalName}: ${err.message}`);
      });
      uploaded.push({ name: finalName, group: group || 'ungrouped' });
    } catch (err) {
      try { await fsp.unlink(file.path); } catch {}
      try { await fsp.unlink(destPath); } catch {}
      errors.push({ name: safeName, error: err.message });
    }
  }

  res.json({ ok: true, uploaded, errors });
});

// ---------------------------------------------------------------------------
// DELETE /api/photos/group/:group — permanently delete all photos in a group
// ---------------------------------------------------------------------------
router.delete('/group/:group', async (req, res) => {
  const group = String(req.params.group || '').trim();
  if (!group || !isValidGroupName(group)) {
    return res.status(400).json({ ok: false, error: 'Invalid group name.' });
  }

  const photos = Array.from(state.photosById.values())
    .filter(photo => (photo.eventGroup || 'ungrouped') === group);

  if (!photos.length) {
    return res.status(404).json({ ok: false, error: 'Group not found' });
  }

  for (const photo of photos) {
    await _deletePhotoRecord(photo);
  }

  if (group !== 'ungrouped') {
    try { await fsp.rm(path.join(PHOTOS_DIR, group), { recursive: true, force: true }); } catch {}
  }

  const configUpdated = _cleanupGroupConfig(group);
  res.json({ ok: true, deleted: photos.length, group, configUpdated });
});

// ---------------------------------------------------------------------------
// DELETE /api/photos/all — wipe the ENTIRE photo database: files, caches,
// metadata, tags (all namespaces) and photo-linked module data.
// Guarded by an explicit confirm phrase from the admin UI.
// ---------------------------------------------------------------------------
router.delete('/all', async (req, res) => {
  if (req.body?.confirm !== 'ALLES WISSEN') {
    return res.status(400).json({ ok: false, error: 'Bevestiging ontbreekt' });
  }

  const photos = Array.from(state.photosById.values());
  for (const photo of photos) {
    await _deletePhotoRecord(photo);
  }

  // Leftover group directories in photos/
  try {
    for (const entry of await fsp.readdir(PHOTOS_DIR, { withFileTypes: true })) {
      await fsp.rm(path.join(PHOTOS_DIR, entry.name), { recursive: true, force: true }).catch(() => {});
    }
  } catch {}

  // All photo-linked rows: metadata (safety net), tags in every namespace,
  // and whatever photo data loaded modules keep.
  await clearAllPhotoMetadata().catch(() => {});
  await dbRun('DELETE FROM photo_tags').catch(() => {});
  await clearModulePhotoData(db);

  res.json({ ok: true, deleted: photos.length });
});

// ---------------------------------------------------------------------------
// PATCH /api/photos/:id — set heroCandidate flag
// id is URL-encoded, e.g. "ceremony%2Fimg001.jpg"
// ---------------------------------------------------------------------------
router.patch('/:id(*)', async (req, res) => {
  const id = req.params.id;
  if (!state.photosById.has(id)) {
    return res.status(404).json({ ok: false, error: 'Photo not found' });
  }

  const { heroCandidate, eventGroup } = req.body;
  const photo = state.photosById.get(id);

  if (typeof heroCandidate === 'boolean') {
    const existing = state.photoOverrides.get(id) || {};
    state.photoOverrides.set(id, { ...existing, heroCandidate });
    setHeroCandidate(id, heroCandidate).catch(err => {
      console.warn(`[photos] failed to persist heroCandidate for ${id}: ${err.message}`);
    });
  }

  if (typeof eventGroup === 'string' || eventGroup === null) {
    // null or empty string → reset to ungrouped
    photo.eventGroup = eventGroup || null;
  }

  try {
    await upsertPhotoMetadata(photo);
  } catch (err) {
    console.warn(`[photos] failed to persist metadata for ${id}: ${err.message}`);
    return res.status(500).json({ ok: false, error: 'Failed to persist photo metadata' });
  }
  broadcast({ type: 'photo_update', photo: serializePhoto(photo) });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DELETE /api/photos/:id — permanently delete source + cache
// ---------------------------------------------------------------------------
router.delete('/:id(*)', async (req, res) => {
  const id    = req.params.id;
  const photo = state.photosById.get(id);

  if (!photo) {
    return res.status(404).json({ ok: false, error: 'Photo not found' });
  }

  await _deletePhotoRecord(photo);

  res.json({ ok: true });
});

module.exports = router;
