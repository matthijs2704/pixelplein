// Overlay orchestrator: mounts/unmounts all overlays based on screen config.

import { mountTicker, removeTicker }   from './ticker.js';
import { mountBug, removeBug }         from './bug.js';
import { mountQrBug, removeQrBug }     from './qr-bug.js';

let _screenId = null;

export function initOverlays(screenId) {
  _screenId = screenId;
}

/**
 * Apply overlay config for the given screen.
 * Tears down and recreates all overlays when config changes.
 */
export async function applyOverlays(config) {
  const cfg = config?.screens?.[String(_screenId)] || config?.screens?.['1'] || {};

  // Ticker — mount first so we know which edge is occupied
  let safeInsets = { top: 0, bottom: 0 };

  if (cfg.tickerEnabled && cfg.tickerText) {
    mountTicker(cfg);
    const tickerEl = document.getElementById('overlay-ticker');
    const tickerHeight = tickerEl ? tickerEl.offsetHeight : 38;
    const pos = cfg.tickerPosition || 'bottom';
    if (pos === 'bottom') safeInsets.bottom = tickerHeight;
    else                  safeInsets.top    = tickerHeight;
  } else {
    removeTicker();
  }

  // Corner bug (shift away from ticker edge)
  if (cfg.bugEnabled && (cfg.bugText || cfg.bugImageUrl)) {
    mountBug(cfg, safeInsets);
  } else {
    removeBug();
  }

  // QR bug (shift away from ticker edge)
  if (cfg.qrBugEnabled && cfg.qrBugUrl) {
    await mountQrBug(cfg, safeInsets);
  } else {
    removeQrBug();
  }
}

export function removeAllOverlays() {
  removeTicker();
  removeBug();
  removeQrBug();
}
