import { setPin, loadPinStatus, storePin } from '../api.js';
import { showToast as _toast } from '../app.js';

let _getConfig = null;
let _onChanged = null;
let _pinSet = false;

export function initSettingsTab(getConfig, onChanged) {
  _getConfig = getConfig;
  _onChanged = onChanged;
  _bind();
  _refreshPinStatus();
}

export function refreshFromConfig() {
  const cfg = _getConfig?.();
  if (!cfg) return;

  _setVal('settings-event-name', cfg.eventName || '');
  _setVal('settings-screen-count', cfg.screenCount || 2);
  _setVal('settings-display-width', cfg.displayWidth || 1920);
  _setVal('settings-display-height', cfg.displayHeight || 1080);
  _syncPinButtons();
  _refreshPinStatus();
}

function _bind() {
  document.getElementById('settings-event-name')?.addEventListener('input', e => {
    const cfg = _getConfig();
    cfg.eventName = e.target.value;
    _onChanged?.();
  });

  document.getElementById('settings-display-width')?.addEventListener('input', e => {
    const cfg = _getConfig();
    cfg.displayWidth = Math.max(320, parseInt(e.target.value || '1920', 10));
    _onChanged?.();
  });

  document.getElementById('settings-display-height')?.addEventListener('input', e => {
    const cfg = _getConfig();
    cfg.displayHeight = Math.max(240, parseInt(e.target.value || '1080', 10));
    _onChanged?.();
  });

  document.getElementById('settings-screen-count')?.addEventListener('change', e => {
    const cfg = _getConfig();
    const n = Math.max(1, Math.min(4, parseInt(e.target.value || '2', 10)));
    cfg.screenCount = n;
    if (!cfg.screens) cfg.screens = {};
    for (let i = 1; i <= n; i++) {
      const id = String(i);
      if (!cfg.screens[id]) cfg.screens[id] = {};
    }
    for (let i = n + 1; i <= 4; i++) {
      delete cfg.screens[String(i)];
    }
    window._applyScreenCount?.(n);
    _onChanged?.();
  });

  document.getElementById('btn-set-pin')?.addEventListener('click', async () => {
    const pin = _getVal('set-pin-new').trim();
    const confirmPin = _getVal('set-pin-confirm').trim();

    if (pin !== confirmPin) return _toast('PINs do not match', true);
    if (!/^\d{4,8}$/.test(pin)) return _toast('PIN must be 4-8 digits', true);

    try {
      await setPin(pin);
      storePin(pin);
      _pinSet = true;
      _syncPinButtons();
      _setVal('set-pin-new', '');
      _setVal('set-pin-confirm', '');
      _toast('Admin PIN set');
    } catch (err) {
      _toast(`PIN update failed: ${err.message}`, true);
    }
  });

  document.getElementById('btn-clear-pin')?.addEventListener('click', async () => {
    try {
      await setPin('');
      storePin('');
      _pinSet = false;
      _syncPinButtons();
      _setVal('set-pin-new', '');
      _setVal('set-pin-confirm', '');
      _toast('Admin PIN cleared');
    } catch (err) {
      _toast(`PIN clear failed: ${err.message}`, true);
    }
  });
}

async function _refreshPinStatus() {
  try {
    const res = await loadPinStatus();
    _pinSet = Boolean(res?.pinSet);
    _syncPinButtons();
  } catch {
    _pinSet = false;
    _syncPinButtons();
  }
}

function _syncPinButtons() {
  const clearBtn = document.getElementById('btn-clear-pin');
  const status = document.getElementById('pin-status-label');
  if (clearBtn) clearBtn.style.display = _pinSet ? '' : 'none';
  if (status) status.textContent = _pinSet ? 'PIN is currently set' : 'No PIN set';
}

function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = String(val ?? '');
}

function _getVal(id) {
  return document.getElementById(id)?.value || '';
}


