// Overlay: scheduled/manual alerts (banner, popup, countdown)

let _styleInjected = false;
const _active = new Map(); // alertId -> { alert, el, timeout }
let _countdownTimer = null;

function _ensureStyle() {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'overlay-alert-style';
  style.textContent = `
    .ov-alert {
      position: fixed;
      z-index: 920;
      color: var(--alert-color, #ffffff);
      font-family: var(--alert-font-family, 'Segoe UI', system-ui, sans-serif);
      letter-spacing: 0.01em;
      pointer-events: none;
      opacity: 0;
      transform: translateY(-6px);
      animation: ov-alert-in 240ms ease forwards;
    }

    .ov-alert.urgent {
      box-shadow: 0 0 0 2px rgba(255, 102, 102, 0.3), 0 14px 28px rgba(0, 0, 0, 0.35);
    }

    .ov-alert.banner {
      left: 2vw;
      right: 2vw;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: clamp(16px, 2vw, 26px);
      font-weight: 700;
      background: var(--alert-banner-bg, rgba(12, 22, 34, 0.92));
      border: 1px solid rgba(255, 255, 255, 0.2);
      text-align: center;
    }

    .ov-alert.banner.top { top: 2vh; }
    .ov-alert.banner.bottom { bottom: 2vh; }

    .ov-alert.popup {
      left: 50%;
      top: 50%;
      transform: translate(-50%, -45%);
      width: min(74vw, 980px);
      padding: clamp(20px, 3vw, 34px);
      border-radius: 16px;
      background: var(--alert-popup-bg, rgba(9, 18, 30, 0.94));
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 28px 52px rgba(0, 0, 0, 0.45);
      text-align: center;
    }

    .ov-alert .ov-alert-title {
      font-size: clamp(14px, 1.8vw, 22px);
      color: rgba(255, 255, 255, 0.8);
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

    .ov-alert.countdown {
      right: 2vw;
      top: 2vh;
      min-width: min(36vw, 560px);
      padding: 14px 16px;
      border-radius: 12px;
      background: var(--alert-countdown-bg, rgba(7, 16, 28, 0.92));
      border: 1px solid rgba(255, 255, 255, 0.18);
      text-align: left;
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

    @keyframes ov-alert-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

function _formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function _buildEl(alert) {
  const style = alert.style || 'banner';
  const el = document.createElement('div');
  el.className = `ov-alert ${style} ${alert.priority === 'urgent' ? 'urgent' : ''}`;
  el.dataset.alertId = alert.id;

  if (style === 'banner') {
    el.classList.add(alert.position === 'bottom' ? 'bottom' : 'top');
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

function _stopCountdownTimerIfIdle() {
  const hasCountdown = Array.from(_active.values()).some(entry => entry.alert.style === 'countdown');
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

function _applyLocalTimeout(entry) {
  const { alert } = entry;
  if ((alert.durationSec || 0) <= 0) return;
  const firedAt = Number(alert.firedAt || Date.now());
  const endAt = firedAt + (Number(alert.durationSec || 0) * 1000);
  const ms = Math.max(1000, endAt - Date.now());
  entry.timeout = setTimeout(() => {
    dismissAlert(alert.id);
  }, ms);
}

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

  _applyLocalTimeout(entry);
}

export function dismissAlert(alertId) {
  const id = String(alertId || '');
  const entry = _active.get(id);
  if (!entry) return;
  if (entry.timeout) clearTimeout(entry.timeout);
  entry.el.remove();
  _active.delete(id);
  _stopCountdownTimerIfIdle();
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
