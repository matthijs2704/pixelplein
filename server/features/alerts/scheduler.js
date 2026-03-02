'use strict';

const crypto = require('crypto');

const { broadcast } = require('../ws/broadcast');
const { getAlerts, getEventSchedule, persistAlertStore } = require('./store');

let _timer = null;

function _serializeAlert(alert) {
  return {
    id: alert.id,
    style: alert.style,
    message: alert.message,
    position: alert.position,
    priority: alert.priority,
    durationSec: alert.durationSec,
    trigger: alert.trigger,
    scheduledAt: alert.scheduledAt,
    countdownTo: alert.countdownTo,
    active: alert.active,
    dismissed: alert.dismissed,
    createdAt: alert.createdAt,
    firedAt: alert.firedAt,
    dismissedAt: alert.dismissedAt,
    eventId: alert.eventId,
  };
}

function _createReminderAlert(eventEntry, minutesBefore, now) {
  const startsInText = minutesBefore === 0
    ? 'starting now'
    : `starts in ${minutesBefore} minute${minutesBefore === 1 ? '' : 's'}`;
  const locationText = eventEntry.location ? ` (${eventEntry.location})` : '';

  return {
    id: crypto.randomUUID(),
    style: 'banner',
    message: `${eventEntry.name || 'Next event'} ${startsInText}${locationText}`,
    position: 'top',
    priority: minutesBefore <= 5 ? 'urgent' : 'normal',
    durationSec: 18,
    trigger: 'event_auto',
    scheduledAt: null,
    countdownTo: new Date(eventEntry.startTime).toISOString(),
    active: true,
    dismissed: false,
    createdAt: now,
    firedAt: now,
    dismissedAt: null,
    eventId: eventEntry.id,
  };
}

function _tick() {
  const alerts = getAlerts();
  const schedule = getEventSchedule();
  const now = Date.now();

  const firedAlerts = [];
  const dismissedIds = [];
  let changed = false;
  let scheduleChanged = false;

  for (const alert of alerts) {
    if (!alert || alert.dismissed) continue;

    const scheduledAtMs = alert.scheduledAt ? Number(new Date(alert.scheduledAt)) : null;
    if (!alert.active && alert.trigger === 'scheduled' && Number.isFinite(scheduledAtMs) && scheduledAtMs <= now) {
      alert.active = true;
      alert.dismissed = false;
      alert.firedAt = now;
      alert.dismissedAt = null;
      firedAlerts.push(_serializeAlert(alert));
      changed = true;
    }

    if (!alert.active) continue;

    if (alert.style === 'countdown' && alert.countdownTo) {
      const targetMs = Number(new Date(alert.countdownTo));
      if (Number.isFinite(targetMs) && targetMs <= now) {
        alert.active = false;
        alert.dismissed = true;
        alert.dismissedAt = now;
        dismissedIds.push(alert.id);
        changed = true;
        continue;
      }
    }

    const durationSec = Number(alert.durationSec || 0);
    const firedAt = Number(alert.firedAt || 0);
    if (durationSec > 0 && firedAt > 0 && now >= firedAt + (durationSec * 1000)) {
      alert.active = false;
      alert.dismissed = true;
      alert.dismissedAt = now;
      dismissedIds.push(alert.id);
      changed = true;
    }
  }

  for (const item of schedule) {
    if (!item) continue;
    const startMs = Number(new Date(item.startTime));
    if (!Number.isFinite(startMs)) continue;
    if (startMs + (10 * 60 * 1000) < now) continue;

    if (!Array.isArray(item.alertMinutesBefore)) item.alertMinutesBefore = [15, 5];
    if (!Array.isArray(item.firedOffsets)) item.firedOffsets = [];

    for (const offset of item.alertMinutesBefore) {
      if (item.firedOffsets.includes(offset)) continue;
      const triggerAt = startMs - (offset * 60 * 1000);
      if (now < triggerAt) continue;

      const reminder = _createReminderAlert(item, offset, now);
      alerts.push(reminder);
      item.firedOffsets.push(offset);
      firedAlerts.push(_serializeAlert(reminder));
      changed = true;
      scheduleChanged = true;
    }
  }

  const keepAlerts = [];
  for (const alert of alerts) {
    if (!alert?.dismissed || !alert.dismissedAt) {
      keepAlerts.push(alert);
      continue;
    }
    if ((now - Number(alert.dismissedAt)) < (24 * 60 * 60 * 1000)) {
      keepAlerts.push(alert);
    } else {
      changed = true;
    }
  }

  if (keepAlerts.length !== alerts.length) {
    alerts.splice(0, alerts.length, ...keepAlerts);
  }

  if (changed) persistAlertStore();

  for (const alert of firedAlerts) {
    broadcast({ type: 'alert_fire', alert });
  }

  for (const id of dismissedIds) {
    broadcast({ type: 'alert_dismiss', alertId: id });
  }

  if (scheduleChanged) {
    broadcast({
      type: 'schedule_update',
      schedule: [...schedule].sort((a, b) => Number(new Date(a.startTime)) - Number(new Date(b.startTime))),
    });
  }
}

function startAlertScheduler() {
  if (_timer) return;
  _tick();
  _timer = setInterval(_tick, 1000);
}

function stopAlertScheduler() {
  if (!_timer) return;
  clearInterval(_timer);
  _timer = null;
}

module.exports = {
  startAlertScheduler,
  stopAlertScheduler,
};
