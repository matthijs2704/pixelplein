// Admin tab: Overlays — global defaults + per-screen overlay overrides

import { activeScreenIds as _activeScreenIds, resolveScreenConfig, OVERLAY_KEYS } from '/shared/utils.js';

let _getConfig = null;
let _onChanged = null;

export function initOverlaysTab(getConfig, onChanged) {
  _getConfig = getConfig;
  _onChanged = onChanged;
  _renderForms();
  _bindControls();
  const cfg = _getConfig?.();
  if (cfg) _applyGlobalToForm(cfg);
}

export function refreshOverlaysTab() {
  refreshFromConfig();
}

export function refreshFromConfig() {
  if (!_getConfig) return;
  const cfg = _getConfig();

  // If the user is actively editing an overlay field, skip the full DOM
  // replacement so their in-progress input is not wiped by a push update.
  const overlaysRoot = document.getElementById('overlays-grid');
  const focused = overlaysRoot && overlaysRoot.contains(document.activeElement);
  if (!focused) {
    _renderForms();
    _bindControls();
  }

  _applyGlobalToForm(cfg);

  for (const id of _activeScreenIds(cfg)) {
    _applyToForm(id, cfg.screens[id] || {}, cfg);
  }
}

// ── Per-screen overlay forms ──────────────────────────────────────────────

function _renderForms() {
  const root = document.getElementById('overlays-grid');
  const cfg = _getConfig?.();
  if (!root || !cfg) return;

  root.innerHTML = _activeScreenIds(cfg).map(id => _buildOverlayForm(id, cfg)).join('');
}

// The overlay sections that can be toggled between global/override
const OVERLAY_SECTIONS = ['ticker', 'bug', 'qrbug', 'infobar'];

// Map section → overlay keys that belong to it
const SECTION_KEYS = {
  ticker:  ['tickerEnabled', 'tickerMessages', 'tickerMode', 'tickerAlign', 'tickerPosition', 'tickerSpeed', 'tickerFadeDwellSec'],
  bug:     ['bugEnabled', 'bugText', 'bugCorner', 'bugImageUrl'],
  qrbug:   ['qrBugEnabled', 'qrBugUrl', 'qrBugCorner', 'qrBugLabel'],
  infobar: ['infoBarEnabled', 'infoBarShowClock', 'infoBarShowCurrentEvent', 'infoBarShowNextEvent'],
};

// Check if all keys in a section are null (inheriting)
function _sectionIsInheriting(sc, section) {
  return SECTION_KEYS[section].every(key => sc[key] === null || sc[key] === undefined);
}

