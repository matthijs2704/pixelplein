import { showToast, showImageModal } from './app.js';
import { esc, fmtAgo } from '/shared/utils.js';

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    location.href = '/login';
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

  const styleAccent = { banner: 'var(--accent)', popup: 'var(--yellow)', countdown: 'var(--green)' };

  root.innerHTML = sorted.map(alert => {
    const state = alert.dismissed ? 'dismissed' : alert.active ? 'live' : alert.scheduledAt ? 'scheduled' : 'idle';
    const when = alert.scheduledAt ? new Date(alert.scheduledAt).toLocaleString([], { hour12: false }) : 'manual';
    const position = alert.position ? ` · ${esc(alert.position)}` : '';
    const duration = alert.durationSec != null ? ` · ${alert.durationSec === 0 ? 'persistent' : alert.durationSec + 's'}` : '';
    const countdown = alert.countdownTo ? ` · countdown to ${new Date(alert.countdownTo).toLocaleString([], { hour12: false })}` : '';

    const borderColor = alert.priority === 'urgent' ? 'var(--red)' : (styleAccent[alert.style] || 'var(--border)');
    const urgentBadge = alert.priority === 'urgent' ? ' <span class="status-pill" style="background:rgba(224,92,92,0.2);color:var(--red);border-color:var(--red)">urgent</span>' : '';

    const canFire    = state !== 'live';
    const canDismiss = state === 'live';

    return `
      <div class="alert-item${state === 'live' ? ' alert-item--live' : ''}" style="border-left:3px solid ${borderColor}">
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">${_statusPill(state)}${urgentBadge}</div>
        <div class="alert-item-main">
          <div class="alert-item-msg">${esc(alert.message || '(empty message)')}</div>
          <div class="alert-item-meta">${esc(alert.style)}${position}${duration}${countdown} · ${esc(when)}</div>
        </div>
        <div class="action-row">
          ${canFire    ? `<button class="sc-btn" data-alert-action="fire"    data-alert-id="${esc(alert.id)}">Fire</button>` : ''}
          ${canDismiss ? `<button class="sc-btn" data-alert-action="dismiss" data-alert-id="${esc(alert.id)}">Dismiss</button>` : ''}
          <button class="sc-btn sc-btn-del" data-alert-action="delete" data-alert-id="${esc(alert.id)}">Delete</button>
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
    const emptyText = {
      'screen-pending': 'No pending screen submissions.',
      'screen-approved': 'No approved screen submissions.',
      'tip-pending': 'No pending newsletter tips.',
      'tip-handled': 'No handled newsletter tips.',
    };
    return `<div class="muted" style="font-size:12px;padding:4px 0">${emptyText[kind] || 'None.'}</div>`;
  }

  return items.map(item => {
    const age = fmtAgo(Date.now() - Number(item.submittedAt || 0));
    const message = String(item.message || '').trim();
    let actions = `<button class="sc-btn sc-btn-del" data-sub-action="delete" data-sub-id="${esc(item.id)}">Delete</button>`;

    if (kind === 'screen-pending') {
      actions = `
        <button class="sc-btn sc-btn-approve" data-sub-action="approve" data-sub-id="${esc(item.id)}">Approve</button>
        <button class="sc-btn" data-sub-action="approve-photo" data-sub-id="${esc(item.id)}">Photo only</button>
        <button class="sc-btn sc-btn-del" data-sub-action="reject" data-sub-id="${esc(item.id)}">Reject</button>
        <button class="sc-btn sc-btn-del" data-sub-action="delete" data-sub-id="${esc(item.id)}">Delete</button>
      `;
    } else if (kind === 'tip-pending') {
      actions = `
        <button class="sc-btn sc-btn-approve" data-sub-action="handle" data-sub-id="${esc(item.id)}">Mark handled</button>
        <button class="sc-btn sc-btn-del" data-sub-action="reject" data-sub-id="${esc(item.id)}">Reject</button>
        <button class="sc-btn sc-btn-del" data-sub-action="delete" data-sub-id="${esc(item.id)}">Delete</button>
      `;
    }

    return `
      <div class="sub-row">
        ${item.photoThumbUrl
          ? `<img class="sub-row-thumb sub-image-preview" src="${esc(item.photoThumbUrl)}" data-full-src="${esc(item.photoOriginalUrl || item.photoThumbUrl)}" data-title="${esc(item.submitterValue || 'submission')}" alt="">`
          : '<div class="sub-row-thumb sub-row-nophoto"></div>'}
        <div class="sub-row-content">
          <div class="sub-row-meta">${esc(item.submitterValue || 'anonymous')} · ${esc(age)}</div>
          ${message
            ? `<div class="sub-row-msg">${esc(message)}</div>`
            : `<div class="sub-row-msg muted">photo-only submission</div>`}
        </div>
        <div class="sub-row-actions">${actions}</div>
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
  _setVal('submissions-wall-enabled', String(settings.submissionWallEnabled !== false));
  _setVal('submissions-display-mode', settings.submissionDisplayMode || 'both');
  _setVal('submissions-display-interval', settings.submissionDisplayIntervalSec ?? 45);
  _setVal('submissions-display-duration', settings.submissionDisplayDurationSec ?? 12);
  _setVal('submissions-grid-count', settings.submissionGridCount ?? 6);
  _setVal('submissions-wall-max-age-enabled', String(settings.submissionWallMaxAgeEnabled !== false));
  _setVal('submissions-wall-max-age-min', settings.submissionWallMaxAgeMin ?? 90);
  _setVal('submissions-wall-repeat-cycles', settings.submissionWallRepeatAfterCycles ?? 3);
  _setVal('submissions-wall-min-approved', settings.submissionWallMinApproved ?? 2);
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
  const screenPending = all.filter(item => item.kind !== 'kampkrant_tip' && item.status === 'pending');
  const screenApproved = all.filter(item => item.kind !== 'kampkrant_tip' && item.status === 'approved');
  const tipPending = all.filter(item => item.kind === 'kampkrant_tip' && item.status === 'pending');
  const tipHandled = all.filter(item => item.kind === 'kampkrant_tip' && item.status === 'handled');

  const screenPendingRoot = document.getElementById('submissions-screen-pending');
  const screenApprovedRoot = document.getElementById('submissions-screen-approved');
  const tipPendingRoot = document.getElementById('submissions-tip-pending');
  const tipHandledRoot = document.getElementById('submissions-tip-handled');
  if (screenPendingRoot) screenPendingRoot.innerHTML = _renderSubmissionCards(screenPending, 'screen-pending');
  if (screenApprovedRoot) screenApprovedRoot.innerHTML = _renderSubmissionCards(screenApproved, 'screen-approved');
  if (tipPendingRoot) tipPendingRoot.innerHTML = _renderSubmissionCards(tipPending, 'tip-pending');
  if (tipHandledRoot) tipHandledRoot.innerHTML = _renderSubmissionCards(tipHandled, 'tip-handled');

  // Pending count badges on submissions page
  const spBadge = document.getElementById('sub-screen-pending-count');
  if (spBadge) { spBadge.textContent = String(screenPending.length); spBadge.style.display = screenPending.length ? '' : 'none'; }
  const tpBadge = document.getElementById('sub-tip-pending-count');
  if (tpBadge) { tpBadge.textContent = String(tipPending.length); tpBadge.style.display = tipPending.length ? '' : 'none'; }

  // Populate quick controls from settings
  if (res.settings) {
    const s = res.settings;
    const enabledEl = document.getElementById('sub-quick-enabled');
    const labelEl   = document.getElementById('sub-quick-field-label');
    const photoEl   = document.getElementById('sub-quick-require-photo');
    const wallEl    = document.getElementById('sub-quick-wall-enabled');
    if (enabledEl) enabledEl.value = String(s.submissionEnabled !== false);
    if (labelEl)   labelEl.value   = s.submissionFieldLabel || '';
    if (photoEl)   photoEl.value   = String(Boolean(s.submissionRequirePhoto));
    if (wallEl)    wallEl.value    = String(s.submissionWallEnabled !== false);
  }

  const pendingCount = res.pendingCount || (screenPending.length + tipPending.length);
  _setPendingBadge(pendingCount);
  _renderDashSubmissionsSummary(screenPending, tipPending);
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

  const durationEl = document.getElementById('qa-duration');
  const durationSec = durationEl ? Math.max(0, parseInt(durationEl.value || '18', 10)) : 18;

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

// Dashboard submissions summary — rich card with quick approve/reject
function _renderDashSubmissionsSummary(screenPending, tipPending) {
  const root  = document.getElementById('dash-submissions-pending');
  const badge = document.getElementById('dash-sub-badge');
  const btn   = document.getElementById('dash-sub-review-btn');
  if (!root) return;

  const total = screenPending.length + tipPending.length;
  if (badge) { badge.textContent = String(total); badge.style.display = total ? '' : 'none'; }
  if (btn)   btn.style.display = total ? '' : 'none';

  if (!total) {
    root.innerHTML = '<div class="muted" style="font-size:12px">No pending submissions.</div>';
    return;
  }

  const allPending = [...screenPending, ...tipPending].slice(0, 8);
  root.innerHTML = allPending.map(item => {
    const isTip = item.kind === 'kampkrant_tip';
    const message = String(item.message || '').trim();
    const age = fmtAgo(Date.now() - Number(item.submittedAt || 0));
    const actions = isTip
      ? `<button class="sc-btn sc-btn-approve" data-sub-action="handle" data-sub-id="${esc(item.id)}">Handle</button>
         <button class="sc-btn sc-btn-del" data-sub-action="reject" data-sub-id="${esc(item.id)}">Reject</button>`
      : `<button class="sc-btn sc-btn-approve" data-sub-action="approve" data-sub-id="${esc(item.id)}">Approve</button>
         <button class="sc-btn sc-btn-del" data-sub-action="reject" data-sub-id="${esc(item.id)}">Reject</button>`;
    return `
      <div class="dash-sub-row">
        ${item.photoThumbUrl ? `<img class="dash-sub-thumb sub-image-preview" src="${esc(item.photoThumbUrl)}" data-full-src="${esc(item.photoOriginalUrl || item.photoThumbUrl)}" data-title="${esc(item.submitterValue || 'submission')}" alt="">` : '<div class="dash-sub-thumb dash-sub-nophoto"></div>'}
        <div class="dash-sub-content">
          <div class="dash-sub-meta">${esc(item.submitterValue || 'anonymous')} · ${esc(age)}${isTip ? ' · tip' : ''}</div>
          <div class="dash-sub-msg">${message ? esc(message) : '<span class="muted">photo only</span>'}</div>
        </div>
        <div class="dash-sub-actions">${actions}</div>
      </div>`;
  }).join('');
  if (total > 8) {
    root.innerHTML += `<div class="muted" style="font-size:11px;padding:6px 0">+${total - 8} more — click View all</div>`;
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

  const onSubmissionQueueClick = async e => {
    const preview = e.target.closest('.sub-image-preview');
    if (preview) {
      showImageModal(preview.dataset.fullSrc || preview.currentSrc || preview.src, preview.dataset.title || preview.alt || '');
      return;
    }

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
      } else if (action === 'handle') {
        await apiFetch(`/api/submissions/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'handled' }),
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
  };

  document.getElementById('submissions-screen-pending')?.addEventListener('click', onSubmissionQueueClick);
  document.getElementById('submissions-screen-approved')?.addEventListener('click', onSubmissionQueueClick);
  document.getElementById('submissions-tip-pending')?.addEventListener('click', onSubmissionQueueClick);
  document.getElementById('submissions-tip-handled')?.addEventListener('click', onSubmissionQueueClick);

  // Control Room pending-review card
  document.getElementById('dash-submissions-pending')?.addEventListener('click', onSubmissionQueueClick);
  document.getElementById('dash-sub-review-btn')?.addEventListener('click', () => {
    document.querySelector('.nav-item[data-page="submissions"]')?.click();
  });

  // Submissions page quick-controls bar
  document.getElementById('sub-quick-save')?.addEventListener('click', async () => {
    const enabled    = document.getElementById('sub-quick-enabled')?.value === 'true';
    const fieldLabel = document.getElementById('sub-quick-field-label')?.value || 'Name';
    const requirePhoto = document.getElementById('sub-quick-require-photo')?.value === 'true';
    const wallEnabled  = document.getElementById('sub-quick-wall-enabled')?.value === 'true';
    try {
      await apiFetch('/api/submissions/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionEnabled: enabled, submissionFieldLabel: fieldLabel, submissionRequirePhoto: requirePhoto, submissionWallEnabled: wallEnabled }),
      });
      showToast('Submission settings updated');
    } catch (err) {
      showToast(err.message, true);
    }
  });

}

async function boot() {
  bindActions();
  window._loadAlertsAndSchedule = loadAlertsAndSchedule;
  window._loadSubmissions = loadSubmissions;
  await Promise.allSettled([loadAlertsAndSchedule(), loadSubmissions()]);

  setInterval(() => {
    loadAlertsAndSchedule().catch(() => {});
    loadSubmissions().catch(() => {});
  }, 12_000);
}

boot();
