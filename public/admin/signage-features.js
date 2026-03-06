import { showToast } from './app.js';
import { esc, fmtAgo } from '/shared/utils.js';

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    location.href = '/login.html';
    throw new Error('Not authenticated');
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body;
}

function _isoToInputDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function _isoToInputTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Read a split date+time pair (ids: baseId-date, baseId-time) and return an ISO string or null.
function _dtPairToIso(baseId) {
  const dateVal = document.getElementById(`${baseId}-date`)?.value || '';
  const timeVal = document.getElementById(`${baseId}-time`)?.value || '';
  if (!dateVal) return null;
  const combined = timeVal ? `${dateVal}T${timeVal}` : `${dateVal}T00:00`;
  const ms = Number(new Date(combined));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function _inputToIso(value) {
  if (!value) return null;
  const ms = Number(new Date(value));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function _statusPill(status) {
  const labels = {
    live: 'live',
    scheduled: 'scheduled',
    dismissed: 'dismissed',
    idle: 'idle',
    approved: 'approved',
    rejected: 'rejected',
    pending: 'pending',
  };
  const label = labels[status] || status;
  return `<span class="status-pill ${esc(status)}">${esc(label)}</span>`;
}

function _formatStart(iso) {
  const ms = Number(new Date(iso));
  if (!Number.isFinite(ms)) return 'invalid date';
  return new Date(ms).toLocaleString([], { hour12: false });
}

// Position options keyed by style
const POSITION_OPTIONS = {
  banner: [
    { value: 'top-center',    label: 'Top center' },
    { value: 'top-left',      label: 'Top left' },
    { value: 'top-right',     label: 'Top right' },
    { value: 'bottom-center', label: 'Bottom center' },
    { value: 'bottom-left',   label: 'Bottom left' },
    { value: 'bottom-right',  label: 'Bottom right' },
  ],
  popup: [
    { value: 'center',        label: 'Center' },
    { value: 'top-center',    label: 'Top center' },
    { value: 'bottom-center', label: 'Bottom center' },
  ],
  countdown: [
    { value: 'top-right',    label: 'Top right' },
    { value: 'top-left',     label: 'Top left' },
    { value: 'bottom-right', label: 'Bottom right' },
    { value: 'bottom-left',  label: 'Bottom left' },
  ],
};

function _defaultPosition(style) {
  const map = { banner: 'top-center', popup: 'center', countdown: 'top-right' };
  return map[style] || 'top-center';
}

function _updatePositionSelect(selectId, style, currentValue) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const opts = POSITION_OPTIONS[style] || POSITION_OPTIONS.banner;
  const prev = currentValue !== undefined ? currentValue : sel.value;
  const prevValid = opts.some(o => o.value === prev);
  const newVal = prevValid ? prev : _defaultPosition(style);
  sel.innerHTML = opts.map(o =>
    `<option value="${esc(o.value)}"${o.value === newVal ? ' selected' : ''}>${esc(o.label)}</option>`
  ).join('');
}

function _bindStylePositionSync(styleId, positionId) {
  const styleEl = document.getElementById(styleId);
  if (!styleEl) return;
  // Initial update
  _updatePositionSelect(positionId, styleEl.value);
  styleEl.addEventListener('change', () => {
    _updatePositionSelect(positionId, styleEl.value);
  });
}

// Show/hide countdown target field based on selected style
function _bindCountdownFieldVisibility(styleId, wrapId) {
  const styleEl = document.getElementById(styleId);
  const wrap = document.getElementById(wrapId);
  if (!styleEl || !wrap) return;

  function _update() {
    wrap.style.display = styleEl.value === 'countdown' ? '' : 'none';
  }
  _update();
  styleEl.addEventListener('change', _update);
}

function _renderAlerts(alerts) {
  const root = document.getElementById('alerts-list');
  if (!root) return;

  if (!alerts.length) {
    root.innerHTML = '<div class="muted" style="font-size:12px">No alerts yet.</div>';
    _updateLiveCount('alerts-live-count', 0);
    _setAlertsBadge(0);
    return;
  }

  // Sort: live first, then scheduled, then idle, then dismissed
  const order = { live: 0, scheduled: 1, idle: 2, dismissed: 3 };
  const sorted = [...alerts].sort((a, b) => {
    const sa = a.dismissed ? 'dismissed' : a.active ? 'live' : a.scheduledAt ? 'scheduled' : 'idle';
    const sb = b.dismissed ? 'dismissed' : b.active ? 'live' : b.scheduledAt ? 'scheduled' : 'idle';
    return (order[sa] ?? 9) - (order[sb] ?? 9);
  });

  const liveCount = sorted.filter(a => a.active && !a.dismissed).length;
  _updateLiveCount('alerts-live-count', liveCount);
  _setAlertsBadge(liveCount);

  root.innerHTML = sorted.map(alert => {
    const state = alert.dismissed ? 'dismissed' : alert.active ? 'live' : alert.scheduledAt ? 'scheduled' : 'idle';
    const when = alert.scheduledAt ? new Date(alert.scheduledAt).toLocaleString([], { hour12: false }) : 'manual';
    const position = alert.position ? ` · ${esc(alert.position)}` : '';
    const countdown = alert.countdownTo ? ` · countdown to ${new Date(alert.countdownTo).toLocaleString([], { hour12: false })}` : '';

    // State-aware buttons
    const canFire    = state !== 'live';
    const canDismiss = state === 'live';
    const canDelete  = true;

    return `
      <div class="alert-item${state === 'live' ? ' alert-item--live' : ''}">
        <div>${_statusPill(state)}</div>
        <div class="alert-item-main">
          <div class="alert-item-msg">${esc(alert.message || '(empty message)')}</div>
          <div class="alert-item-meta">${esc(alert.style)} · ${esc(alert.priority)}${position} · ${esc(when)}${countdown}</div>
        </div>
        <div class="action-row">
          ${canFire    ? `<button class="sc-btn" data-alert-action="fire"    data-alert-id="${esc(alert.id)}">Fire</button>` : ''}
          ${canDismiss ? `<button class="sc-btn" data-alert-action="dismiss" data-alert-id="${esc(alert.id)}">Dismiss</button>` : ''}
          ${canDelete  ? `<button class="sc-btn sc-btn-del" data-alert-action="delete" data-alert-id="${esc(alert.id)}">Delete</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function _updateLiveCount(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  if (count > 0) {
    el.textContent = `${count} live`;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

function _renderSchedule(schedule) {
  const root = document.getElementById('schedule-list');
  if (!root) return;

  if (!schedule.length) {
    root.innerHTML = '<div class="muted" style="font-size:12px">No events scheduled.</div>';
    return;
  }

  root.innerHTML = schedule.map(item => {
    const cfm = Number(item.countdownFromMinutes || 0);
    const countdownMeta = cfm > 0 ? ` · show next from ${cfm}min` : '';
    const endMeta = item.endTime ? ` – ${esc(_formatStart(item.endTime))}` : '';
    return `
    <div class="alert-item">
      <div class="alert-item-main">
        <div class="alert-item-msg">${esc(item.name || '(unnamed event)')}</div>
        <div class="alert-item-meta">${esc(_formatStart(item.startTime))}${endMeta}${item.location ? ` · ${esc(item.location)}` : ''} · reminders: ${esc((item.alertMinutesBefore || []).join(', '))}${esc(countdownMeta)}</div>
      </div>
      <div class="action-row">
        <button class="sc-btn" data-schedule-action="edit" data-schedule-id="${esc(item.id)}">Edit</button>
        <button class="sc-btn sc-btn-del" data-schedule-action="delete" data-schedule-id="${esc(item.id)}">Delete</button>
      </div>
    </div>
  `;
  }).join('');
}

// Render the live-alerts mini-list on the dashboard quick alert widget
function _renderQuickAlertLiveList(alerts) {
  const root = document.getElementById('qa-live-list');
  if (!root) return;

  const live = alerts.filter(a => a.active && !a.dismissed);
  _updateLiveCount('quick-alert-live-count', live.length);

  if (!live.length) {
    root.innerHTML = '';
    return;
  }

  root.innerHTML = live.map(alert => `
    <div class="alert-item alert-item--live">
      <div>${_statusPill('live')}</div>
      <div class="alert-item-main">
        <div class="alert-item-msg">${esc(alert.message || '(empty message)')}</div>
        <div class="alert-item-meta">${esc(alert.style)} · ${esc(alert.position || '')} · ${alert.durationSec ? `${alert.durationSec}s` : 'persistent'}</div>
      </div>
      <div class="action-row">
        <button class="sc-btn" data-alert-action="dismiss" data-alert-id="${esc(alert.id)}">Dismiss</button>
      </div>
    </div>
  `).join('');
}

function _renderSubmissionCards(items, kind) {
  if (!items.length) {
    return `<div class="muted" style="font-size:12px">No ${kind} submissions.</div>`;
  }

  return items.map(item => {
    const age = fmtAgo(Date.now() - Number(item.submittedAt || 0));
    const message = String(item.message || '').trim();
    return `
      <div class="queue-card">
        ${item.photoThumbUrl ? `<img class="queue-thumb" src="${esc(item.photoThumbUrl)}" alt="">` : ''}
        ${message
    ? `<div class="queue-msg">${esc(message)}</div>`
    : '<div class="queue-msg muted" style="font-size:12px">photo-only submission</div>'}
        <div class="queue-meta">${esc(item.submitterValue || 'anonymous')} · ${esc(age)}</div>
        <div class="queue-actions">
          ${kind === 'pending' ? `<button class="sc-btn" data-sub-action="approve" data-sub-id="${esc(item.id)}">Approve</button>
          <button class="sc-btn" data-sub-action="approve-photo" data-sub-id="${esc(item.id)}">Approve photo only</button>
          <button class="sc-btn sc-btn-del" data-sub-action="reject" data-sub-id="${esc(item.id)}">Reject</button>` : ''}
          <button class="sc-btn sc-btn-del" data-sub-action="delete" data-sub-id="${esc(item.id)}">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function _setAlertsBadge(count) {
  const badge = document.getElementById('nav-alerts-badge');
  if (!badge) return;
  const n = Math.max(0, Number(count || 0));
  badge.style.display = n > 0 ? '' : 'none';
  badge.textContent = String(n);
}

function _setPendingBadge(count) {
  const badge = document.getElementById('nav-submissions-badge');
  if (!badge) return;
  const n = Math.max(0, Number(count || 0));
  badge.style.display = n > 0 ? '' : 'none';
  badge.textContent = String(n);
}

function _applySubmissionSettings(settings) {
  if (!settings) return;
  _setVal('submissions-enabled', String(settings.submissionEnabled !== false));
  _setVal('submissions-field-label', settings.submissionFieldLabel || 'Name');
  _setVal('submissions-require-photo', String(Boolean(settings.submissionRequirePhoto)));
  _setVal('submissions-display-mode', settings.submissionDisplayMode || 'both');
  _setVal('submissions-display-interval', settings.submissionDisplayIntervalSec ?? 45);
  _setVal('submissions-display-duration', settings.submissionDisplayDurationSec ?? 12);
  _setVal('submissions-grid-count', settings.submissionGridCount ?? 6);
  _setVal('submissions-wall-show-qr', String(settings.submissionWallShowQr !== false));
  _setVal('submissions-wall-hide-empty', String(settings.submissionWallHideWhenEmpty !== false));
}

function _setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = String(value ?? '');
}

// Read the global alert duration default from the signage form
function _getAlertDurationDefault() {
  const el = document.getElementById('ov-global-alert-duration');
  if (el) {
    const v = parseInt(el.value, 10);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return 18;
}

let _cachedAlerts = [];
let _cachedSchedule = [];
let _editingScheduleId = null;

async function loadAlertsAndSchedule() {
  const [alertsRes, scheduleRes] = await Promise.all([
    apiFetch('/api/alerts'),
    apiFetch('/api/schedule'),
  ]);

  const alerts = Array.isArray(alertsRes?.alerts) ? alertsRes.alerts : [];
  const schedule = Array.isArray(scheduleRes?.schedule) ? scheduleRes.schedule : [];
  _cachedAlerts = alerts;
  _cachedSchedule = schedule;
  _renderAlerts(alerts);
  _renderSchedule(schedule);
  _renderQuickAlertLiveList(alerts);
  _renderDashAlertLiveList(alerts);
  _renderDashEventsSummary(schedule);
}

async function loadSubmissions() {
  const res = await apiFetch('/api/submissions');
  const all = Array.isArray(res?.submissions) ? res.submissions : [];
  const pending = all.filter(item => item.status === 'pending');
  const approved = all.filter(item => item.status === 'approved');

  const pendingRoot = document.getElementById('submissions-pending');
  const approvedRoot = document.getElementById('submissions-approved');
  if (pendingRoot) pendingRoot.innerHTML = _renderSubmissionCards(pending, 'pending');
  if (approvedRoot) approvedRoot.innerHTML = _renderSubmissionCards(approved, 'approved');

  const pendingCount = res.pendingCount || pending.length;
  _setPendingBadge(pendingCount);
  _applySubmissionSettings(res.settings);
  _renderDashSubmissionsSummary(pendingCount);
}

async function createAlert(fireNow) {
  const style      = document.getElementById('alerts-style')?.value || 'banner';
  const priority   = document.getElementById('alerts-priority')?.value || 'normal';
  const message    = document.getElementById('alerts-message')?.value || '';
  const position   = document.getElementById('alerts-position')?.value || _defaultPosition(style);
  const durationSec = Number(document.getElementById('alerts-duration')?.value || 18);
  const countdownTo = _dtPairToIso('alerts-countdown');
  const scheduledAt = _dtPairToIso('alerts-scheduled');

  const payload = {
    style,
    priority,
    message,
    position,
    durationSec,
    countdownTo,
    trigger: fireNow ? 'manual' : 'scheduled',
    scheduledAt: fireNow ? null : scheduledAt,
    fireNow,
  };

  await apiFetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  showToast(fireNow ? 'Alert fired' : 'Scheduled alert created');
  await loadAlertsAndSchedule();
}

async function fireQuickAlert() {
  const style    = document.getElementById('qa-style')?.value || 'banner';
  const position = document.getElementById('qa-position')?.value || _defaultPosition(style);
  const message  = document.getElementById('qa-message')?.value || '';

  if (!message.trim()) throw new Error('Please enter a message');

  // Read duration from global alert defaults if available
  const durationSec = _getAlertDurationDefault();

  await apiFetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ style, position, message, durationSec, fireNow: true, trigger: 'manual' }),
  });

  showToast('Alert fired');
  const msgEl = document.getElementById('qa-message');
  if (msgEl) msgEl.value = '';
  await loadAlertsAndSchedule();
}

function _readOffsets() {
  const raw = document.getElementById('schedule-offsets')?.value || '15,5';
  return raw
    .split(',')
    .map(v => Number(v.trim()))
    .filter(v => Number.isFinite(v) && v >= 0 && v <= 240)
    .map(v => Math.floor(v));
}

async function addScheduleEntry() {
  const name = document.getElementById('schedule-name')?.value || '';
  const location = document.getElementById('schedule-location')?.value || '';
  const startTime = _dtPairToIso('schedule-start');
  const endTime   = _dtPairToIso('schedule-end');
  const alertMinutesBefore   = _readOffsets();
  const countdownFromMinutes = Number(document.getElementById('schedule-countdown-from')?.value || 0);

  if (!startTime) throw new Error('Please choose a valid start time');
  if (endTime && endTime <= startTime) throw new Error('End time must be after start time');

  await apiFetch('/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, location, startTime, endTime: endTime || null, alertMinutesBefore, countdownFromMinutes }),
  });

  showToast('Event added to schedule');
  await loadAlertsAndSchedule();
}

async function saveSubmissionSettings() {
  const payload = {
    submissionEnabled: document.getElementById('submissions-enabled')?.value === 'true',
    submissionFieldLabel: document.getElementById('submissions-field-label')?.value || 'Name',
    submissionRequirePhoto: document.getElementById('submissions-require-photo')?.value === 'true',
    submissionDisplayMode: document.getElementById('submissions-display-mode')?.value || 'both',
    submissionDisplayIntervalSec: Number(document.getElementById('submissions-display-interval')?.value || 45),
    submissionDisplayDurationSec: Number(document.getElementById('submissions-display-duration')?.value || 12),
    submissionGridCount: Number(document.getElementById('submissions-grid-count')?.value || 6),
    submissionWallShowQr: document.getElementById('submissions-wall-show-qr')?.value === 'true',
    submissionWallHideWhenEmpty: document.getElementById('submissions-wall-hide-empty')?.value === 'true',
  };

  const res = await apiFetch('/api/submissions/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  _applySubmissionSettings(res.settings);
  showToast('Submission settings saved');
}

function _openEditForm(id) {
  const item = _cachedSchedule.find(e => e.id === id);
  if (!item) return;
  _editingScheduleId = id;

  _setVal('sched-edit-name', item.name || '');
  _setVal('sched-edit-location', item.location || '');

  const startDate = document.getElementById('sched-edit-start-date');
  const startTime = document.getElementById('sched-edit-start-time');
  if (startDate) startDate.value = _isoToInputDate(item.startTime);
  if (startTime) startTime.value = _isoToInputTime(item.startTime);

  const endDate = document.getElementById('sched-edit-end-date');
  const endTime = document.getElementById('sched-edit-end-time');
  if (endDate) endDate.value = _isoToInputDate(item.endTime);
  if (endTime) endTime.value = _isoToInputTime(item.endTime);

  _setVal('sched-edit-offsets', (item.alertMinutesBefore || []).join(', '));
  _setVal('sched-edit-countdown-from', item.countdownFromMinutes ?? 0);

  const card = document.getElementById('schedule-edit-card');
  if (card) {
    card.style.display = '';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function _closeEditForm() {
  _editingScheduleId = null;
  const card = document.getElementById('schedule-edit-card');
  if (card) card.style.display = 'none';
}

function _readEditOffsets() {
  const raw = document.getElementById('sched-edit-offsets')?.value || '15,5';
  return raw
    .split(',')
    .map(v => Number(v.trim()))
    .filter(v => Number.isFinite(v) && v >= 0 && v <= 240)
    .map(v => Math.floor(v));
}

async function _saveEditEntry() {
  if (!_editingScheduleId) return;
  const name     = document.getElementById('sched-edit-name')?.value || '';
  const location = document.getElementById('sched-edit-location')?.value || '';
  const startTime = _dtPairToIso('sched-edit-start');
  const endTime   = _dtPairToIso('sched-edit-end');
  const alertMinutesBefore   = _readEditOffsets();
  const countdownFromMinutes = Number(document.getElementById('sched-edit-countdown-from')?.value || 0);

  if (!startTime) throw new Error('Please choose a valid start time');
  if (endTime && endTime <= startTime) throw new Error('End time must be after start time');

  await apiFetch(`/api/schedule/${encodeURIComponent(_editingScheduleId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, location, startTime, endTime: endTime || null, alertMinutesBefore, countdownFromMinutes }),
  });

  _closeEditForm();
  showToast('Event updated');
  await loadAlertsAndSchedule();
}

// Read global alert style default from signage form
function _getAlertStyleDefault() {
  const el = document.getElementById('ov-global-alert-style');
  return el?.value || 'banner';
}

// Read global alert position default from signage form
function _getAlertPositionDefault() {
  const el = document.getElementById('ov-global-alert-position');
  return el?.value || 'top-center';
}

// Dashboard quick alert fire — uses global defaults unless customize disclosure is open
async function fireDashQuickAlert() {
  const customize = document.getElementById('dash-qa-customize');
  const useOverrides = customize?.open === true;

  const style    = useOverrides
    ? (document.getElementById('dash-qa-style')?.value || 'banner')
    : _getAlertStyleDefault();
  const position = useOverrides
    ? (document.getElementById('dash-qa-position')?.value || _defaultPosition(style))
    : _getAlertPositionDefault();
  const message  = document.getElementById('dash-qa-message')?.value || '';

  if (!message.trim()) throw new Error('Please enter a message');

  const durationSec = _getAlertDurationDefault();

  await apiFetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ style, position, message, durationSec, fireNow: true, trigger: 'manual' }),
  });

  showToast('Alert fired');
  const msgEl = document.getElementById('dash-qa-message');
  if (msgEl) msgEl.value = '';
  await loadAlertsAndSchedule();
}

// Dashboard event summary rendering
function _renderDashEventsSummary(schedule) {
  const root = document.getElementById('dash-events-summary');
  if (!root) return;

  if (!schedule.length) {
    root.innerHTML = '<div class="muted" style="font-size:12px">No events scheduled.</div>';
    return;
  }

  const now = Date.now();
  const upcoming = schedule
    .filter(e => new Date(e.startTime).getTime() > now)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const current = schedule.filter(e => {
    const start = new Date(e.startTime).getTime();
    const end = e.endTime ? new Date(e.endTime).getTime() : start + 3600000;
    return start <= now && now < end;
  });

  let html = '';
  if (current.length) {
    html += current.map(e =>
      `<div style="font-size:12px"><span class="status-pill live">now</span> <strong>${esc(e.name)}</strong>${e.location ? ` · ${esc(e.location)}` : ''}</div>`
    ).join('');
  }
  if (upcoming.length) {
    const next = upcoming[0];
    const mins = Math.round((new Date(next.startTime).getTime() - now) / 60000);
    const timeLabel = mins < 60 ? `in ${mins}m` : `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
    html += `<div style="font-size:12px"><span class="status-pill scheduled">next</span> <strong>${esc(next.name)}</strong> · ${esc(timeLabel)}${next.location ? ` · ${esc(next.location)}` : ''}</div>`;
    if (upcoming.length > 1) {
      html += `<div class="muted" style="font-size:11px;margin-top:4px">+${upcoming.length - 1} more upcoming</div>`;
    }
  }
  if (!html) {
    html = '<div class="muted" style="font-size:12px">No current or upcoming events.</div>';
  }
  root.innerHTML = html;
}

// Dashboard submissions summary
function _renderDashSubmissionsSummary(pendingCount) {
  const root = document.getElementById('dash-submissions-summary');
  if (!root) return;

  if (pendingCount > 0) {
    root.innerHTML = `<div style="font-size:13px;font-weight:600;color:var(--yellow)">${pendingCount} pending</div>`;
  } else {
    root.innerHTML = '<div class="muted" style="font-size:12px">No pending submissions.</div>';
  }
}

// Dashboard live alert list
// Update the dashboard hint text to reflect current global defaults
function _updateDashQaHint() {
  const hint = document.getElementById('dash-qa-defaults-hint');
  if (!hint) return;
  const style = _getAlertStyleDefault();
  const pos   = _getAlertPositionDefault();
  const dur   = _getAlertDurationDefault();
  hint.textContent = `Defaults: ${style}, ${pos}, ${dur}s`;
}

function _renderDashAlertLiveList(alerts) {
  const root = document.getElementById('dash-qa-live-list');
  if (!root) return;

  const live = alerts.filter(a => a.active && !a.dismissed);
  _updateLiveCount('dash-alert-live-count', live.length);

  if (!live.length) {
    root.innerHTML = '';
    return;
  }

  root.innerHTML = live.map(alert => `
    <div class="alert-item alert-item--live">
      <div>${_statusPill('live')}</div>
      <div class="alert-item-main">
        <div class="alert-item-msg">${esc(alert.message || '(empty message)')}</div>
        <div class="alert-item-meta">${esc(alert.style)} · ${alert.durationSec ? `${alert.durationSec}s` : 'persistent'}</div>
      </div>
      <div class="action-row">
        <button class="sc-btn" data-alert-action="dismiss" data-alert-id="${esc(alert.id)}">Dismiss</button>
      </div>
    </div>
  `).join('');
}

function bindActions() {
  // Contextual form wiring: position options and countdown field visibility
  _bindStylePositionSync('alerts-style', 'alerts-position');
  _bindCountdownFieldVisibility('alerts-style', 'alerts-countdown-wrap');
  _bindStylePositionSync('qa-style', 'qa-position');
  _bindStylePositionSync('dash-qa-style', 'dash-qa-position');

  // Keep dashboard hint in sync with global alert default fields
  _updateDashQaHint();
  for (const id of ['ov-global-alert-style', 'ov-global-alert-position', 'ov-global-alert-duration']) {
    document.getElementById(id)?.addEventListener('change', _updateDashQaHint);
    document.getElementById(id)?.addEventListener('input', _updateDashQaHint);
  }

  document.getElementById('alerts-fire-now')?.addEventListener('click', async () => {
    try {
      await createAlert(true);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('alerts-create-scheduled')?.addEventListener('click', async () => {
    try {
      await createAlert(false);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('qa-fire')?.addEventListener('click', async () => {
    try {
      await fireQuickAlert();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Dashboard quick alert fire
  document.getElementById('dash-qa-fire')?.addEventListener('click', async () => {
    try {
      await fireDashQuickAlert();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Dismiss live alerts from dashboard quick alert widget
  document.getElementById('dash-qa-live-list')?.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-alert-action="dismiss"]');
    if (!btn) return;
    const id = btn.dataset.alertId;
    try {
      await apiFetch(`/api/alerts/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
      await loadAlertsAndSchedule();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Dismiss live alerts from the quick alert widget
  document.getElementById('qa-live-list')?.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-alert-action="dismiss"]');
    if (!btn) return;
    const id = btn.dataset.alertId;
    try {
      await apiFetch(`/api/alerts/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
      await loadAlertsAndSchedule();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('schedule-add')?.addEventListener('click', async () => {
    try {
      await addScheduleEntry();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('alerts-list')?.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-alert-action]');
    if (!btn) return;
    const id = btn.dataset.alertId;
    const action = btn.dataset.alertAction;

    try {
      if (action === 'fire') {
        await apiFetch(`/api/alerts/${encodeURIComponent(id)}/fire`, { method: 'POST' });
      } else if (action === 'dismiss') {
        await apiFetch(`/api/alerts/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
      } else if (action === 'delete') {
        await apiFetch(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      }
      await loadAlertsAndSchedule();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('sched-edit-save')?.addEventListener('click', async () => {
    try {
      await _saveEditEntry();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('sched-edit-cancel')?.addEventListener('click', () => {
    _closeEditForm();
  });

  document.getElementById('schedule-list')?.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-schedule-action]');
    if (!btn) return;
    const id = btn.dataset.scheduleId;
    const action = btn.dataset.scheduleAction;

    if (action === 'edit') {
      _openEditForm(id);
      return;
    }

    if (action === 'delete') {
      try {
        await apiFetch(`/api/schedule/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (_editingScheduleId === id) _closeEditForm();
        await loadAlertsAndSchedule();
      } catch (err) {
        showToast(err.message, true);
      }
    }
  });

  document.getElementById('submissions-pending')?.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-sub-action]');
    if (!btn) return;
    const id = btn.dataset.subId;
    const action = btn.dataset.subAction;

    try {
      if (action === 'approve') {
        await apiFetch(`/api/submissions/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'approved' }),
        });
      } else if (action === 'approve-photo') {
        await apiFetch(`/api/submissions/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'approved', message: '' }),
        });
      } else if (action === 'reject') {
        await apiFetch(`/api/submissions/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'rejected' }),
        });
      } else if (action === 'delete') {
        await apiFetch(`/api/submissions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      }
      await loadSubmissions();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('submissions-approved')?.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-sub-action="delete"]');
    if (!btn) return;
    const id = btn.dataset.subId;
    try {
      await apiFetch(`/api/submissions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadSubmissions();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('submissions-save-settings')?.addEventListener('click', async () => {
    try {
      await saveSubmissionSettings();
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

async function boot() {
  bindActions();
  window._loadAlertsAndSchedule = loadAlertsAndSchedule;
  await Promise.allSettled([loadAlertsAndSchedule(), loadSubmissions()]);

  setInterval(() => {
    loadAlertsAndSchedule().catch(() => {});
    loadSubmissions().catch(() => {});
  }, 12_000);
}

boot();
