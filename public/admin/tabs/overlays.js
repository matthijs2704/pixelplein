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
        <summary>Ticker (scrolling text)</summary>
        <div class="section-body">
          <div class="check-row">
            <input type="checkbox" id="ov-${prefix}-ticker-enabled">
            <label for="ov-${prefix}-ticker-enabled">Enabled</label>
          </div>
          <div class="field">
            <label for="ov-${prefix}-ticker-text">Message text</label>
            <input type="text" id="ov-${prefix}-ticker-text" placeholder="Scrolling message...">
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
              <label for="ov-${prefix}-ticker-speed">Speed (px/s)</label>
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
    </div>
  `;
}

function _applyToForm(screenId, sc) {
  const prefix = `s${screenId}`;
  _setChk(`ov-${prefix}-ticker-enabled`, sc.tickerEnabled || false);
  _setVal(`ov-${prefix}-ticker-text`, sc.tickerText || '');
  _setVal(`ov-${prefix}-ticker-position`, sc.tickerPosition || 'bottom');
  _setVal(`ov-${prefix}-ticker-speed`, sc.tickerSpeed ?? 60);

  _setChk(`ov-${prefix}-bug-enabled`, sc.bugEnabled || false);
  _setVal(`ov-${prefix}-bug-text`, sc.bugText || '');
  _setVal(`ov-${prefix}-bug-corner`, sc.bugCorner || 'top-right');
  _setVal(`ov-${prefix}-bug-image`, sc.bugImageUrl || '');

  _setChk(`ov-${prefix}-qrbug-enabled`, sc.qrBugEnabled || false);
  _setVal(`ov-${prefix}-qrbug-url`, sc.qrBugUrl || '');
  _setVal(`ov-${prefix}-qrbug-corner`, sc.qrBugCorner || 'bottom-right');
  _setVal(`ov-${prefix}-qrbug-label`, sc.qrBugLabel || '');
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

  function read() {
    if (!_getConfig) return;
    const cfg = _getConfig();
    const sc = cfg.screens?.[screenId];
    if (!sc) return;

    sc.tickerEnabled = _getChk(`ov-${prefix}-ticker-enabled`);
    sc.tickerText = _getVal(`ov-${prefix}-ticker-text`);
    sc.tickerPosition = _getVal(`ov-${prefix}-ticker-position`);
    sc.tickerSpeed = parseInt(_getVal(`ov-${prefix}-ticker-speed`) || '60', 10);

    sc.bugEnabled = _getChk(`ov-${prefix}-bug-enabled`);
    sc.bugText = _getVal(`ov-${prefix}-bug-text`);
    sc.bugCorner = _getVal(`ov-${prefix}-bug-corner`);
    sc.bugImageUrl = _getVal(`ov-${prefix}-bug-image`);

    sc.qrBugEnabled = _getChk(`ov-${prefix}-qrbug-enabled`);
    sc.qrBugUrl = _getVal(`ov-${prefix}-qrbug-url`);
    sc.qrBugCorner = _getVal(`ov-${prefix}-qrbug-corner`);
    sc.qrBugLabel = _getVal(`ov-${prefix}-qrbug-label`);

    _onChanged?.();
  }

  // Checkboxes and selects fire 'change'; text/number inputs fire 'input'
  const changeIds = [
    `ov-${prefix}-ticker-enabled`, `ov-${prefix}-ticker-position`,
    `ov-${prefix}-bug-enabled`,    `ov-${prefix}-bug-corner`,
    `ov-${prefix}-qrbug-enabled`,  `ov-${prefix}-qrbug-corner`,
  ];
  const inputIds = [
    `ov-${prefix}-ticker-text`, `ov-${prefix}-ticker-speed`,
    `ov-${prefix}-bug-text`,    `ov-${prefix}-bug-image`,
    `ov-${prefix}-qrbug-url`,   `ov-${prefix}-qrbug-label`,
  ];

  for (const id of changeIds) {
    document.getElementById(id)?.addEventListener('change', read);
  }
  for (const id of inputIds) {
    document.getElementById(id)?.addEventListener('input', read);
  }
}

function _setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function _setChk(id, val) { const el = document.getElementById(id); if (el) el.checked = val; }
function _getVal(id) { return document.getElementById(id)?.value ?? ''; }
function _getChk(id) { return document.getElementById(id)?.checked ?? false; }
