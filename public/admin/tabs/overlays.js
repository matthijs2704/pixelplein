// Admin tab: Overlays — per-screen persistent overlay config

import { activeScreenIds as _activeScreenIds } from '/shared/utils.js';

let _getConfig = null;
let _onChanged = null;

export function initOverlaysTab(getConfig, onChanged) {
  _getConfig = getConfig;
  _onChanged = onChanged;
  _renderForms();
  _bindControls();
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

  for (const id of _activeScreenIds(cfg)) {
    _applyToForm(id, cfg.screens[id] || {});
  }
}

function _renderForms() {
  const root = document.getElementById('overlays-grid');
  const cfg = _getConfig?.();
  if (!root || !cfg) return;

  root.innerHTML = _activeScreenIds(cfg).map(id => _buildOverlayForm(id)).join('');
}

function _buildOverlayForm(screenId) {
  const prefix = `s${screenId}`;
  return `
    <div>
      <div class="section-label">Screen ${screenId}</div>

      <details class="section" open>
        <summary>Ticker</summary>
        <div class="section-body">
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
      </details>

      <details class="section">
        <summary>Corner Bug (text / logo)</summary>
        <div class="section-body">
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
      </details>

      <details class="section">
        <summary>QR Corner Widget</summary>
        <div class="section-body">
          <div class="check-row">
            <input type="checkbox" id="ov-${prefix}-qrbug-enabled">
            <label for="ov-${prefix}-qrbug-enabled">Enabled</label>
          </div>
          <div class="field">
            <label for="ov-${prefix}-qrbug-url">URL to encode</label>
            <input type="text" id="ov-${prefix}-qrbug-url" placeholder="https://...">
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
      </details>

      <details class="section">
        <summary>Info Bar</summary>
        <div class="section-body">
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
      </details>
    </div>
  `;
}

function _applyToForm(screenId, sc) {
  const prefix = `s${screenId}`;
  _setChk(`ov-${prefix}-ticker-enabled`, sc.tickerEnabled || false);
  _setVal(`ov-${prefix}-ticker-position`, sc.tickerPosition || 'bottom');
  _setVal(`ov-${prefix}-ticker-speed`, sc.tickerSpeed ?? 60);
  _setVal(`ov-${prefix}-ticker-mode`, sc.tickerMode || 'scroll');
  _setVal(`ov-${prefix}-ticker-align`, ['start', 'center', 'end'].includes(sc.tickerAlign) ? sc.tickerAlign : 'start');
  _setVal(`ov-${prefix}-ticker-dwell`, sc.tickerFadeDwellSec ?? 5);

  // Rebuild message rows
  const msgs = Array.isArray(sc.tickerMessages) ? sc.tickerMessages : [];
  _renderMessageRows(prefix, msgs);

  // Show/hide fade-only fields based on current mode
  _syncFadeModeFields(prefix);

  _setChk(`ov-${prefix}-bug-enabled`, sc.bugEnabled || false);
  _setVal(`ov-${prefix}-bug-text`, sc.bugText || '');
  _setVal(`ov-${prefix}-bug-corner`, sc.bugCorner || 'top-right');
  _setVal(`ov-${prefix}-bug-image`, sc.bugImageUrl || '');

  _setChk(`ov-${prefix}-qrbug-enabled`, sc.qrBugEnabled || false);
  _setVal(`ov-${prefix}-qrbug-url`, sc.qrBugUrl || '');
  _setVal(`ov-${prefix}-qrbug-corner`, sc.qrBugCorner || 'bottom-right');
  _setVal(`ov-${prefix}-qrbug-label`, sc.qrBugLabel || '');

  _setChk(`ov-${prefix}-infobar-enabled`, sc.infoBarEnabled || false);
  _setChk(`ov-${prefix}-infobar-clock`, sc.infoBarShowClock !== false);
  _setChk(`ov-${prefix}-infobar-current-event`, sc.infoBarShowCurrentEvent !== false);
  _setChk(`ov-${prefix}-infobar-next-event`, sc.infoBarShowNextEvent !== false);
}

