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

let _styleInjected = false;
const _active = new Map(); // alertId -> { alert, el, timeout }
let _countdownTimer = null;
let _bottomInset = 0;

function _ensureStyle() {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'overlay-alert-style';
  style.textContent = `
    .ov-alert {
      position: fixed;
      z-index: 9500;
      color: var(--alert-color, #ffffff);
      font-family: var(--alert-font-family, 'Segoe UI', system-ui, sans-serif);
      letter-spacing: 0.01em;
      pointer-events: none;
    }

    /* ── Banner ─────────────────────────────────────────────────────────── */

    .ov-alert.banner {
      padding: 12px 20px;
      border-radius: 10px;
      font-size: clamp(16px, 2vw, 26px);
      font-weight: 700;
      background: var(--alert-banner-bg, rgba(12, 22, 34, 0.92));
      border: 1px solid var(--alert-banner-border, rgba(255, 255, 255, 0.2));
    }

    /* Horizontal sizing / alignment */
    .ov-alert.banner.pos-h-center {
      left: 2vw;
      right: 2vw;
      text-align: center;
    }
    .ov-alert.banner.pos-h-left {
      left: 2vw;
      max-width: min(54vw, 820px);
      text-align: left;
    }
    .ov-alert.banner.pos-h-right {
      right: 2vw;
      max-width: min(54vw, 820px);
      text-align: right;
    }

    /* Vertical edge */
    .ov-alert.banner.pos-v-top    { top:    var(--ov-banner-top,    2vh); }
    .ov-alert.banner.pos-v-bottom { bottom: var(--ov-banner-bottom, 2vh); }

    /* ── Popup ───────────────────────────────────────────────────────────── */

    .ov-alert.popup {
      left: 50%;
      width: min(74vw, 980px);
      padding: clamp(20px, 3vw, 34px);
      border-radius: 16px;
      background: var(--alert-popup-bg, rgba(9, 18, 30, 0.94));
      border: 1px solid var(--alert-popup-border, rgba(255, 255, 255, 0.18));
      box-shadow: 0 28px 52px rgba(0, 0, 0, 0.45);
      text-align: center;
    }

    /* center (default) */
    .ov-alert.popup.pos-center {
      top: 50%;
      transform: translate(-50%, -50%);
    }
    /* top-center */
    .ov-alert.popup.pos-top-center {
      top: 8vh;
      transform: translateX(-50%);
    }
    /* bottom-center */
    .ov-alert.popup.pos-bottom-center {
      bottom: 8vh;
      transform: translateX(-50%);
    }

    /* ── Countdown ───────────────────────────────────────────────────────── */

    .ov-alert.countdown {
      min-width: min(36vw, 560px);
      padding: 14px 16px;
      border-radius: 12px;
      background: var(--alert-countdown-bg, rgba(7, 16, 28, 0.92));
      border: 1px solid var(--alert-countdown-border, rgba(255, 255, 255, 0.18));
      text-align: left;
    }

    .ov-alert.countdown.pos-top-right    { top:    2vh; right:  2vw; }
    .ov-alert.countdown.pos-top-left     { top:    2vh; left:   2vw; }
    .ov-alert.countdown.pos-bottom-right { bottom: 2vh; right:  2vw; }
    .ov-alert.countdown.pos-bottom-left  { bottom: 2vh; left:   2vw; }

    /* ── Shared content styles ───────────────────────────────────────────── */

    .ov-alert.urgent {
      box-shadow: 0 0 0 2px var(--alert-urgent-glow, rgba(255, 102, 102, 0.3)),
                  0 14px 28px rgba(0, 0, 0, 0.35);
    }

    .ov-alert .ov-alert-title {
      font-size: clamp(14px, 1.8vw, 22px);
      color: var(--alert-title-color, rgba(255, 255, 255, 0.75));
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      margin-bottom: 10px;
    }

    .ov-alert .ov-alert-message {
      font-size: clamp(24px, 4vw, 58px);
      line-height: 1.12;
      font-weight: 800;
    }

    .ov-alert.countdown .ov-alert-message {
      font-size: clamp(18px, 2.4vw, 34px);
      margin-bottom: 6px;
    }

    .ov-alert.countdown .ov-alert-time {
      font-size: clamp(28px, 3.6vw, 52px);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: var(--alert-countdown-time, #ffdca8);
    }

    /* ── Entry animations ────────────────────────────────────────────────── */

    .ov-alert.banner,
    .ov-alert.countdown {
      opacity: 0;
      animation: ov-alert-in-slide 260ms ease forwards;
    }

    .ov-alert.popup {
      opacity: 0;
    }

    /* Popup animations vary by vertical position */
    .ov-alert.popup.pos-center {
      animation: ov-alert-in-popup-center 280ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
    }
    .ov-alert.popup.pos-top-center {
      animation: ov-alert-in-popup-top 280ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
    }
    .ov-alert.popup.pos-bottom-center {
      animation: ov-alert-in-popup-bottom 280ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
    }

    /* ── Dismiss animations ──────────────────────────────────────────────── */

    .ov-alert.banner.ov-dismissing,
    .ov-alert.countdown.ov-dismissing {
      animation: ov-alert-out-slide 200ms ease forwards !important;
    }

    .ov-alert.popup.pos-center.ov-dismissing {
      animation: ov-alert-out-popup-center 200ms ease forwards !important;
    }
    .ov-alert.popup.pos-top-center.ov-dismissing {
      animation: ov-alert-out-popup-top 200ms ease forwards !important;
    }
    .ov-alert.popup.pos-bottom-center.ov-dismissing {
      animation: ov-alert-out-popup-bottom 200ms ease forwards !important;
    }

    /* ── Keyframes ───────────────────────────────────────────────────────── */

    @keyframes ov-alert-in-slide {
      from { opacity: 0; transform: translateY(-10px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @keyframes ov-alert-in-popup-center {
      from { opacity: 0; transform: translate(-50%, -50%) scale(0.94); }
      to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
    @keyframes ov-alert-in-popup-top {
      from { opacity: 0; transform: translateX(-50%) translateY(-10px) scale(0.95); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0)     scale(1); }
    }
    @keyframes ov-alert-in-popup-bottom {
      from { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.95); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1); }
    }

    @keyframes ov-alert-out-slide {
      from { opacity: 1; transform: translateY(0); }
      to   { opacity: 0; transform: translateY(-8px); }
    }
    @keyframes ov-alert-out-popup-center {
      from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      to   { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
    }
    @keyframes ov-alert-out-popup-top {
      from { opacity: 1; transform: translateX(-50%) translateY(0)     scale(1); }
      to   { opacity: 0; transform: translateX(-50%) translateY(-8px)  scale(0.96); }
    }
    @keyframes ov-alert-out-popup-bottom {
      from { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1); }
      to   { opacity: 0; transform: translateX(-50%) translateY(8px)  scale(0.96); }
    }
  `;
  document.head.appendChild(style);
}

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