function _buildOverlayForm(screenId, cfg) {
  const prefix = `s${screenId}`;
  const sc = cfg.screens?.[screenId] || {};

  const _inheritToggle = (section, label) => {
    const inheriting = _sectionIsInheriting(sc, section);
    return `
      <div class="check-row" style="margin-bottom:8px">
        <input type="checkbox" id="ov-${prefix}-${section}-inherit" ${inheriting ? 'checked' : ''}>
        <label for="ov-${prefix}-${section}-inherit">Use global defaults</label>
      </div>`;
  };

  return `
    <div>
      <div class="section-label">Screen ${screenId}</div>

      <details class="section" open>
        <summary>Ticker</summary>
        <div class="section-body">
          ${_inheritToggle('ticker')}
          <div id="ov-${prefix}-ticker-fields" class="${_sectionIsInheriting(sc, 'ticker') ? 'overlay-inherited' : ''}">
            <div class="check-row">
              <input type="checkbox" id="ov-${prefix}-ticker-enabled">
              <label for="ov-${prefix}-ticker-enabled">Enabled</label>
            </div>
            <div class="field">
              <label>Messages</label>
              <div id="ov-${prefix}-ticker-messages" style="display:flex;flex-direction:column;gap:6px"></div>
              <button type="button" class="btn btn-secondary btn-sm" id="ov-${prefix}-ticker-add-msg" style="margin-top:6px;width:auto">+ Add message</button>
            </div>
            <div class="two-col">
              <div class="field">
                <label for="ov-${prefix}-ticker-mode">Mode</label>
                <select id="ov-${prefix}-ticker-mode">
                  <option value="scroll">Scroll (continuous)</option>
                  <option value="fade">Fade (one at a time)</option>
                </select>
              </div>
              <div class="field" id="ov-${prefix}-ticker-dwell-wrap">
                <label for="ov-${prefix}-ticker-dwell">Dwell time (seconds)</label>
                <input type="number" id="ov-${prefix}-ticker-dwell" min="1" max="60" step="1" value="5">
              </div>
            </div>
            <div class="field" id="ov-${prefix}-ticker-align-wrap">
              <label for="ov-${prefix}-ticker-align">Alignment</label>
              <select id="ov-${prefix}-ticker-align">
                <option value="start">Left</option>
                <option value="center">Center</option>
                <option value="end">Right</option>
              </select>
            </div>
            <div class="two-col">
              <div class="field">
                <label for="ov-${prefix}-ticker-position">Position</label>
                <select id="ov-${prefix}-ticker-position">
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                </select>
              </div>
              <div class="field">
                <label for="ov-${prefix}-ticker-speed">Scroll speed (px/s)</label>
                <input type="number" id="ov-${prefix}-ticker-speed" min="10" max="400" step="10" value="80">
              </div>
            </div>
          </div>
        </div>
      </details>

      <details class="section">
        <summary>Corner Bug (text / logo)</summary>
        <div class="section-body">
          ${_inheritToggle('bug')}
          <div id="ov-${prefix}-bug-fields" class="${_sectionIsInheriting(sc, 'bug') ? 'overlay-inherited' : ''}">
            <div class="check-row">
              <input type="checkbox" id="ov-${prefix}-bug-enabled">
              <label for="ov-${prefix}-bug-enabled">Enabled</label>
            </div>
            <div class="field">
              <label for="ov-${prefix}-bug-text">Text (e.g. #MyEvent)</label>
              <input type="text" id="ov-${prefix}-bug-text" placeholder="#MyEvent">
            </div>
            <div class="field">
              <label for="ov-${prefix}-bug-image">Image URL (optional)</label>
              <input type="text" id="ov-${prefix}-bug-image" placeholder="/slide-assets/logo.png">
            </div>
            <div class="field">
              <label for="ov-${prefix}-bug-corner">Corner</label>
              <select id="ov-${prefix}-bug-corner">
                <option value="top-left">Top Left</option>
                <option value="top-right">Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-right">Bottom Right</option>
              </select>
            </div>
          </div>
        </div>
      </details>

      <details class="section">
        <summary>QR Corner Widget</summary>
        <div class="section-body">
          ${_inheritToggle('qrbug')}
          <div id="ov-${prefix}-qrbug-fields" class="${_sectionIsInheriting(sc, 'qrbug') ? 'overlay-inherited' : ''}">
            <div class="check-row">
              <input type="checkbox" id="ov-${prefix}-qrbug-enabled">
              <label for="ov-${prefix}-qrbug-enabled">Enabled</label>
            </div>
            <div class="field">
              <label for="ov-${prefix}-qrbug-url">URL to encode</label>
              <input type="text" id="ov-${prefix}-qrbug-url" placeholder="${_getConfig?.()?.publicBaseUrl ? _getConfig().publicBaseUrl + '/submit' : 'https://...'}">
            </div>
            <div class="field">
              <label for="ov-${prefix}-qrbug-label">Label (optional)</label>
              <input type="text" id="ov-${prefix}-qrbug-label" placeholder="Scan me!">
            </div>
            <div class="field">
              <label for="ov-${prefix}-qrbug-corner">Corner</label>
              <select id="ov-${prefix}-qrbug-corner">
                <option value="top-left">Top Left</option>
                <option value="top-right">Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-right">Bottom Right</option>
              </select>
            </div>
          </div>
        </div>
      </details>

      <details class="section">
        <summary>Info Bar</summary>
        <div class="section-body">
          ${_inheritToggle('infobar')}
          <div id="ov-${prefix}-infobar-fields" class="${_sectionIsInheriting(sc, 'infobar') ? 'overlay-inherited' : ''}">
            <div class="check-row">
              <input type="checkbox" id="ov-${prefix}-infobar-enabled">
              <label for="ov-${prefix}-infobar-enabled">Enabled</label>
            </div>
            <div class="check-row">
              <input type="checkbox" id="ov-${prefix}-infobar-clock">
              <label for="ov-${prefix}-infobar-clock">Show clock</label>
            </div>
            <div class="check-row">
              <input type="checkbox" id="ov-${prefix}-infobar-current-event">
              <label for="ov-${prefix}-infobar-current-event">Show current event</label>
            </div>
            <div class="check-row">
              <input type="checkbox" id="ov-${prefix}-infobar-next-event">
              <label for="ov-${prefix}-infobar-next-event">Show next event</label>
            </div>
            <p class="field-hint">When enabled, the ticker integrates into the bar rather than appearing as a separate strip.</p>
          </div>
        </div>
      </details>
    </div>
  `;
}

