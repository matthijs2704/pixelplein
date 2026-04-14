import {
  loadUsers,
  addUser,
  removeUser,
  loadOidcConfig,
  saveOidcConfig,
  disableOidc,
  loadMe,
} from '../api.js';
import { showToast as _toast } from '../app.js';
import { esc as _esc } from '/shared/utils.js';

let _getConfig = null;
let _onChanged = null;
let _currentUsername = '';

export function initSettingsTab(getConfig, onChanged) {
  _getConfig = getConfig;
  _onChanged = onChanged;
  _bind();
  _loadAuthSections();
}

export function refreshFromConfig() {
  const cfg = _getConfig?.();
  if (!cfg) return;

  _setVal('settings-event-name', cfg.eventName || '');
  _setVal('settings-public-base-url', cfg.publicBaseUrl || '');
  _setVal('settings-screen-count', cfg.screenCount || 2);
  _setVal('settings-display-width', cfg.displayWidth || 1920);
  _setVal('settings-display-height', cfg.displayHeight || 1080);
  _setVal('settings-health-interval', Math.round((cfg.healthBroadcastIntervalMs || 3000) / 1000));
  _setChecked('settings-transcode-videos', cfg.transcodeVideos ?? false);

  // Submissions settings
  _setVal('submissions-enabled',            String(cfg.submissionEnabled !== false));
  _setVal('submissions-field-label',        cfg.submissionFieldLabel || '');
  _setVal('submissions-require-photo',      String(Boolean(cfg.submissionRequirePhoto)));
  _setVal('submissions-wall-enabled',       String(cfg.submissionWallEnabled !== false));
  _setVal('submissions-display-mode',       cfg.submissionDisplayMode || 'both');
  _setVal('submissions-display-interval',   cfg.submissionDisplayIntervalSec ?? 45);
  _setVal('submissions-display-duration',   cfg.submissionDisplayDurationSec ?? 12);
  _setVal('submissions-grid-count',         cfg.submissionGridCount ?? 6);
  _setVal('submissions-wall-fresh-min',     cfg.submissionWallFreshForMin ?? 90);
  _setVal('submissions-wall-repeat-cycles', cfg.submissionWallRepeatAfterCycles ?? 3);
  _setVal('submissions-wall-min-approved',  cfg.submissionWallMinApproved ?? 2);
  _setVal('submissions-wall-show-qr',       String(cfg.submissionWallShowQr !== false));
  _setVal('submissions-wall-hide-empty',    String(cfg.submissionWallHideWhenEmpty !== false));
}

