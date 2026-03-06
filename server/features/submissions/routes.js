'use strict';

const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');

const {
  SUBMISSION_ORIGINAL_DIR,
  SUBMISSION_THUMB_DIR,
} = require('./paths');
const {
  getSubmissionSettings,
  updateSubmissionSettings,
  listSubmissions,
  countPendingSubmissions,
  getSubmissionById,
  createSubmission,
  updateSubmission,
  deleteSubmission,
} = require('./store');
const { getPublicConfig } = require('../../config');
const { broadcast } = require('../ws/broadcast');
const { upsertPhotoFromPath, PHOTOS_DIR } = require('../ingest/index');

fs.mkdirSync(SUBMISSION_ORIGINAL_DIR, { recursive: true });
fs.mkdirSync(SUBMISSION_THUMB_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = /^image\//i.test(file.mimetype || '') || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.originalname || '');
    cb(null, ok);
  },
});

const _rateLimiter = new Map();
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 8;

function _checkRateLimit(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const current = _rateLimiter.get(key);
  if (!current || current.resetAt <= now) {
    _rateLimiter.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT_MAX) return false;
  current.count += 1;
  return true;
}

function _sanitizeExt(file) {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif'].includes(ext)) return ext;
  return '.jpg';
}

function _serializeSubmission(submission) {
  if (!submission) return null;
  return {
    id: submission.id,
    message: submission.message,
    submitterValue: submission.submitterValue,
    status: submission.status,
    submittedAt: submission.submittedAt,
    approvedAt: submission.approvedAt,
    rejectedAt: submission.rejectedAt,
    photoOriginalUrl: submission.photoOriginalUrl,
    photoThumbUrl: submission.photoThumbUrl,
    publishedPhotoId: submission.publishedPhotoId,
  };
}

function _serializeForScreen(submission) {
  if (!submission) return null;
  return {
    id: submission.id,
    message: submission.message,
    submitterValue: submission.submitterValue,
    submittedAt: submission.submittedAt,
    photoUrl: submission.photoOriginalUrl || null,
    photoThumbUrl: submission.photoThumbUrl || submission.photoOriginalUrl || null,
  };
}