function _applyToForm(screenId, sc, cfg) {
  const prefix = `s${screenId}`;
  // Resolve values for display (null → global default)
  const resolved = resolveScreenConfig(cfg, sc);

  // Update inherit toggles and field container states
  for (const section of OVERLAY_SECTIONS) {
    const inheriting = _sectionIsInheriting(sc, section);
    _setChk(`ov-${prefix}-${section}-inherit`, inheriting);
    const fieldsEl = document.getElementById(`ov-${prefix}-${section}-fields`);
    if (fieldsEl) {
      fieldsEl.classList.toggle('overlay-inherited', inheriting);
    }
  }

  // Apply resolved values to form fields (shows inherited values when inheriting)
  _setChk(`ov-${prefix}-ticker-enabled`, resolved.tickerEnabled || false);
  _setVal(`ov-${prefix}-ticker-position`, resolved.tickerPosition || 'bottom');
  _setVal(`ov-${prefix}-ticker-speed`, resolved.tickerSpeed ?? 60);
  _setVal(`ov-${prefix}-ticker-mode`, resolved.tickerMode || 'scroll');
  _setVal(`ov-${prefix}-ticker-align`, ['start', 'center', 'end'].includes(resolved.tickerAlign) ? resolved.tickerAlign : 'start');
  _setVal(`ov-${prefix}-ticker-dwell`, resolved.tickerFadeDwellSec ?? 5);

  // Rebuild message rows
  const msgs = Array.isArray(resolved.tickerMessages) ? resolved.tickerMessages : [];
  _renderMessageRows(prefix, msgs);

  // Show/hide fade-only fields based on current mode
  _syncFadeModeFields(prefix);

  _setChk(`ov-${prefix}-bug-enabled`, resolved.bugEnabled || false);
  _setVal(`ov-${prefix}-bug-text`, resolved.bugText || '');
  _setVal(`ov-${prefix}-bug-corner`, resolved.bugCorner || 'top-right');
  _setVal(`ov-${prefix}-bug-image`, resolved.bugImageUrl || '');

  _setChk(`ov-${prefix}-qrbug-enabled`, resolved.qrBugEnabled || false);
  _setVal(`ov-${prefix}-qrbug-url`, resolved.qrBugUrl || '');
  _setVal(`ov-${prefix}-qrbug-corner`, resolved.qrBugCorner || 'bottom-right');
  _setVal(`ov-${prefix}-qrbug-label`, resolved.qrBugLabel || '');

  _setChk(`ov-${prefix}-infobar-enabled`, resolved.infoBarEnabled || false);
  _setChk(`ov-${prefix}-infobar-clock`, resolved.infoBarShowClock !== false);
  _setChk(`ov-${prefix}-infobar-current-event`, resolved.infoBarShowCurrentEvent !== false);
  _setChk(`ov-${prefix}-infobar-next-event`, resolved.infoBarShowNextEvent !== false);
}

// ── Global overlay defaults form ──────────────────────────────────────────