function _formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function _buildEl(alert) {
  const style    = alert.style || 'banner';
  const posCls   = _positionClasses(style, alert.position);
  const urgentCls = alert.priority === 'urgent' ? 'urgent' : '';

  const el = document.createElement('div');
  el.className = ['ov-alert', style, urgentCls, ...posCls].filter(Boolean).join(' ');
  el.dataset.alertId = alert.id;

  if (style === 'banner') {
    el.textContent = alert.message || '';
    return el;
  }

  const title = document.createElement('div');
  title.className = 'ov-alert-title';
  title.textContent = alert.priority === 'urgent' ? 'urgent update' : 'event update';
  el.appendChild(title);

  const message = document.createElement('div');
  message.className = 'ov-alert-message';
  message.textContent = alert.message || '';
  el.appendChild(message);

  if (style === 'countdown') {
    const time = document.createElement('div');
    time.className = 'ov-alert-time';
    time.dataset.countdown = alert.countdownTo || '';
    time.textContent = '--:--';
    el.appendChild(time);
  }

  return el;
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
    timeEl.textContent = _formatDuration(remaining);
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
  _ensureStyle();
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
  el.addEventListener('animationend', () => el.remove(), { once: true });

  if (entry.alert.style === 'banner') {
    setTimeout(_reStackBanners, 210);
  }
}

export function setAlertSnapshot(alerts) {
  const incoming = Array.isArray(alerts) ? alerts : [];
  const ids = new Set(incoming.map(a => a.id));

  for (const id of Array.from(_active.keys())) {
    if (!ids.has(id)) dismissAlert(id);
  }

  for (const alert of incoming) {
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
