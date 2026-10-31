// Overlay: scheduled/manual alerts (banner, popup, countdown)
//
// z-index 9500 — intentionally above theme frames (camp frame is z-index 9000/9001)
// so alerts always render on top of decorative overlays.
//
// Position values per style:
//   banner:    top-left | top-center | top-right
//              bottom-left | bottom-center | bottom-right
//   popup:     center (default) | top-center | bottom-center
//   countdown: top-right | top-left | bottom-right | bottom-left

import { fmtDuration, el } from '../../../shared/utils.js';
import { getModuleAlertRenderer } from '../module-registry.js';

const _active = new Map(); // alertId -> { alert, el, timeout }
let _countdownTimer = null;
let _bottomInset = 0;

/* ── Position helpers ─────────────────────────────────────────────────── */

/**
 * Resolve the position string into CSS classes.
 *
 * Banner classes: pos-v-top|pos-v-bottom  +  pos-h-left|pos-h-center|pos-h-right
 * Popup classes:  pos-center | pos-top-center | pos-bottom-center
 * Countdown:      pos-top-right | pos-top-left | pos-bottom-right | pos-bottom-left
 */
function _positionClasses(style, position) {
  const pos = String(position || '').toLowerCase();

  if (style === 'banner') {
    const v = pos.startsWith('bottom') ? 'pos-v-bottom' : 'pos-v-top';
    const h = pos.endsWith('left')  ? 'pos-h-left'
            : pos.endsWith('right') ? 'pos-h-right'
            : 'pos-h-center';
    return [v, h];
  }

  if (style === 'popup') {
    if (pos === 'top-center' || pos === 'top') return ['pos-top-center'];
    if (pos === 'bottom-center' || pos === 'bottom') return ['pos-bottom-center'];
    return ['pos-center'];
  }

  // countdown — floating corners
  const v = pos.startsWith('bottom') ? 'bottom' : 'top';
  const h = pos.endsWith('left') ? 'left' : 'right';
  return [`pos-${v}-${h}`];
}

/* ── Banner stacking ──────────────────────────────────────────────────── */

// Offset same-edge banners so they don't overlap.
function _reStackBanners() {
  const BANNER_GAP = 8;
  const byEdge = { top: [], bottom: [] };

  for (const entry of _active.values()) {
    if (entry.alert.style !== 'banner') continue;
    const pos = String(entry.alert.position || '');
    const edge = pos.startsWith('bottom') ? 'bottom' : 'top';
    byEdge[edge].push(entry);
  }

  for (const [edge, entries] of Object.entries(byEdge)) {
    // For the bottom edge, start above the safe inset (info bar / ticker).
    const baseInset = edge === 'bottom' ? _bottomInset : 0;
    let offset = 0;
    for (const entry of entries) {
      const val = baseInset > 0
        ? `calc(${baseInset}px + 2vh + ${offset}px)`
        : `calc(2vh + ${offset}px)`;
      entry.el.style.setProperty(`--ov-banner-${edge}`, val);
      offset += (entry.el.offsetHeight || 52) + BANNER_GAP;
    }
  }
}

/* ── Element builder ──────────────────────────────────────────────────── */

function _buildEl(alert) {
  // Module-registered renderer wins (matched by alert.type). It must return
  // an HTMLElement with [data-alert-id] set; the rest of this file treats it
  // opaquely.
  const moduleRender = alert.type && getModuleAlertRenderer(alert.type);
  if (moduleRender) {
    try {
      const node = moduleRender(alert);
      if (node instanceof HTMLElement) {
        if (!node.dataset.alertId) node.dataset.alertId = alert.id;
        if (!node.classList.contains('ov-alert')) node.classList.add('ov-alert');
        return node;
      }
    } catch (err) {
      console.warn('[modules] alert renderer threw:', alert.type, err && err.message);
    }
  }

  const style    = alert.style || 'banner';
  const posCls   = _positionClasses(style, alert.position);
  const urgentCls = alert.priority === 'urgent' ? 'urgent' : '';

  const cls = ['ov-alert', style, urgentCls, ...posCls].filter(Boolean).join(' ');

  if (style === 'banner') {
    return el('div', { cls, attrs: { 'data-alert-id': alert.id }, text: alert.message || '' });
  }

  const titleText = alert.priority === 'urgent' ? 'urgent update' : 'event update';
  const rootEl = el('div', { cls, attrs: { 'data-alert-id': alert.id } },
    el('div', { cls: 'ov-alert-title',   text: titleText }),
    el('div', { cls: 'ov-alert-message', text: alert.message || '' }),
  );

  if (style === 'countdown') {
    const timeEl = el('div', { cls: 'ov-alert-time', attrs: { 'data-countdown': alert.countdownTo || '' }, text: '--:--' });
    rootEl.appendChild(timeEl);
  }

  return rootEl;
}