function _applyGlobalToForm(cfg) {
  // Clock & info bar font size
  _setChk('ov-global-clock24h', cfg.clock24h !== false);
  _setVal('ov-global-infobar-font-size', cfg.infoBarFontSize ?? 15);

  // Global overlay defaults
  _setChk('ov-global-ticker-enabled', cfg.tickerEnabled || false);
  _setVal('ov-global-ticker-mode', cfg.tickerMode || 'scroll');
  _setVal('ov-global-ticker-align', ['start', 'center', 'end'].includes(cfg.tickerAlign) ? cfg.tickerAlign : 'start');
  _setVal('ov-global-ticker-dwell', cfg.tickerFadeDwellSec ?? 5);
  _setVal('ov-global-ticker-position', cfg.tickerPosition || 'bottom');
  _setVal('ov-global-ticker-speed', cfg.tickerSpeed ?? 60);
  _renderGlobalMessageRows(Array.isArray(cfg.tickerMessages) ? cfg.tickerMessages : []);
  _syncGlobalFadeModeFields();

  _setChk('ov-global-bug-enabled', cfg.bugEnabled || false);
  _setVal('ov-global-bug-text', cfg.bugText || '');
  _setVal('ov-global-bug-image', cfg.bugImageUrl || '');
  _setVal('ov-global-bug-corner', cfg.bugCorner || 'top-right');

  _setChk('ov-global-qrbug-enabled', cfg.qrBugEnabled || false);
  _setVal('ov-global-qrbug-url', cfg.qrBugUrl || '');
  _setVal('ov-global-qrbug-label', cfg.qrBugLabel || '');
  _setVal('ov-global-qrbug-corner', cfg.qrBugCorner || 'bottom-right');

  _setChk('ov-global-infobar-enabled', cfg.infoBarEnabled || false);
  _setChk('ov-global-infobar-clock', cfg.infoBarShowClock !== false);
  _setChk('ov-global-infobar-current-event', cfg.infoBarShowCurrentEvent !== false);
  _setChk('ov-global-infobar-next-event', cfg.infoBarShowNextEvent !== false);

  // Alert defaults
  _setVal('ov-global-alert-style', cfg.alertStyle || 'banner');
  _setVal('ov-global-alert-position', cfg.alertPosition || 'top-center');
  _setVal('ov-global-alert-duration', cfg.alertDurationSec ?? 18);

  // Schedule alert defaults
  _setVal('ov-global-sched-style', cfg.scheduleAlertStyle || 'banner');
  _setVal('ov-global-sched-position', cfg.scheduleAlertPosition || 'top-center');
  _setVal('ov-global-sched-duration', cfg.scheduleAlertDurationSec ?? 18);
}

function _readGlobal() {
  if (!_getConfig) return;
  const cfg = _getConfig();

  // Clock & font size
  cfg.clock24h = _getChk('ov-global-clock24h');
  cfg.infoBarFontSize = parseInt(_getVal('ov-global-infobar-font-size') || '15', 10);

  // Global overlay defaults
  cfg.tickerEnabled      = _getChk('ov-global-ticker-enabled');
  cfg.tickerMessages     = _getGlobalMessageRows();
  cfg.tickerMode         = _getVal('ov-global-ticker-mode');
  cfg.tickerAlign        = _getVal('ov-global-ticker-align');
  cfg.tickerFadeDwellSec = parseInt(_getVal('ov-global-ticker-dwell') || '5', 10);
  cfg.tickerPosition     = _getVal('ov-global-ticker-position');
  cfg.tickerSpeed        = parseInt(_getVal('ov-global-ticker-speed') || '60', 10);

  cfg.bugEnabled   = _getChk('ov-global-bug-enabled');
  cfg.bugText      = _getVal('ov-global-bug-text');
  cfg.bugCorner    = _getVal('ov-global-bug-corner');
  cfg.bugImageUrl  = _getVal('ov-global-bug-image');

  cfg.qrBugEnabled = _getChk('ov-global-qrbug-enabled');
  cfg.qrBugUrl     = _getVal('ov-global-qrbug-url');
  cfg.qrBugCorner  = _getVal('ov-global-qrbug-corner');
  cfg.qrBugLabel   = _getVal('ov-global-qrbug-label');

  cfg.infoBarEnabled          = _getChk('ov-global-infobar-enabled');
  cfg.infoBarShowClock        = _getChk('ov-global-infobar-clock');
  cfg.infoBarShowCurrentEvent = _getChk('ov-global-infobar-current-event');
  cfg.infoBarShowNextEvent    = _getChk('ov-global-infobar-next-event');

  // Alert defaults
  cfg.alertStyle       = _getVal('ov-global-alert-style');
  cfg.alertPosition    = _getVal('ov-global-alert-position');
  cfg.alertDurationSec = parseInt(_getVal('ov-global-alert-duration') || '18', 10);

  // Schedule alert defaults
  cfg.scheduleAlertStyle       = _getVal('ov-global-sched-style');
  cfg.scheduleAlertPosition    = _getVal('ov-global-sched-position');
  cfg.scheduleAlertDurationSec = parseInt(_getVal('ov-global-sched-duration') || '18', 10);

  _onChanged?.();
}

