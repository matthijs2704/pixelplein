'use strict';

const express = require('express');

const { broadcast } = require('../ws/broadcast');
const {
  getAlerts,
  getAlertById,
  createAlert,
  updateAlert,
  fireAlert,
  dismissAlert,
  deleteAlert,
  getEventSchedule,
  createScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
} = require('./store');

const router = express.Router();

function _sortedSchedule() {
  return [...getEventSchedule()].sort((a, b) => Number(new Date(a.startTime)) - Number(new Date(b.startTime)));
}

router.get('/alerts', (_req, res) => {
  res.json({ ok: true, alerts: getAlerts() });
});

router.post('/alerts', (req, res) => {
  const alert = createAlert(req.body || {});
  if (!alert) {
    return res.status(400).json({ ok: false, error: 'Unable to create alert' });
  }

  if (alert.active) {
    broadcast({ type: 'alert_fire', alert });
  }

  res.status(201).json({ ok: true, alert });
});

router.patch('/alerts/:id', (req, res) => {
  const id = String(req.params.id || '');
  const before = getAlertById(id);
  if (!before) {
    return res.status(404).json({ ok: false, error: 'Alert not found' });
  }

  const after = updateAlert(id, req.body || {});
  if (!after) {
    return res.status(404).json({ ok: false, error: 'Alert not found' });
  }

  if (after.active) {
    broadcast({ type: 'alert_fire', alert: after });
  } else if (before.active) {
    broadcast({ type: 'alert_dismiss', alertId: id });
  }

  res.json({ ok: true, alert: after });
});

router.post('/alerts/:id/fire', (req, res) => {
  const id = String(req.params.id || '');
  const alert = fireAlert(id);
  if (!alert) {
    return res.status(404).json({ ok: false, error: 'Alert not found' });
  }

  broadcast({ type: 'alert_fire', alert });
  res.json({ ok: true, alert });
});

router.post('/alerts/:id/dismiss', (req, res) => {
  const id = String(req.params.id || '');
  const alert = dismissAlert(id);
  if (!alert) {
    return res.status(404).json({ ok: false, error: 'Alert not found' });
  }

  broadcast({ type: 'alert_dismiss', alertId: id });
  res.json({ ok: true, alert });
});

router.delete('/alerts/:id', (req, res) => {
  const id = String(req.params.id || '');
  const ok = deleteAlert(id);
  if (!ok) {
    return res.status(404).json({ ok: false, error: 'Alert not found' });
  }

  broadcast({ type: 'alert_dismiss', alertId: id });
  res.json({ ok: true });
});

router.get('/schedule', (_req, res) => {
  res.json({ ok: true, schedule: _sortedSchedule() });
});

router.post('/schedule', (req, res) => {
  const entry = createScheduleEntry(req.body || {});
  if (!entry) {
    return res.status(400).json({ ok: false, error: 'Unable to create schedule entry' });
  }

  broadcast({ type: 'schedule_update', schedule: _sortedSchedule() });
  res.status(201).json({ ok: true, entry });
});

router.patch('/schedule/:id', (req, res) => {
  const id = String(req.params.id || '');
  const entry = updateScheduleEntry(id, req.body || {});
  if (!entry) {
    return res.status(404).json({ ok: false, error: 'Schedule entry not found' });
  }

  broadcast({ type: 'schedule_update', schedule: _sortedSchedule() });
  res.json({ ok: true, entry });
});

router.delete('/schedule/:id', (req, res) => {
  const id = String(req.params.id || '');
  const ok = deleteScheduleEntry(id);
  if (!ok) {
    return res.status(404).json({ ok: false, error: 'Schedule entry not found' });
  }

  broadcast({ type: 'schedule_update', schedule: _sortedSchedule() });
  res.json({ ok: true });
});

module.exports = router;
