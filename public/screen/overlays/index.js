// Overlay orchestrator: mounts/unmounts all overlays based on screen config.

import { mountTicker, removeTicker }   from './ticker.js';
import { mountBug, removeBug }         from './bug.js';
import { mountQrBug, removeQrBug }     from './qr-bug.js';
import { filterTickerMessages }        from './_overlay-utils.js';
import { setAlertSnapshot, showAlert, dismissAlert, clearAlerts, setBottomInset } from './alerts.js';
import {
  mountInfoBar,
  removeInfoBar,
  updateInfoBarSchedule,
  getInfoBarHeight,
} from './infobar.js';
import { getScreenCfg, resolveScreenConfig } from '../../../shared/utils.js';

/**
 * Returns the current bottom safe inset in pixels (info bar or standalone ticker).
 * 0 when nothing occupies the bottom edge.
 */
export function getBottomInset() {
  return getInfoBarHeight();
}

let _screenId = null;
let _schedule = [];

export function initOverlays(screenId) {
  _screenId = screenId;
}

/**
 * Apply overlay config for the given screen.
 * Tears down and recreates all overlays when config changes.
 */
export async function applyOverlays(config) {
  const rawCfg = getScreenCfg(config, _screenId);
  // Resolve null-inherit overlay fields from global defaults, then merge remaining globals
  const cfg = resolveScreenConfig(config, rawCfg);
  const cfgWithGlobals = { ...cfg, clock24h: config?.clock24h !== false, infoBarFontSize: config?.infoBarFontSize ?? 15 };

  let safeInsets = { top: 0, bottom: 0 };

  if (cfg.infoBarEnabled) {
    // Info bar takes over the bottom edge; standalone ticker is suppressed
    removeTicker();
    mountInfoBar(cfgWithGlobals, _schedule);
    safeInsets.bottom = getInfoBarHeight();
  } else {
    removeInfoBar();
    // Standalone ticker
    const _hasTickerContent = filterTickerMessages(cfg.tickerMessages).length > 0;
    if (cfg.tickerEnabled && _hasTickerContent) {
      mountTicker(cfg);
      const tickerEl = document.getElementById('overlay-ticker');
      const tickerHeight = tickerEl ? tickerEl.offsetHeight : 38;
      const pos = cfg.tickerPosition || 'bottom';
      if (pos === 'bottom') safeInsets.bottom = tickerHeight;
      else                  safeInsets.top    = tickerHeight;
    } else {
      removeTicker();
    }
  }

  // Corner bug (shift away from occupied edge)
  setBottomInset(safeInsets.bottom);

  if (cfg.bugEnabled && (cfg.bugText || cfg.bugImageUrl)) {
    mountBug(cfg, safeInsets);
  } else {
    removeBug();
  }

  // QR bug (shift away from occupied edge)
  if (cfg.qrBugEnabled && cfg.qrBugUrl) {
    await mountQrBug(cfg, safeInsets);
  } else {
    removeQrBug();
  }
}

export function removeAllOverlays() {
  removeTicker();
  removeInfoBar();
  removeBug();
  removeQrBug();
  clearAlerts();
}

/**
 * Update the event schedule — forwarded to the info bar.
 * @param {Array} schedule
 */
export function setSchedule(schedule) {
  _schedule = Array.isArray(schedule) ? schedule : [];
  updateInfoBarSchedule(_schedule);
}

export function setAlerts(alerts) {
  setAlertSnapshot(alerts);
}

export function pushAlert(alert) {
  showAlert(alert);
}

export function removeAlert(alertId) {
  dismissAlert(alertId);
}