// ── Per-screen read ───────────────────────────────────────────────────────

function _readScreen(prefix) {
  const screenId = prefix.slice(1); // strip leading 's'
  if (!_getConfig) return;
  const cfg = _getConfig();
  const sc = cfg.screens?.[screenId];
  if (!sc) return;

  // For each overlay section, check if inheriting
  for (const section of OVERLAY_SECTIONS) {
    const inheriting = _getChk(`ov-${prefix}-${section}-inherit`);
    if (inheriting) {
      // Set all keys in this section to null (inherit from global)
      for (const key of SECTION_KEYS[section]) {
        sc[key] = null;
      }
    } else {
      // Read explicit values from form
      _readSectionValues(prefix, section, sc);
    }
  }

  _onChanged?.();
}

function _readSectionValues(prefix, section, sc) {
  if (section === 'ticker') {
    sc.tickerEnabled      = _getChk(`ov-${prefix}-ticker-enabled`);
    sc.tickerMessages     = _getMessageRows(prefix);
    sc.tickerMode         = _getVal(`ov-${prefix}-ticker-mode`);
    sc.tickerAlign        = _getVal(`ov-${prefix}-ticker-align`);
    sc.tickerFadeDwellSec = parseInt(_getVal(`ov-${prefix}-ticker-dwell`) || '5', 10);
    sc.tickerPosition     = _getVal(`ov-${prefix}-ticker-position`);
    sc.tickerSpeed        = parseInt(_getVal(`ov-${prefix}-ticker-speed`) || '60', 10);
  } else if (section === 'bug') {
    sc.bugEnabled   = _getChk(`ov-${prefix}-bug-enabled`);
    sc.bugText      = _getVal(`ov-${prefix}-bug-text`);
    sc.bugCorner    = _getVal(`ov-${prefix}-bug-corner`);
    sc.bugImageUrl  = _getVal(`ov-${prefix}-bug-image`);
  } else if (section === 'qrbug') {
    sc.qrBugEnabled = _getChk(`ov-${prefix}-qrbug-enabled`);
    sc.qrBugUrl     = _getVal(`ov-${prefix}-qrbug-url`);
    sc.qrBugCorner  = _getVal(`ov-${prefix}-qrbug-corner`);
    sc.qrBugLabel   = _getVal(`ov-${prefix}-qrbug-label`);
  } else if (section === 'infobar') {
    sc.infoBarEnabled          = _getChk(`ov-${prefix}-infobar-enabled`);
    sc.infoBarShowClock        = _getChk(`ov-${prefix}-infobar-clock`);
    sc.infoBarShowCurrentEvent = _getChk(`ov-${prefix}-infobar-current-event`);
    sc.infoBarShowNextEvent    = _getChk(`ov-${prefix}-infobar-next-event`);
  }
}

// ── Message rows (per-screen) ─────────────────────────────────────────────

function _renderMessageRows(prefix, messages) {
  const container = document.getElementById(`ov-${prefix}-ticker-messages`);
  if (!container) return;
  container.innerHTML = '';
  const rows = messages.length ? messages : [''];
  for (const msg of rows) {
    container.appendChild(_buildMsgRow(prefix, msg));
  }
}