function _bind() {
  document.getElementById('settings-event-name')?.addEventListener('input', e => {
    const cfg = _getConfig();
    cfg.eventName = e.target.value;
    _onChanged?.();
  });

  document.getElementById('settings-public-base-url')?.addEventListener('input', e => {
    const cfg = _getConfig();
    cfg.publicBaseUrl = e.target.value;
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

  document.getElementById('settings-health-interval')?.addEventListener('input', e => {
    const cfg = _getConfig();
    const parsed = parseInt(e.target.value || '3', 10);
    const seconds = Number.isFinite(parsed) ? Math.max(1, Math.min(30, parsed)) : 3;
    cfg.healthBroadcastIntervalMs = seconds * 1000;
    _onChanged?.();
  });

  document.getElementById('settings-transcode-videos')?.addEventListener('change', e => {
    const cfg = _getConfig();
    cfg.transcodeVideos = e.target.checked;
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

  // Submissions settings bindings
  const subBoolSelects = [
    'submissions-enabled', 'submissions-require-photo',
    'submissions-wall-enabled', 'submissions-wall-show-qr', 'submissions-wall-hide-empty',
  ];
  const subBoolMap = {
    'submissions-enabled':        'submissionEnabled',
    'submissions-require-photo':  'submissionRequirePhoto',
    'submissions-wall-enabled':   'submissionWallEnabled',
    'submissions-wall-show-qr':   'submissionWallShowQr',
    'submissions-wall-hide-empty':'submissionWallHideWhenEmpty',
  };
  subBoolSelects.forEach(id => {
    document.getElementById(id)?.addEventListener('change', e => {
      const cfg = _getConfig();
      cfg[subBoolMap[id]] = e.target.value === 'true';
      _onChanged?.();
    });
  });

  document.getElementById('submissions-field-label')?.addEventListener('input', e => {
    const cfg = _getConfig();
    cfg.submissionFieldLabel = e.target.value;
    _onChanged?.();
  });

  document.getElementById('submissions-display-mode')?.addEventListener('change', e => {
    const cfg = _getConfig();
    cfg.submissionDisplayMode = e.target.value;
    _onChanged?.();
  });

  const subNumMap = {
    'submissions-display-interval':   ['submissionDisplayIntervalSec',   10, 300],
    'submissions-display-duration':   ['submissionDisplayDurationSec',    5, 120],
    'submissions-grid-count':         ['submissionGridCount',             3,  12],
    'submissions-wall-fresh-min':     ['submissionWallFreshForMin',       5, 1440],
    'submissions-wall-repeat-cycles': ['submissionWallRepeatAfterCycles', 0,  20],
    'submissions-wall-min-approved':  ['submissionWallMinApproved',       1,  20],
  };
  Object.entries(subNumMap).forEach(([id, [key, min, max]]) => {
    document.getElementById(id)?.addEventListener('input', e => {
      const cfg = _getConfig();
      const v = parseInt(e.target.value, 10);
      if (Number.isFinite(v)) cfg[key] = Math.max(min, Math.min(max, v));
      _onChanged?.();
    });
  });

  document.getElementById('btn-add-user')?.addEventListener('click', async () => {
    const username = _getVal('new-user-username').trim();
    const password = _getVal('new-user-password');
    if (!username) return _toast('Username is required', true);
    if (password.length < 8) return _toast('Password must be at least 8 characters', true);

    try {
      await addUser(username, password);
      _setVal('new-user-username', '');
      _setVal('new-user-password', '');
      _toast(`User ${username} added`);
      await _loadUsersSection();
    } catch (err) {
      _toast(err.message, true);
    }
  });

  document.getElementById('btn-save-oidc')?.addEventListener('click', async () => {
    const issuerUrl = _getVal('oidc-issuer').trim();
    const clientId = _getVal('oidc-client-id').trim();
    const clientSecret = _getVal('oidc-client-secret');
    const redirectUri = _getVal('oidc-redirect-uri').trim();
    const providerName = _getVal('oidc-provider-name').trim();
    const allowedEmails = _getVal('oidc-allowed-emails')
      .split('\n')
      .map(v => v.trim())
      .filter(Boolean);

    try {
      await saveOidcConfig({ issuerUrl, clientId, clientSecret, redirectUri, providerName, allowedEmails });
      _toast('OIDC configuration saved');
      await _loadOidcSection();
    } catch (err) {
      _toast(err.message, true);
    }
  });

  document.getElementById('btn-disable-oidc')?.addEventListener('click', async () => {
    try {
      await disableOidc();
      _toast('OIDC disabled');
      await _loadOidcSection();
    } catch (err) {
      _toast(err.message, true);
    }
  });
}

async function _loadAuthSections() {
  try {
    const me = await loadMe();
    _currentUsername = me?.username || '';
  } catch {
    _currentUsername = '';
  }

  await _loadUsersSection();
  await _loadOidcSection();
}

async function _loadUsersSection() {
  const listEl = document.getElementById('settings-users-list');
  if (!listEl) return;

  try {
    const res = await loadUsers();
    const users = Array.isArray(res?.users) ? res.users : [];
    if (!users.length) {
      listEl.innerHTML = '<div class="quick-hint">No local users configured.</div>';
      return;
    }

    listEl.innerHTML = users.map(u => {
      const self = _currentUsername && _currentUsername.toLowerCase() === String(u.username || '').toLowerCase();
      return `
        <div class="action-row" style="justify-content:space-between;border:1px solid var(--border);border-radius:8px;padding:8px 10px;background:var(--surface2)">
          <div style="font-size:13px">${_esc(u.username)}</div>
          <button class="btn btn-danger btn-sm" data-remove-user="${_esc(u.username)}" ${self ? 'disabled title="Cannot remove your own account"' : ''}>Remove</button>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-remove-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const username = btn.getAttribute('data-remove-user');
        try {
          await removeUser(username);
          _toast(`User ${username} removed`);
          await _loadUsersSection();
        } catch (err) {
          _toast(err.message, true);
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="quick-hint" style="color:var(--red)">${_esc(err.message || 'Failed to load users')}</div>`;
  }
}

async function _loadOidcSection() {
  try {
    const res = await loadOidcConfig();
    const oidc = res?.oidc;
    _setVal('oidc-issuer', oidc?.issuerUrl || '');
    _setVal('oidc-client-id', oidc?.clientId || '');
    _setVal('oidc-client-secret', oidc?.clientSecret || '');
    const callbackBase = _getConfig?.()?.publicBaseUrl || location.origin;
    _setVal('oidc-redirect-uri', oidc?.redirectUri || `${callbackBase}/api/auth/oidc/callback`);
    _setVal('oidc-provider-name', oidc?.providerName || '');
    _setVal('oidc-allowed-emails', Array.isArray(oidc?.allowedEmails) ? oidc.allowedEmails.join('\n') : '');

    const status = document.getElementById('oidc-status-label');
    if (status) status.textContent = oidc ? 'OIDC is configured' : 'OIDC is disabled';
  } catch (err) {
    _toast(`Failed to load OIDC config: ${err.message}`, true);
  }
}

function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = String(val ?? '');
}

function _setChecked(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = Boolean(val);
}

function _getVal(id) {
  return document.getElementById(id)?.value || '';
}