// Rebuild the list of message rows for a given screen prefix.
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
  input.placeholder = 'Message text…';
  input.style.flex  = '1';
  input.addEventListener('input', () => _readScreen(prefix));

  const del = document.createElement('button');
  del.type      = 'button';
  del.textContent = '×';
  del.className = 'btn btn-secondary btn-sm';
  del.style.cssText = 'padding:0 8px;flex-shrink:0';
  del.addEventListener('click', () => {
    row.remove();
    // Always keep at least one empty row
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

function _syncFadeModeFields(prefix) {
  const mode = document.getElementById(`ov-${prefix}-ticker-mode`)?.value;
  const isFade = mode === 'fade';
  const dwellWrap = document.getElementById(`ov-${prefix}-ticker-dwell-wrap`);
  const alignWrap = document.getElementById(`ov-${prefix}-ticker-align-wrap`);
  if (dwellWrap) dwellWrap.style.display = isFade ? '' : 'none';
  if (alignWrap) alignWrap.style.display = isFade ? '' : 'none';
}

function _readScreen(prefix) {
  const screenId = prefix.slice(1); // strip leading 's'
  if (!_getConfig) return;
  const cfg = _getConfig();
  const sc = cfg.screens?.[screenId];
  if (!sc) return;

  sc.tickerEnabled      = _getChk(`ov-${prefix}-ticker-enabled`);
  sc.tickerMessages     = _getMessageRows(prefix);
  sc.tickerMode         = _getVal(`ov-${prefix}-ticker-mode`);
  sc.tickerAlign        = _getVal(`ov-${prefix}-ticker-align`);
  sc.tickerFadeDwellSec = parseInt(_getVal(`ov-${prefix}-ticker-dwell`) || '5', 10);
  sc.tickerPosition     = _getVal(`ov-${prefix}-ticker-position`);
  sc.tickerSpeed        = parseInt(_getVal(`ov-${prefix}-ticker-speed`) || '60', 10);

  sc.bugEnabled   = _getChk(`ov-${prefix}-bug-enabled`);
  sc.bugText      = _getVal(`ov-${prefix}-bug-text`);
  sc.bugCorner    = _getVal(`ov-${prefix}-bug-corner`);
  sc.bugImageUrl  = _getVal(`ov-${prefix}-bug-image`);

  sc.qrBugEnabled = _getChk(`ov-${prefix}-qrbug-enabled`);
  sc.qrBugUrl     = _getVal(`ov-${prefix}-qrbug-url`);
  sc.qrBugCorner  = _getVal(`ov-${prefix}-qrbug-corner`);
  sc.qrBugLabel   = _getVal(`ov-${prefix}-qrbug-label`);

  sc.infoBarEnabled          = _getChk(`ov-${prefix}-infobar-enabled`);
  sc.infoBarShowClock        = _getChk(`ov-${prefix}-infobar-clock`);
  sc.infoBarShowCurrentEvent = _getChk(`ov-${prefix}-infobar-current-event`);
  sc.infoBarShowNextEvent    = _getChk(`ov-${prefix}-infobar-next-event`);

  _onChanged?.();
}

function _getMessageRows(prefix) {
  const container = document.getElementById(`ov-${prefix}-ticker-messages`);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="text"]'))
    .map(el => el.value.trim())
    .filter(v => v.length > 0);
}

function _bindControls() {
  const cfg = _getConfig?.();
  if (!cfg) return;
  for (const id of _activeScreenIds(cfg)) {
    _bindScreen(id);
  }
}

function _bindScreen(screenId) {
  const prefix = `s${screenId}`;

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

function _setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function _setChk(id, val) { const el = document.getElementById(id); if (el) el.checked = val; }
function _getVal(id) { return document.getElementById(id)?.value ?? ''; }
function _getChk(id) { return document.getElementById(id)?.checked ?? false; }