function _buildMsgRow(prefix, value) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:center';

  const input = document.createElement('input');
  input.type        = 'text';
  input.value       = value;
  input.placeholder = 'Message text\u2026';
  input.style.flex  = '1';
  input.addEventListener('input', () => _readScreen(prefix));

  const del = document.createElement('button');
  del.type      = 'button';
  del.textContent = '\u00d7';
  del.className = 'btn btn-secondary btn-sm';
  del.style.cssText = 'padding:0 8px;flex-shrink:0';
  del.addEventListener('click', () => {
    row.remove();
    const container = document.getElementById(`ov-${prefix}-ticker-messages`);
    if (container && !container.children.length) {
      container.appendChild(_buildMsgRow(prefix, ''));
    }
    _readScreen(prefix);
  });

  row.appendChild(input);
  row.appendChild(del);
  return row;
}

function _getMessageRows(prefix) {
  const container = document.getElementById(`ov-${prefix}-ticker-messages`);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="text"]'))
    .map(el => el.value.trim())
    .filter(v => v.length > 0);
}

// ── Message rows (global) ─────────────────────────────────────────────────

function _renderGlobalMessageRows(messages) {
  const container = document.getElementById('ov-global-ticker-messages');
  if (!container) return;
  container.innerHTML = '';
  const rows = messages.length ? messages : [''];
  for (const msg of rows) {
    container.appendChild(_buildGlobalMsgRow(msg));
  }
}

function _buildGlobalMsgRow(value) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:center';

  const input = document.createElement('input');
  input.type        = 'text';
  input.value       = value;
  input.placeholder = 'Message text\u2026';
  input.style.flex  = '1';
  input.addEventListener('input', _readGlobal);

  const del = document.createElement('button');
  del.type      = 'button';
  del.textContent = '\u00d7';
  del.className = 'btn btn-secondary btn-sm';
  del.style.cssText = 'padding:0 8px;flex-shrink:0';
  del.addEventListener('click', () => {
    row.remove();
    const container = document.getElementById('ov-global-ticker-messages');
    if (container && !container.children.length) {
      container.appendChild(_buildGlobalMsgRow(''));
    }
    _readGlobal();
  });

  row.appendChild(input);
  row.appendChild(del);
  return row;
}

function _getGlobalMessageRows() {
  const container = document.getElementById('ov-global-ticker-messages');
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="text"]'))
    .map(el => el.value.trim())
    .filter(v => v.length > 0);
}

// ── Fade mode field visibility ────────────────────────────────────────────

function _syncFadeModeFields(prefix) {
  const mode = document.getElementById(`ov-${prefix}-ticker-mode`)?.value;
  const isFade = mode === 'fade';
  const dwellWrap = document.getElementById(`ov-${prefix}-ticker-dwell-wrap`);
  const alignWrap = document.getElementById(`ov-${prefix}-ticker-align-wrap`);
  if (dwellWrap) dwellWrap.style.display = isFade ? '' : 'none';
  if (alignWrap) alignWrap.style.display = isFade ? '' : 'none';
}

function _syncGlobalFadeModeFields() {
  const mode = document.getElementById('ov-global-ticker-mode')?.value;
  const isFade = mode === 'fade';
  const dwellWrap = document.getElementById('ov-global-ticker-dwell-wrap');
  const alignWrap = document.getElementById('ov-global-ticker-align-wrap');
  if (dwellWrap) dwellWrap.style.display = isFade ? '' : 'none';
  if (alignWrap) alignWrap.style.display = isFade ? '' : 'none';
}

// ── Event binding ─────────────────────────────────────────────────────────

function _bindControls() {
  const cfg = _getConfig?.();
  if (!cfg) return;
  _bindGlobal();
  for (const id of _activeScreenIds(cfg)) {
    _bindScreen(id);
  }
}

