'use strict';

const crypto = require('crypto');

const { getConfig, saveConfig, sanitizeGlobalConfig } = require('../../config');
const { getSettingJson, setSettingJson } = require('../../db');

let _submissions = [];
let _loaded = false;
let _savePending = false;
let _saveQueued = false;

function _sanitizeMessage(value) {
  return String(value || '').trim().slice(0, 800);
}

function _sanitizeSubmitterValue(value) {
  return String(value || '').trim().slice(0, 120);
}

function _toInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.floor(num) : null;
}

function _normalizeSubmission(entry) {
  const src = entry && typeof entry === 'object' ? entry : {};
  const now = Date.now();
  const status = src.status === 'approved' || src.status === 'rejected' ? src.status : 'pending';

  return {
    id: src.id ? String(src.id) : crypto.randomUUID(),
    message: _sanitizeMessage(src.message),
    submitterValue: _sanitizeSubmitterValue(src.submitterValue),
    status,
    submittedAt: _toInt(src.submittedAt) || now,
    approvedAt: _toInt(src.approvedAt),
    rejectedAt: _toInt(src.rejectedAt),
    photoOriginalUrl: src.photoOriginalUrl ? String(src.photoOriginalUrl) : null,
    photoThumbUrl: src.photoThumbUrl ? String(src.photoThumbUrl) : null,
    photoAssetPath: src.photoAssetPath ? String(src.photoAssetPath) : null,
    publishedPhotoId: src.publishedPhotoId ? String(src.publishedPhotoId) : null,
  };
}

function _list() {
  return _submissions;
}

function _sanitizeStoredSubmissions(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const next = [];
  for (const item of raw) {
    const submission = _normalizeSubmission(item);
    if (!submission?.id || seen.has(submission.id)) continue;
    seen.add(submission.id);
    next.push(submission);
  }
  return next;
}

async function initSubmissionStore() {
  const stored = await getSettingJson('submissions');
  _submissions = _sanitizeStoredSubmissions(stored);
  _loaded = true;
}

function _queueSave() {
  if (!_loaded) return;
  if (_savePending) {
    _saveQueued = true;
    return;
  }
  _savePending = true;

  setSettingJson('submissions', _submissions)
    .catch(err => console.warn('[submissions] failed to persist store:', err.message))
    .finally(() => {
      _savePending = false;
      if (_saveQueued) {
        _saveQueued = false;
        _queueSave();
      }
    });
}

function getSubmissionSettings() {
  const cfg = getConfig();
  const publicBaseUrl = String(cfg.publicBaseUrl || '').trim().replace(/\/+$/, '');
  return {
    submissionEnabled: cfg.submissionEnabled !== false,
    submissionFieldLabel: String(cfg.submissionFieldLabel || 'Name'),
    submissionRequirePhoto: Boolean(cfg.submissionRequirePhoto),
    submissionDisplayMode: cfg.submissionDisplayMode || 'both',
    submissionDisplayIntervalSec: Number(cfg.submissionDisplayIntervalSec || 45),
    submissionDisplayDurationSec: Number(cfg.submissionDisplayDurationSec || 12),
    submissionGridCount: Number(cfg.submissionGridCount || 6),
    submissionWallShowQr: cfg.submissionWallShowQr !== false,
    submissionWallHideWhenEmpty: cfg.submissionWallHideWhenEmpty !== false,
    eventName: String(cfg.eventName || ''),
    publicBaseUrl,
    publicSubmitUrl: publicBaseUrl ? `${publicBaseUrl}/submit` : '',
    theme: cfg.theme || null,
  };
}

function updateSubmissionSettings(patch) {
  const cfg = getConfig();
  sanitizeGlobalConfig(patch || {}, cfg);
  saveConfig();
  return getSubmissionSettings();
}

function listSubmissions(options = {}) {
  const status = options.status ? String(options.status) : null;
  const limit = Number(options.limit);
  let items = _list().map(_normalizeSubmission);

  if (status === 'pending' || status === 'approved' || status === 'rejected') {
    items = items.filter(item => item.status === status);
  }

  items.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));

  if (Number.isInteger(limit) && limit > 0) {
    items = items.slice(0, limit);
  }

  return items;
}

function countPendingSubmissions() {
  return _list().filter(item => item.status === 'pending').length;
}

function getSubmissionById(id) {
  return _list().find(item => item.id === id) || null;
}

function createSubmission(input = {}) {
  const submission = _normalizeSubmission({
    id: input.id || crypto.randomUUID(),
    message: input.message,
    submitterValue: input.submitterValue,
    status: 'pending',
    submittedAt: Date.now(),
    photoOriginalUrl: input.photoOriginalUrl || null,
    photoThumbUrl: input.photoThumbUrl || null,
    photoAssetPath: input.photoAssetPath || null,
    publishedPhotoId: null,
  });

  _submissions.push(submission);
  _queueSave();
  return submission;
}

function updateSubmission(id, patch = {}) {
  const idx = _submissions.findIndex(item => item.id === id);
  if (idx === -1) return null;

  const current = _normalizeSubmission(_submissions[idx]);
  const next = { ...current };
  const now = Date.now();

  if (Object.prototype.hasOwnProperty.call(patch, 'message')) {
    next.message = _sanitizeMessage(patch.message);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'submitterValue')) {
    next.submitterValue = _sanitizeSubmitterValue(patch.submitterValue);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    const status = patch.status === 'approved' || patch.status === 'rejected' ? patch.status : 'pending';
    next.status = status;
    if (status === 'approved') {
      next.approvedAt = now;
      next.rejectedAt = null;
    } else if (status === 'rejected') {
      next.rejectedAt = now;
      next.approvedAt = null;
    } else {
      next.approvedAt = null;
      next.rejectedAt = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'publishedPhotoId')) {
    next.publishedPhotoId = patch.publishedPhotoId ? String(patch.publishedPhotoId) : null;
  }

  _submissions[idx] = next;
  _queueSave();
  return next;
}

function deleteSubmission(id) {
  const idx = _submissions.findIndex(item => item.id === id);
  if (idx === -1) return null;
  const [removed] = _submissions.splice(idx, 1);
  _queueSave();
  return removed || null;
}

function getApprovedSubmissions(limit = 40) {
  const max = Math.max(1, Math.min(200, Math.floor(Number(limit) || 40)));
  return _list()
    .filter(item => item.status === 'approved')
    .sort((a, b) => (b.approvedAt || b.submittedAt || 0) - (a.approvedAt || a.submittedAt || 0))
    .slice(0, max)
    .map(_normalizeSubmission);
}

module.exports = {
  initSubmissionStore,
  getSubmissionSettings,
  updateSubmissionSettings,
  listSubmissions,
  countPendingSubmissions,
  getSubmissionById,
  createSubmission,
  updateSubmission,
  deleteSubmission,
  getApprovedSubmissions,
};
