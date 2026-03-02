'use strict';

const crypto = require('crypto');

const { getSettingJson, setSettingJson } = require('../../db');

const ALERT_STYLES = new Set(['banner', 'popup', 'countdown']);
const ALERT_POSITIONS = new Set(['top', 'bottom', 'center']);
const ALERT_PRIORITIES = new Set(['normal', 'urgent']);
const ALERT_TRIGGERS = new Set(['manual', 'scheduled', 'event_auto']);

let _alerts = [];
let _eventSchedule = [];
let _loaded = false;
let _savePending = false;
let _saveQueued = false;

function _toInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function _toIso(value) {
  if (!value) return null;
  const ms = Number(new Date(value));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function _sanitizeAlertPatch(input, base = {}) {
  const next = { ...base };
  const src = input && typeof input === 'object' ? input : {};

  if (Object.prototype.hasOwnProperty.call(src, 'style')) {
    next.style = ALERT_STYLES.has(src.style) ? src.style : 'banner';
  }

  if (Object.prototype.hasOwnProperty.call(src, 'message')) {
    next.message = String(src.message || '').slice(0, 400);
  }

  if (Object.prototype.hasOwnProperty.call(src, 'position')) {
    next.position = ALERT_POSITIONS.has(src.position) ? src.position : 'top';
  }

  if (Object.prototype.hasOwnProperty.call(src, 'priority')) {
    next.priority = ALERT_PRIORITIES.has(src.priority) ? src.priority : 'normal';
  }

  if (Object.prototype.hasOwnProperty.call(src, 'durationSec')) {
    next.durationSec = _toInt(src.durationSec, 0, 3600, 15);
  }

  if (Object.prototype.hasOwnProperty.call(src, 'trigger')) {
    next.trigger = ALERT_TRIGGERS.has(src.trigger) ? src.trigger : 'manual';
  }

  if (Object.prototype.hasOwnProperty.call(src, 'scheduledAt')) {
    next.scheduledAt = _toIso(src.scheduledAt);
  }

  if (Object.prototype.hasOwnProperty.call(src, 'countdownTo')) {
    next.countdownTo = _toIso(src.countdownTo);
  }

  if (Object.prototype.hasOwnProperty.call(src, 'active')) {
    next.active = Boolean(src.active);
  }

  if (Object.prototype.hasOwnProperty.call(src, 'dismissed')) {
    next.dismissed = Boolean(src.dismissed);
  }

  if (Object.prototype.hasOwnProperty.call(src, 'eventId')) {
    next.eventId = src.eventId ? String(src.eventId) : null;
  }

  if (!ALERT_POSITIONS.has(next.position)) {
    next.position = next.style === 'popup' ? 'center' : 'top';
  }

  return next;
}

function _sanitizeOffsets(input) {
  const raw = Array.isArray(input) ? input : [15, 5];
  const next = raw
    .map(v => Math.floor(Number(v)))
    .filter(v => Number.isFinite(v) && v >= 0 && v <= 240);
  return [...new Set(next)].sort((a, b) => b - a);
}

function _sanitizeSchedulePatch(input, base = {}) {
  const next = { ...base };
  const src = input && typeof input === 'object' ? input : {};

  if (Object.prototype.hasOwnProperty.call(src, 'name')) {
    next.name = String(src.name || '').slice(0, 200);
  }

  if (Object.prototype.hasOwnProperty.call(src, 'location')) {
    next.location = String(src.location || '').slice(0, 200);
  }

  if (Object.prototype.hasOwnProperty.call(src, 'startTime')) {
    const iso = _toIso(src.startTime);
    if (iso) next.startTime = iso;
  }

  if (Object.prototype.hasOwnProperty.call(src, 'alertMinutesBefore')) {
    next.alertMinutesBefore = _sanitizeOffsets(src.alertMinutesBefore);
  }

  return next;
}

function _sanitizeAlert(alert) {
  const now = Date.now();
  const next = _sanitizeAlertPatch(alert, {
    id: '',
    style: 'banner',
    message: '',
    position: 'top',
    priority: 'normal',
    durationSec: 15,
    trigger: 'manual',
    scheduledAt: null,
    countdownTo: null,
    active: false,
    dismissed: false,
    createdAt: now,
    firedAt: null,
    dismissedAt: null,
    eventId: null,
  });
  if (!next.id) next.id = crypto.randomUUID();
  next.createdAt = _toInt(alert?.createdAt, 0, Number.MAX_SAFE_INTEGER, now);
  next.firedAt = alert?.firedAt == null ? null : _toInt(alert.firedAt, 0, Number.MAX_SAFE_INTEGER, now);
  next.dismissedAt = alert?.dismissedAt == null ? null : _toInt(alert.dismissedAt, 0, Number.MAX_SAFE_INTEGER, now);
  return next;
}

function _sanitizeEventScheduleEntry(item) {
  const next = _sanitizeSchedulePatch(item, {
    id: '',
    name: '',
    location: '',
    startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    alertMinutesBefore: [15, 5],
    firedOffsets: [],
  });
  if (!next.id) next.id = crypto.randomUUID();

  const firedOffsets = Array.isArray(item?.firedOffsets)
    ? item.firedOffsets
      .map(v => Math.floor(Number(v)))
      .filter(v => Number.isFinite(v) && v >= 0 && v <= 240)
    : [];
  next.firedOffsets = [...new Set(firedOffsets)].sort((a, b) => b - a);
  return next;
}

function _sanitizeAlertList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const next = [];
  for (const item of raw) {
    const alert = _sanitizeAlert(item);
    if (!alert?.id || seen.has(alert.id)) continue;
    seen.add(alert.id);
    next.push(alert);
  }
  return next;
}