function _bindGlobal() {
  // Clock, font size, schedule alert defaults
  const changeIds = [
    'ov-global-clock24h',
    'ov-global-sched-style', 'ov-global-sched-position',
    'ov-global-alert-style', 'ov-global-alert-position',
    // Global overlay toggles
    'ov-global-ticker-enabled', 'ov-global-ticker-mode', 'ov-global-ticker-align',
    'ov-global-ticker-position',
    'ov-global-bug-enabled', 'ov-global-bug-corner',
    'ov-global-qrbug-enabled', 'ov-global-qrbug-corner',
    'ov-global-infobar-enabled', 'ov-global-infobar-clock',
    'ov-global-infobar-current-event', 'ov-global-infobar-next-event',
  ];
  const inputIds = [
    'ov-global-sched-duration', 'ov-global-infobar-font-size',
    'ov-global-alert-duration',
    'ov-global-ticker-speed', 'ov-global-ticker-dwell',
    'ov-global-bug-text', 'ov-global-bug-image',
    'ov-global-qrbug-url', 'ov-global-qrbug-label',
  ];

  for (const id of changeIds) {
    document.getElementById(id)?.addEventListener('change', _readGlobal);
  }
  for (const id of inputIds) {
    document.getElementById(id)?.addEventListener('input', _readGlobal);
  }

  // Global ticker mode → show/hide dwell/align
  document.getElementById('ov-global-ticker-mode')?.addEventListener('change', _syncGlobalFadeModeFields);

  // Global ticker add message
  document.getElementById('ov-global-ticker-add-msg')?.addEventListener('click', () => {
    const container = document.getElementById('ov-global-ticker-messages');
    if (container) container.appendChild(_buildGlobalMsgRow(''));
  });
}

function _bindScreen(screenId) {
  const prefix = `s${screenId}`;

  // Inherit toggles
  for (const section of OVERLAY_SECTIONS) {
    document.getElementById(`ov-${prefix}-${section}-inherit`)?.addEventListener('change', () => {
      const inheriting = _getChk(`ov-${prefix}-${section}-inherit`);
      const fieldsEl = document.getElementById(`ov-${prefix}-${section}-fields`);
      if (fieldsEl) fieldsEl.classList.toggle('overlay-inherited', inheriting);

      // Write to config first so _applyToForm sees up-to-date values
      _readScreen(prefix);

      if (inheriting) {
        // Show the resolved global values in the (now disabled) fields
        const cfg = _getConfig();
        _applyToForm(screenId, cfg.screens?.[screenId] || {}, cfg);
      }
    });
  }

  // Add-message button
  document.getElementById(`ov-${prefix}-ticker-add-msg`)?.addEventListener('click', () => {
    const container = document.getElementById(`ov-${prefix}-ticker-messages`);
    if (container) container.appendChild(_buildMsgRow(prefix, ''));
  });

  // Mode change → show/hide fade-only fields
  document.getElementById(`ov-${prefix}-ticker-mode`)?.addEventListener('change', () => {
    _syncFadeModeFields(prefix);
    _readScreen(prefix);
  });

  // Checkboxes and selects fire 'change'; text/number inputs fire 'input'
  const changeIds = [
    `ov-${prefix}-ticker-enabled`, `ov-${prefix}-ticker-position`,
    `ov-${prefix}-ticker-align`,
    `ov-${prefix}-bug-enabled`,    `ov-${prefix}-bug-corner`,
    `ov-${prefix}-qrbug-enabled`,  `ov-${prefix}-qrbug-corner`,
    `ov-${prefix}-infobar-enabled`, `ov-${prefix}-infobar-clock`,
    `ov-${prefix}-infobar-current-event`, `ov-${prefix}-infobar-next-event`,
  ];
  const inputIds = [
    `ov-${prefix}-ticker-speed`, `ov-${prefix}-ticker-dwell`,
    `ov-${prefix}-bug-text`,    `ov-${prefix}-bug-image`,
    `ov-${prefix}-qrbug-url`,   `ov-${prefix}-qrbug-label`,
  ];

  for (const id of changeIds) {
    document.getElementById(id)?.addEventListener('change', () => _readScreen(prefix));
  }
  for (const id of inputIds) {
    document.getElementById(id)?.addEventListener('input', () => _readScreen(prefix));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function _setChk(id, val) { const el = document.getElementById(id); if (el) el.checked = val; }
function _getVal(id) { return document.getElementById(id)?.value ?? ''; }
function _getChk(id) { return document.getElementById(id)?.checked ?? false; }