/* ── Countdown ticker ─────────────────────────────────────────────────── */

function _stopCountdownTimerIfIdle() {
  const hasCountdown = Array.from(_active.values()).some(
    e => e.alert.style === 'countdown'
  );
  if (!hasCountdown && _countdownTimer) {
    clearInterval(_countdownTimer);
    _countdownTimer = null;
  }
}

function _refreshCountdowns() {
  const now = Date.now();
  for (const [alertId, entry] of _active.entries()) {
    if (entry.alert.style !== 'countdown') continue;
    const target = Number(new Date(entry.alert.countdownTo || ''));
    const timeEl = entry.el.querySelector('.ov-alert-time');
    if (!timeEl || !Number.isFinite(target)) continue;

    const remaining = target - now;
    if (remaining <= 0) {
      dismissAlert(alertId);
      continue;
    }
    timeEl.textContent = fmtDuration(remaining);
  }
  _stopCountdownTimerIfIdle();
}

function _ensureCountdownTimer() {
  if (_countdownTimer) return;
  _countdownTimer = setInterval(_refreshCountdowns, 500);
}

/* ── Duration timeout ─────────────────────────────────────────────────── */

function _applyLocalTimeout(entry) {
  const { alert } = entry;
  if ((alert.durationSec || 0) <= 0) return;
  const firedAt = Number(alert.firedAt || Date.now());
  const endAt   = firedAt + (Number(alert.durationSec || 0) * 1000);
  const ms      = Math.max(1000, endAt - Date.now());
  entry.timeout = setTimeout(() => dismissAlert(alert.id), ms);
}

/* ── Public API ───────────────────────────────────────────────────────── */

export function showAlert(alert) {
  if (!alert?.id) return;
  const existing = _active.get(alert.id);
  if (existing && Number(existing.alert.firedAt || 0) === Number(alert.firedAt || 0)) return;
  dismissAlert(alert.id);

  const el = _buildEl(alert);
  document.body.appendChild(el);

  const entry = { alert, el, timeout: null };
  _active.set(alert.id, entry);

  if (alert.style === 'countdown') {
    _refreshCountdowns();
    _ensureCountdownTimer();
  }

  if (alert.style === 'banner') {
    requestAnimationFrame(_reStackBanners);
  }

  _applyLocalTimeout(entry);
}

export function dismissAlert(alertId) {
  const id    = String(alertId || '');
  const entry = _active.get(id);
  if (!entry) return;

  if (entry.timeout) clearTimeout(entry.timeout);
  _active.delete(id);
  _stopCountdownTimerIfIdle();

  const el = entry.el;
  el.classList.add('ov-dismissing');
  let removed = false;
  const remove = () => { if (removed) return; removed = true; el.remove(); };
  el.addEventListener('animationend', remove, { once: true });
  // Backstop: module-rendered alerts may not have a dismiss animation, so
  // animationend would never fire. Remove after a short timeout regardless.
  setTimeout(remove, 600);

  if (entry.alert.style === 'banner') {
    setTimeout(_reStackBanners, 210);
  }
}

export function setAlertSnapshot(alerts) {
  const incoming = Array.isArray(alerts) ? alerts : [];
  const byId = new Map();
  for (const alert of incoming) {
    if (alert?.id) byId.set(alert.id, alert);
  }
  const ids = new Set(byId.keys());

  for (const id of Array.from(_active.keys())) {
    if (!ids.has(id)) dismissAlert(id);
  }

  for (const alert of byId.values()) {
    if (!alert?.active || alert.dismissed) continue;
    showAlert(alert);
  }
}

export function clearAlerts() {
  for (const id of Array.from(_active.keys())) {
    dismissAlert(id);
  }
}

/**
 * Set the bottom safe inset (info bar height) so bottom-edge banners
 * sit above the bar rather than underneath it.
 * @param {number} px
 */
export function setBottomInset(px) {
  _bottomInset = Number(px) || 0;
  const val = _bottomInset > 0 ? `calc(${_bottomInset}px + 2vh)` : '2vh';
  document.documentElement.style.setProperty('--ov-banner-bottom', val);
}
