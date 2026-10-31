// Quick tab: simple sliders + group selector, linked to both screens

import { simpleModelFromConfig, applySimpleControl } from '../config-model.js';
import { esc, activeScreenIds as _activeScreenIds } from '/shared/utils.js';

let _getConfig   = null;
let _onChanged   = null;
let _onAutoSave  = null;
let _groups      = ['ungrouped'];

/**
 * Initialise the Quick tab.
 *
 * @param {Function} getConfig   - returns the live config object
 * @param {Function} onChanged   - called when any control changes (triggers save prompt)
 * @param {Function} [onAutoSave] - optional callback to schedule an auto-save
 */
export function initQuickTab(getConfig, onChanged, onAutoSave) {
  _getConfig  = getConfig;
  _onChanged  = onChanged;
  _onAutoSave = onAutoSave || null;
  _bindControls();
}

export function updateGroups(groups) {
  _groups = groups;
  _refreshGroupSelector();
  _renderGroupVisibility();
}

export function refreshFromConfig() {
  if (!_getConfig) return;
  const cfg = _getConfig().screens?.['1'] || {};
  const m   = simpleModelFromConfig(cfg);

  setValue('q-pace',        m.pace);
  setValue('q-story-focus', m.storyFocus);
  setValue('q-energy',      m.energy);
  setRecency(cfg.recencyBias ?? 60);

  const kbEl = document.getElementById('q-ken-burns');
  if (kbEl) kbEl.checked = cfg.kenBurnsEnabled !== false;

  const globalCfg = _getConfig();
  const videoDisabledEl = document.getElementById('q-video-disabled');
  if (videoDisabledEl) videoDisabledEl.checked = globalCfg.videoPlaybackDisabled ?? false;
  const blackoutEl = document.getElementById('q-blackout');
  if (blackoutEl) blackoutEl.checked = globalCfg.screensBlackout ?? false;

  _refreshGroupSelector();
  _renderGroupVisibility();
}

// ---------------------------------------------------------------------------
// Build / bind
// ---------------------------------------------------------------------------

function _notify() {
  if (_onChanged) _onChanged();
  if (_onAutoSave) _onAutoSave();
}

function _bindControls() {
  bind('q-pace',        'pace');
  bind('q-story-focus', 'storyFocus');
  bind('q-energy',      'energy');

  // Recency bias — directly sets recencyBias on both screens
  const recEl  = document.getElementById('q-recency');
  const recVal = document.getElementById('q-recency-val');
  if (recEl) {
    recEl.addEventListener('input', () => {
      const v   = parseInt(recEl.value, 10);
      if (recVal) recVal.textContent = v + '%';
      const cfg = _getConfig();
      for (const id of _activeScreenIds(cfg)) {
        cfg.screens[id].recencyBias = v;
      }
      _notify();
    });
  }

  // Ken Burns toggle
  const kbEl = document.getElementById('q-ken-burns');
  if (kbEl) {
    kbEl.addEventListener('change', () => {
      const cfg = _getConfig();
      for (const id of _activeScreenIds(cfg)) {
        cfg.screens[id].kenBurnsEnabled = kbEl.checked;
      }
      _notify();
    });
  }

  const videoDisabledEl = document.getElementById('q-video-disabled');
  if (videoDisabledEl) {
    videoDisabledEl.addEventListener('change', () => {
      _getConfig().videoPlaybackDisabled = videoDisabledEl.checked;
      _notify();
    });
  }

  const blackoutEl = document.getElementById('q-blackout');
  if (blackoutEl) {
    blackoutEl.addEventListener('change', () => {
      _getConfig().screensBlackout = blackoutEl.checked;
      _notify();
    });
  }

  const groupSel = document.getElementById('q-group');
  if (groupSel) {
    groupSel.addEventListener('change', () => {
      const val = groupSel.value;
      const cfg = _getConfig();
      for (const id of _activeScreenIds(cfg)) {
        const screenCfg = cfg.screens[id];
        if (val === 'auto') {
          screenCfg.groupMode = 'auto';
        } else {
          screenCfg.groupMode = 'manual';
          screenCfg.activeGroup = val;
          screenCfg.hiddenGroups = _removeHiddenGroup(screenCfg.hiddenGroups, val);
        }
      }
      _renderGroupVisibility();
      _notify();
    });
  }

  const visibilityEl = document.getElementById('q-group-visibility');
  if (visibilityEl) {
    visibilityEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-group-visibility]');
      if (!btn) return;

      const group = btn.dataset.groupVisibility;
      const cfg   = _getConfig();
      for (const id of _activeScreenIds(cfg)) {
        const screenCfg = cfg.screens[id];
        const hidden    = new Set(Array.isArray(screenCfg.hiddenGroups) ? screenCfg.hiddenGroups : []);
        if (hidden.has(group)) hidden.delete(group);
        else hidden.add(group);

        if (screenCfg.groupMode === 'manual' && screenCfg.activeGroup === group) {
          hidden.delete(group);
        }

        screenCfg.hiddenGroups = [...hidden];
      }

      _renderGroupVisibility();
      _notify();
    });
  }
}

function bind(elId, key) {
  const el  = document.getElementById(elId);
  const val = document.getElementById(`${elId}-val`);
  if (!el) return;

  el.addEventListener('input', () => {
    const v = parseInt(el.value, 10);
    if (val) val.textContent = v + '%';

    const cfg = _getConfig();
    for (const id of _activeScreenIds(cfg)) {
      applySimpleControl(cfg.screens[id], key, v);
    }
    _notify();
  });
}

function setValue(elId, v) {
  const el  = document.getElementById(elId);
  const val = document.getElementById(`${elId}-val`);
  if (el)  el.value = v;
  if (val) val.textContent = v + '%';
}

function setRecency(v) {
  const el  = document.getElementById('q-recency');
  const val = document.getElementById('q-recency-val');
  if (el)  el.value = v;
  if (val) val.textContent = v + '%';
}

function _refreshGroupSelector() {
  const sel = document.getElementById('q-group');
  if (!sel || !_getConfig) return;

  const cfg     = _getConfig().screens?.['1'] || {};
  const current = cfg.groupMode === 'manual' ? cfg.activeGroup : 'auto';

  sel.innerHTML = `<option value="auto">Auto (all groups)</option>` +
    _groups.map(g => `<option value="${esc(g)}" ${current === g ? 'selected' : ''}>${esc(g)}</option>`).join('');

  if (current === 'auto') sel.value = 'auto';
}

function _renderGroupVisibility() {
  const el = document.getElementById('q-group-visibility');
  if (!el || !_getConfig) return;

  const cfg    = _getConfig().screens?.['1'] || {};
  const hidden = new Set(Array.isArray(cfg.hiddenGroups) ? cfg.hiddenGroups : []);

  el.innerHTML = _groups.map(g => {
    const shown = !hidden.has(g);
    return `<button type="button" class="adv-toggle ${shown ? 'on' : ''}" data-group-visibility="${esc(g)}">${esc(g)}</button>`;
  }).join('');
}

function _removeHiddenGroup(hiddenGroups, group) {
  return (Array.isArray(hiddenGroups) ? hiddenGroups : []).filter(g => g !== group);
}

