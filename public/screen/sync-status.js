// Two-phase sync progress display for the screen player.
//
// Phase 1 — waiting screen:
//   A progress block (#sync-progress) is injected inside #waiting showing a
//   bar, photo count, and approximate download speed.
//
// Phase 2 — compact overlay:
//   Once the photo cycle starts (hideWaiting is called from app.js), the same
//   data is shown in a small corner panel (#sync-status) until sync_complete.

import { getPreloadStats }      from './preload.js';
import { getSlidePreloadStats } from './slide-preload.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _total              = 0;     // total photos the server is sending (from photo_batch progress)
let _metaSent           = 0;     // how many metadata records received so far
let _done               = false;
let _pollTimer          = null;
let _cycleStarted       = false;
let _offlineBadgeShowing = false;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function _getOverlay() {
  return document.getElementById('sync-status');
}

function _getOrCreateWaitingBlock() {
  let el = document.getElementById('sync-progress');
  if (el) return el;

  const waiting = document.getElementById('waiting');
  if (!waiting) return null;

  el = document.createElement('div');
  el.id = 'sync-progress';
  el.innerHTML = `
    <div class="sync-progress-row">
      <span class="sync-progress-label">Syncing</span>
      <span>
        <span class="sync-progress-count" id="sp-count">–</span>
        <span class="sync-progress-speed" id="sp-speed"></span>
      </span>
    </div>
    <div class="sync-bar-track"><div class="sync-bar-fill" id="sp-bar"></div></div>
  `;
  waiting.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// Public API — called by app.js
// ---------------------------------------------------------------------------

/**
 * Called on every photo_batch progress update.
 * @param {number} sent   photos received so far
 * @param {number} total  total photos the server will send
 */
export function showSyncStatus(sent, total) {
  _metaSent = Number(sent)  || 0;
  _total    = Number(total) || 0;
  _done     = false;

  if (!_pollTimer) _startPolling();

  // Ensure waiting-screen block is visible
  const block = _getOrCreateWaitingBlock();
  if (block) block.classList.add('visible');

  _render();
}

/** Called on sync_complete — let the progress reach 100 % then fade out. */
export function hideSyncStatus() {
  _done = true;
  _render(); // push to 100 %
  setTimeout(() => {
    _stopPolling();
    // Don't hide the overlay if the offline badge took over in the meantime
    if (!_offlineBadgeShowing) {
      const overlay = _getOverlay();
      if (overlay) overlay.classList.remove('visible');
    }
    // waiting-screen block fades with #waiting itself
  }, 800);
}

/**
 * Immediately stop any in-progress sync display.
 * Used when the WS closes so the offline badge can take over cleanly.
 */
export function resetSyncStatus() {
  _done = true;
  _stopPolling();
  const overlay = _getOverlay();
  if (overlay) overlay.classList.remove('visible');
}

/** Called by app.js when the photo cycle starts (waiting screen hides). */
export function onCycleStarted() {
  _cycleStarted = true;
  // If still syncing, switch to compact overlay mode
  if (!_done) {
    const overlay = _getOverlay();
    if (overlay) overlay.classList.add('visible');
    _render();
  }
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 500;

function _startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(_render, POLL_INTERVAL_MS);
}

function _stopPolling() {
  clearInterval(_pollTimer);
  _pollTimer = null;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function _render() {
  const photoStats = getPreloadStats();
  const slideStats = getSlidePreloadStats();

  // Combined totals across photos and slide assets
  const photoTotal = Math.max(_total, photoStats.total);
  const slideTotal = slideStats.total;
  const combined   = photoTotal + slideTotal;
  const knownTotal = Math.max(combined, 1);
  const preloaded  = photoStats.preloaded + slideStats.preloaded;

  const pct = _done
    ? 100
    : Math.min(100, Math.round((preloaded / knownTotal) * 100));

  // Label: show photos + slides breakdown when both are non-zero
  let countText;
  if (_done) {
    countText = `${photoStats.preloaded} photos`;
    if (slideTotal > 0) countText += ` · ${slideStats.preloaded} slides`;
  } else if (slideTotal > 0) {
    countText = `${photoStats.preloaded}/${photoTotal} photos · ${slideStats.preloaded}/${slideTotal} slides`;
  } else {
    countText = `${photoStats.preloaded} / ${photoTotal}`;
  }

  // Use the faster of the two speed readings
  const bytesPerSec = Math.max(photoStats.bytesPerSec, slideStats.bytesPerSec);
  const speedText = _fmtSpeed(bytesPerSec);

  // Phase 1: waiting-screen block
  if (!_cycleStarted) {
    _setTextById('sp-count', countText);
    _setTextById('sp-speed', speedText ? `· ${speedText}` : '');
    _setBarById('sp-bar', pct);
  }

  // Phase 2: compact overlay
  if (_cycleStarted) {
    const overlay = _getOverlay();
    if (!overlay) return;

    // Build / update overlay internals lazily
    if (!overlay.querySelector('.sync-status-bar-track')) {
      overlay.innerHTML = `
        <div class="sync-status-row">
          <span class="sync-status-label">Caching</span>
          <span class="sync-status-count" id="ss-count">–</span>
          <span class="sync-status-speed" id="ss-speed"></span>
        </div>
        <div class="sync-status-bar-track">
          <div class="sync-status-bar-fill" id="ss-bar"></div>
        </div>
      `;
    }

    _setTextById('ss-count', countText);
    _setTextById('ss-speed', speedText);
    _setBarById('ss-bar', pct);
  }
}

// ---------------------------------------------------------------------------
// Offline badge — shown when the WS is down but cycle runs from cache
// ---------------------------------------------------------------------------

export function showOfflineBadge() {
  _offlineBadgeShowing = true;
  _cycleStarted = true; // ensure we use the overlay, not the waiting block
  const overlay = _getOverlay();
  if (!overlay) return;
  overlay.innerHTML = `
    <div class="sync-status-row">
      <span class="sync-status-label">Offline</span>
      <span class="sync-status-count" style="color:rgba(255,200,80,0.9)">Using cached photos</span>
    </div>
  `;
  overlay.classList.add('visible');
}

export function hideOfflineBadge() {
  _offlineBadgeShowing = false;
  const overlay = _getOverlay();
  if (overlay) overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _fmtSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 1024) return '';
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function _setTextById(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _setBarById(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = pct + '%';
}
