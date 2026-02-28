// Quick tab: simple sliders + group selector, linked to both screens

import { simpleModelFromConfig, applySimpleControl } from '../config-model.js';
import { esc, activeScreenIds as _activeScreenIds } from '/shared/utils.js';

let _getConfig  = null;
let _onChanged  = null;
let _groups     = ['ungrouped'];

/**
 * Initialise the Quick tab.
 *
 * @param {Function} getConfig  - returns the live config object
 * @param {Function} onChanged  - called when any control changes (triggers save prompt)
 */
export function initQuickTab(getConfig, onChanged) {
  _getConfig = getConfig;
  _onChanged  = onChanged;
  _bindControls();
}

export function updateGroups(groups) {
  _groups = groups;
  _refreshGroupSelector();
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

  _refreshGroupSelector();
}

// ---------------------------------------------------------------------------
// Build / bind
// ---------------------------------------------------------------------------

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
      if (_onChanged) _onChanged();
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
      if (_onChanged) _onChanged();
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
        }
      }
      if (_onChanged) _onChanged();
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
    if (_onChanged) _onChanged();
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


