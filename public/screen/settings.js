'use strict';

// ---------------------------------------------------------------------------
// In-screen settings overlay
// Press F12 to open. Shows server connection info, screen ID selector, admin QR.
// Communicates with the local provisioner (127.0.0.1:3987) if running.
// ---------------------------------------------------------------------------

const PROVISIONER_URL   = 'http://127.0.0.1:3987';
const AUTO_CLOSE_MS     = 60_000;
const QR_SIZE           = 200;

let _screenId     = '1';
let _closeTimer   = null;
let _overlayEl    = null;

export function initSettings(screenId) {
  _screenId = String(screenId || '1');

  _overlayEl = document.getElementById('settings-overlay');
  if (!_overlayEl) return;

  document.addEventListener('keydown', e => {
    if (e.key === 'F12') {
      e.preventDefault();
      _isOpen() ? _close() : _open();
    }
    if (e.key === 'Escape' && _isOpen()) _close();
  });
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

function _isOpen() {
  return _overlayEl && !_overlayEl.classList.contains('settings-hidden');
}

function _close() {
  clearTimeout(_closeTimer);
  _overlayEl.classList.add('settings-hidden');
}

async function _open() {
  clearTimeout(_closeTimer);
  _overlayEl.classList.remove('settings-hidden');
  _overlayEl.innerHTML = '<div class="settings-card"><p class="settings-loading">Laden…</p></div>';

  const [info, provisioner] = await Promise.all([
    _fetchInfo(),
    _fetchProvisioner(),
  ]);

  // When running on localhost the origin is useless for phone scanning —
  // substitute the real LAN IP. If already on a real IP/domain, keep it.
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const adminBase = (isLocal && info?.lanIps?.length)
    ? `http://${info.lanIps[0]}:${info.port || 3000}`
    : location.origin;
  const qrSrc = await _buildQr(`${adminBase}/admin`);

  _render(info, provisioner, qrSrc);
  _closeTimer = setTimeout(_close, AUTO_CLOSE_MS);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function _render(info, provisioner, qrSrc) {
  const ips = info?.lanIps?.length
    ? info.lanIps.join('  ·  ')
    : location.hostname;

  const screenButtons = [1, 2, 3, 4].map(n => {
    const active = String(n) === _screenId;
    return `<button class="settings-screen-btn${active ? ' active' : ''}" data-screen="${n}">${n}</button>`;
  }).join('');

  const provisionerSection = provisioner
    ? `<a class="settings-link" href="${PROVISIONER_URL}" target="_blank">Setup opnieuw (provisioner)</a>`
    : '';

  _overlayEl.innerHTML = `
    <div class="settings-card" id="settings-card-inner">
      <button class="settings-close" id="settings-close-btn" aria-label="Sluiten">✕</button>

      <div class="settings-section">
        <div class="settings-label">Server</div>
        <div class="settings-value settings-mono">${_esc(location.origin)}</div>
      </div>

      ${ips ? `<div class="settings-section">
        <div class="settings-label">LAN IP's</div>
        <div class="settings-value settings-mono">${_esc(ips)}</div>
      </div>` : ''}

      <div class="settings-section">
        <div class="settings-label">Scherm ID</div>
        <div class="settings-screen-btns">${screenButtons}</div>
      </div>

      ${qrSrc ? `<div class="settings-section settings-qr-section">
        <div class="settings-label">Admin QR</div>
        <img class="settings-qr" src="${qrSrc}" alt="QR code admin" width="${QR_SIZE}" height="${QR_SIZE}">
      </div>` : ''}

      <div class="settings-footer">
        ${provisionerSection}
        <span class="settings-muted">Sluit: Escape of F12 · Auto-sluit na 60 s</span>
      </div>
    </div>
  `;

  document.getElementById('settings-close-btn')?.addEventListener('click', _close);

  _overlayEl.querySelectorAll('.settings-screen-btn').forEach(btn => {
    btn.addEventListener('click', () => _switchScreen(btn.dataset.screen));
  });

  _overlayEl.addEventListener('click', e => {
    if (e.target === _overlayEl) _close();
  });
}

// ---------------------------------------------------------------------------
// Screen ID switch
// ---------------------------------------------------------------------------

async function _switchScreen(newId) {
  if (String(newId) === _screenId) return;

  // Try to persist via provisioner first
  const prov = await _fetchProvisioner();
  if (prov?.config) {
    try {
      await fetch(`${PROVISIONER_URL}/api/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prov.config, screenId: String(newId) }),
      });
    } catch {
      // provisioner unreachable — just navigate
    }
  }

  const url = new URL(location.href);
  url.searchParams.set('screen', newId);
  location.href = url.toString();
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function _fetchInfo() {
  try {
    const r = await fetch('/api/screens/info');
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

async function _fetchProvisioner() {
  try {
    const r = await fetch(`${PROVISIONER_URL}/api/status`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

async function _buildQr(url) {
  try {
    const r = await fetch(`/api/slides/qr?url=${encodeURIComponent(url)}&size=${QR_SIZE}`);
    if (!r.ok) return null;
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