function _sanitizeScheduleList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const next = [];
  for (const item of raw) {
    const entry = _sanitizeEventScheduleEntry(item);
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    next.push(entry);
  }
  return next;
}

async function initAlertStore() {
  const [storedAlerts, storedSchedule] = await Promise.all([
    getSettingJson('alerts'),
    getSettingJson('event_schedule'),
  ]);

  _alerts = _sanitizeAlertList(storedAlerts);
  _eventSchedule = _sanitizeScheduleList(storedSchedule);
  _loaded = true;
}

function _queueSave() {
  if (!_loaded) return;
  if (_savePending) {
    _saveQueued = true;
    return;
  }

  _savePending = true;
  Promise.all([
    setSettingJson('alerts', _alerts),
    setSettingJson('event_schedule', _eventSchedule),
  ])
    .catch(err => console.warn('[alerts] failed to persist store:', err.message))
    .finally(() => {
      _savePending = false;
      if (_saveQueued) {
        _saveQueued = false;
        _queueSave();
      }
    });
}

function persistAlertStore() {
  _queueSave();
}

function getAlerts() {
  return _alerts;
}

function getAlertById(id) {
  return getAlerts().find(a => a.id === id) || null;
}

function getActiveAlerts() {
  return getAlerts().filter(a => a.active && !a.dismissed);
}

function createAlert(input) {
  const now = Date.now();
  const base = {
    id: crypto.randomUUID(),
    style: 'banner',
    message: '',
    position: 'top',
    priority: 'normal',
    durationSec: 15,
    trigger: 'manual',
    scheduledAt: null,
    countdownTo: null,
    active: false,
    dismissed: false,
    createdAt: now,
    firedAt: null,
    dismissedAt: null,
    eventId: null,
  };

  const next = _sanitizeAlertPatch(input, base);
  const shouldFireNow = Boolean(input?.fireNow) || (next.trigger === 'manual' && !next.scheduledAt);
  if (shouldFireNow) {
    next.active = true;
    next.dismissed = false;
    next.firedAt = now;
  }

  _alerts.push(next);
  _queueSave();
  return next;
}

function updateAlert(id, patch) {
  const idx = _alerts.findIndex(a => a.id === id);
  if (idx === -1) return null;

  const now = Date.now();
  const current = _alerts[idx];
  const next = _sanitizeAlertPatch(patch, current);

  if (!current.active && next.active) {
    next.firedAt = now;
    next.dismissed = false;
    next.dismissedAt = null;
  }

  if (current.active && !next.active) {
    next.dismissedAt = now;
  }

  if (!current.dismissed && next.dismissed) {
    next.active = false;
    next.dismissedAt = now;
  }

  if (current.dismissed && !next.dismissed) {
    next.dismissedAt = null;
  }

  _alerts[idx] = next;
  _queueSave();
  return next;
}

function fireAlert(id) {
  return updateAlert(id, { active: true, dismissed: false });
}

function dismissAlert(id) {
  return updateAlert(id, { active: false, dismissed: true });
}

function deleteAlert(id) {
  const idx = _alerts.findIndex(a => a.id === id);
  if (idx === -1) return false;
  _alerts.splice(idx, 1);
  _queueSave();
  return true;
}

function getEventSchedule() {
  return _eventSchedule;
}

function getEventById(id) {
  return _eventSchedule.find(item => item.id === id) || null;
}

function createScheduleEntry(input) {
  const base = {
    id: crypto.randomUUID(),
    name: '',
    location: '',
    startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    alertMinutesBefore: [15, 5],
    firedOffsets: [],
  };

  const next = _sanitizeSchedulePatch(input, base);
  if (!Array.isArray(next.firedOffsets)) next.firedOffsets = [];

  _eventSchedule.push(next);
  _queueSave();
  return next;
}

function updateScheduleEntry(id, patch) {
  const idx = _eventSchedule.findIndex(item => item.id === id);
  if (idx === -1) return null;

  const current = _eventSchedule[idx];
  const next = _sanitizeSchedulePatch(patch, current);
  const timeChanged = next.startTime !== current.startTime;
  if (!Array.isArray(next.firedOffsets)) next.firedOffsets = [];

  if (timeChanged || Object.prototype.hasOwnProperty.call(patch || {}, 'alertMinutesBefore')) {
    next.firedOffsets = [];
  }

  _eventSchedule[idx] = next;
  _queueSave();
  return next;
}

function deleteScheduleEntry(id) {
  const idx = _eventSchedule.findIndex(item => item.id === id);
  if (idx === -1) return false;
  _eventSchedule.splice(idx, 1);
  _queueSave();
  return true;
}

module.exports = {
  initAlertStore,
  persistAlertStore,
  getAlerts,
  getAlertById,
  getActiveAlerts,
  createAlert,
  updateAlert,
  fireAlert,
  dismissAlert,
  deleteAlert,
  getEventSchedule,
  getEventById,
  createScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
};