async function _persistSubmissionPhoto(submissionId, file) {
  if (!file?.buffer) {
    return {
      photoOriginalUrl: null,
      photoThumbUrl: null,
      photoAssetPath: null,
    };
  }

  const ext = _sanitizeExt(file);
  const originalName = `${submissionId}${ext}`;
  const thumbName = `${submissionId}.jpg`;

  const originalPath = path.join(SUBMISSION_ORIGINAL_DIR, originalName);
  const thumbPath = path.join(SUBMISSION_THUMB_DIR, thumbName);

  await fsp.writeFile(originalPath, file.buffer);
  await sharp(file.buffer)
    .rotate()
    .resize(960, 960, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(thumbPath);

  return {
    photoOriginalUrl: `/submission-assets/original/${originalName}`,
    photoThumbUrl: `/submission-assets/thumb/${thumbName}`,
    photoAssetPath: originalPath,
  };
}

async function _publishSubmissionPhoto(submission) {
  if (!submission?.photoAssetPath) return null;
  const ext = path.extname(submission.photoAssetPath) || '.jpg';
  const baseName = `${submission.id}${ext}`;
  const destDir = path.join(PHOTOS_DIR, 'submissions');
  const destPath = path.join(destDir, baseName);

  await fsp.mkdir(destDir, { recursive: true });
  try {
    await fsp.access(destPath);
  } catch {
    await fsp.copyFile(submission.photoAssetPath, destPath);
  }

  await upsertPhotoFromPath(destPath);
  return `submissions/${baseName}`;
}

const publicRouter = express.Router();
const adminRouter = express.Router();

publicRouter.get('/public-config', (_req, res) => {
  const settings = getSubmissionSettings();
  res.json({
    ok: true,
    submissionEnabled: settings.submissionEnabled,
    submissionFieldLabel: settings.submissionFieldLabel,
    submissionRequirePhoto: settings.submissionRequirePhoto,
    eventName: settings.eventName,
    publicSubmitUrl: settings.publicSubmitUrl,
    theme: settings.theme,
  });
});

publicRouter.post('/', upload.single('photo'), async (req, res) => {
  const settings = getSubmissionSettings();
  if (!settings.submissionEnabled) {
    return res.status(403).json({ ok: false, error: 'Inzendingen zijn momenteel gesloten' });
  }

  if (!_checkRateLimit(req.ip)) {
    return res.status(429).json({ ok: false, error: 'Te veel inzendingen. Probeer het over een paar minuten opnieuw.' });
  }

  const message = String(req.body?.message || '').trim().slice(0, 800);
  const submitterValue = String(req.body?.submitterValue || '').trim().slice(0, 120);

  if (settings.submissionRequirePhoto && !req.file) {
    return res.status(400).json({ ok: false, error: 'Een foto is verplicht voor dit evenement' });
  }

  if (!req.file && !message) {
    return res.status(400).json({ ok: false, error: 'Voeg een foto of bericht toe' });
  }

  const submissionId = crypto.randomUUID();

  try {
    const photoMeta = await _persistSubmissionPhoto(submissionId, req.file);
    const submission = createSubmission({
      id: submissionId,
      message,
      submitterValue,
      ...photoMeta,
    });

    broadcast({ type: 'submission_pending', submission: _serializeSubmission(submission) });
    broadcast({ type: 'submissions_update', pendingCount: countPendingSubmissions() });

    res.status(201).json({ ok: true, id: submission.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

adminRouter.get('/', (req, res) => {
  const status = req.query?.status ? String(req.query.status) : null;
  const limit = Number(req.query?.limit);
  const submissions = listSubmissions({ status, limit });
  const settings = getSubmissionSettings();
  res.json({
    ok: true,
    submissions: submissions.map(_serializeSubmission),
    pendingCount: countPendingSubmissions(),
    settings,
  });
});

adminRouter.patch('/:id', async (req, res) => {
  const id = String(req.params.id || '');
  const current = getSubmissionById(id);
  if (!current) {
    return res.status(404).json({ ok: false, error: 'Submission not found' });
  }

  const patch = req.body || {};

  try {
    let updated = updateSubmission(id, patch);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Submission not found' });
    }

    const promotedNow = current.status !== 'approved' && updated.status === 'approved';
    if (promotedNow && updated.photoAssetPath && !updated.publishedPhotoId) {
      const publishedPhotoId = await _publishSubmissionPhoto(updated);
      if (publishedPhotoId) {
        updated = updateSubmission(id, { publishedPhotoId }) || updated;
      }
    }

    if (promotedNow) {
      broadcast({ type: 'submission_approved', submission: _serializeForScreen(updated) });
    }

    broadcast({ type: 'submissions_update', pendingCount: countPendingSubmissions() });

    res.json({ ok: true, submission: _serializeSubmission(updated) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

adminRouter.delete('/:id', async (req, res) => {
  const id = String(req.params.id || '');
  const removed = deleteSubmission(id);
  if (!removed) {
    return res.status(404).json({ ok: false, error: 'Submission not found' });
  }

  if (removed.photoAssetPath) {
    try { await fsp.unlink(removed.photoAssetPath); } catch {}
  }

  if (removed.photoThumbUrl) {
    const thumbName = path.basename(removed.photoThumbUrl);
    try { await fsp.unlink(path.join(SUBMISSION_THUMB_DIR, thumbName)); } catch {}
  }

  broadcast({ type: 'submissions_update', pendingCount: countPendingSubmissions() });

  res.json({ ok: true });
});

adminRouter.get('/settings', (_req, res) => {
  res.json({ ok: true, settings: getSubmissionSettings() });
});

adminRouter.post('/settings', (req, res) => {
  const settings = updateSubmissionSettings(req.body || {});
  broadcast({ type: 'config_update', config: getPublicConfig() });
  res.json({ ok: true, settings });
});

adminRouter.get('/approved', (req, res) => {
  const limit = Number(req.query?.limit || 80);
  const items = listSubmissions({ status: 'approved', limit });
  res.json({ ok: true, submissions: items.map(_serializeForScreen) });
});

module.exports = {
  publicRouter,
  adminRouter,
};
