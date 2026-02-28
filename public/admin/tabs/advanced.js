// Advanced tab: full per-setting controls, linked by default

import { deriveLinkedScreenConfig } from '../config-model.js';
import { esc, activeScreenIds as _activeScreenIds } from '/shared/utils.js';

let _getConfig  = null;
let _onChanged  = null;
let _groups     = ['ungrouped'];
let _linked     = true; // linked by default

const TEMPLATE_OPTIONS = [
  { id: 'hero-left-9',    label: 'Hero left' },
  { id: 'hero-right-9',   label: 'Hero right' },
  { id: 'hero-top-9',     label: 'Hero top' },
  { id: 'split-story-6',  label: 'Split story' },
  { id: 'uniform-4',      label: 'Uniform 4' },
  { id: 'uniform-9',      label: 'Uniform 9' },
  { id: 'uniform-6',      label: 'Uniform 6' },
  { id: 'recent-strip-9', label: 'Recent strip' },
  { id: 'portrait-bias-9',label: 'Portrait bias' },
];

/**
 * @param {Function} getConfig
 * @param {Function} onChanged
 */
export function initAdvancedTab(getConfig, onChanged) {
  _getConfig = getConfig;
  _onChanged  = onChanged;
  _renderForm();
  _bindLinkedToggle();
}

export function updateGroups(groups) {
  _groups = groups;
  // Refresh group dropdowns if rendered
  _refreshGroupSelects();
}

export function refreshFromConfig() {
  _renderForm();
}

// ---------------------------------------------------------------------------
// Linked / unlocked toggle
// ---------------------------------------------------------------------------

function _bindLinkedToggle() {
  const toggle = document.getElementById('adv-linked-toggle');
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    _linked = toggle.checked;
    _renderForm();
  });
}

// ---------------------------------------------------------------------------
// Form rendering
// ---------------------------------------------------------------------------

function _renderForm() {
  const container = document.getElementById('adv-form-container');
  if (!container || !_getConfig) return;

  const cfg = _getConfig();
  const ids = _activeScreenIds(cfg);

  if (_linked) {
    container.innerHTML = _buildScreenForm('1', cfg.screens?.['1'] || {});
    container.innerHTML += '<p class="adv-linked-note">Screen 2 mirrors Screen 1 with +900ms offset. Screen 3/4 continue with +1800ms/+2700ms offsets.</p>';
  } else {
    container.innerHTML = `<div class="adv-two-col">${ids.map(id =>
      `<div><h3 class="adv-screen-title s${id}-title">Screen ${id}</h3>${_buildScreenForm(id, cfg.screens?.[id] || {})}</div>`
    ).join('')}</div>`;
  }

  _bindFormEvents();
  _refreshGroupSelects();
}

function _buildScreenForm(screenKey, cfg) {
  const s = cfg || {};

  return `
    <details class="adv-section" open>
      <summary>Core playback</summary>
      ${_range(screenKey, 'layoutDuration', 'Display duration', 3000, 30000, 500, s.layoutDuration ?? 8000, v => (v/1000).toFixed(1)+'s')}
      ${_range(screenKey, 'transitionTime', 'Transition speed', 200, 2000, 100, s.transitionTime ?? 800, v => v+'ms')}
      ${_toggleGroup(screenKey, 'enabledLayouts', 'Enabled layouts',
          [['fullscreen','Full screen'],['sidebyside','Side by side'],['featuredduo','Featured duo'],['polaroid','Polaroid'],['mosaic','Mosaic']],
          s.enabledLayouts || ['fullscreen','sidebyside','featuredduo','polaroid','mosaic'])}
      ${_select(screenKey, 'transition', 'Transition animation',
          [['fade','Fade'],['slide','Slide'],['zoom','Zoom']], s.transition || 'fade')}
    </details>

    <details class="adv-section">
      <summary>Template style</summary>
      ${_toggleGroup(screenKey, 'templateEnabled', 'Template set',
          TEMPLATE_OPTIONS.map(t => [t.id, t.label]),
          s.templateEnabled || TEMPLATE_OPTIONS.map(t => t.id))}
      ${_range(screenKey, 'cinematicWeight', 'Cinematic weight', 0, 100, 5, s.cinematicWeight ?? 65, v => v+'%')}
      ${_range(screenKey, 'dynamicWeight',   'Dynamic weight',   0, 100, 5, s.dynamicWeight   ?? 25, v => v+'%')}
      ${_range(screenKey, 'neutralWeight',   'Neutral weight',   0, 100, 5, s.neutralWeight   ?? 10, v => v+'%')}
    </details>

    <details class="adv-section">
      <summary>Grouping</summary>
      ${_select(screenKey, 'groupMode', 'Group playback mode',
          [['auto','Auto (all groups)'],['manual','Manual (pin to one group)']], s.groupMode || 'auto')}
      ${_groupSelect(screenKey, s.activeGroup || 'ungrouped')}
      ${_range(screenKey, 'groupMixPct', 'Cross-group mix', 0, 80, 5, s.groupMixPct ?? 20, v => v+'%')}
    </details>

    <details class="adv-section">
      <summary>Mosaic rhythm</summary>
      ${_range(screenKey, 'mosaicSwapRounds', 'Swaps per cycle',    0, 4,    1,   s.mosaicSwapRounds ?? 1,    v => v+'×')}
      ${_range(screenKey, 'mosaicSwapCount',  'Photos per swap',    1, 6,    1,   s.mosaicSwapCount  ?? 2,    v => v)}
      ${_range(screenKey, 'mosaicSwapDelay',  'Swap delay',         700, 8000, 100, s.mosaicSwapDelay  ?? 2200, v => v+'ms')}
      ${_range(screenKey, 'swapStaggerMs',    'Swap stagger',       60, 500,  10,  s.swapStaggerMs    ?? 140,  v => v+'ms')}
    </details>

    <details class="adv-section">
      <summary>Screen pairing</summary>
      ${_range(screenKey, 'heroCooldownSec',      'Hero cooldown',         10, 240, 5, s.heroCooldownSec      ?? 30, v => v+'s')}
      ${_range(screenKey, 'crossScreenHeroLockSec','Cross-screen hero lock',10, 180, 5, s.crossScreenHeroLockSec ?? 30, v => v+'s')}
      ${_select(screenKey, 'preferHeroSide', 'Preferred hero side',
          [['auto','Auto'],['left','Left'],['right','Right']], s.preferHeroSide || 'auto')}
      ${_range(screenKey, 'cyclePhaseMs', 'Phase offset', 0, 3000, 100, s.cyclePhaseMs ?? 0, v => v+'ms')}
    </details>

    <details class="adv-section">
      <summary>Safety / readability</summary>
      ${_range(screenKey, 'minTilePx', 'Minimum tile size', 120, 400, 10, s.minTilePx ?? 170, v => v+'px')}
    </details>
  `;
}

// ---------------------------------------------------------------------------
// Event binding
// ---------------------------------------------------------------------------

function _bindFormEvents() {
  const container = document.getElementById('adv-form-container');
  if (!container) return;

  container.querySelectorAll('input[type="range"]').forEach(el => {
    el.addEventListener('input', () => {
      const { screen, key } = el.dataset;
      let val = parseFloat(el.value);
      // Special handling for boolean-ish keys stored as int
      _setConfigValue(screen, key, val);
      const display = container.querySelector(`[data-display="${screen}-${key}"]`);
      if (display) display.textContent = _formatRange(key, val);
    });
  });

  container.querySelectorAll('select[data-screen]').forEach(el => {
    el.addEventListener('change', () => {
      const { screen, key } = el.dataset;
      let val = el.value;
      _setConfigValue(screen, key, val);
    });
  });

  container.querySelectorAll('.adv-toggle[data-screen]').forEach(el => {
    el.addEventListener('click', () => {
      const { screen, key, value } = el.dataset;
      el.classList.toggle('on');
      const cfg = _getConfig();
      const screens = _linked ? _activeScreenIds(cfg) : [screen];
      for (const sk of screens) {
        const current = Array.isArray(cfg.screens[sk]?.[key]) ? [...cfg.screens[sk][key]] : [];
        if (el.classList.contains('on')) {
          if (!current.includes(value)) current.push(value);
        } else {
          const idx = current.indexOf(value);
          if (idx >= 0) current.splice(idx, 1);
        }
        cfg.screens[sk][key] = current;
      }
      if (_linked) {
        const linkedIds = _activeScreenIds(cfg).filter(id => id !== '1');
        for (const id of linkedIds) {
          cfg.screens[id] = deriveLinkedScreenConfig(cfg.screens['1'], id);
        }
      }
      if (_onChanged) _onChanged();
    });
  });
}

function _setConfigValue(screen, key, val) {
  const cfg     = _getConfig();
  const screens = _linked ? _activeScreenIds(cfg) : [screen];
  for (const sk of screens) {
    cfg.screens[sk][key] = val;
  }
  if (_linked) {
    const linkedIds = _activeScreenIds(cfg).filter(id => id !== '1');
    for (const id of linkedIds) {
      cfg.screens[id] = deriveLinkedScreenConfig(cfg.screens['1'], id);
    }
  }
  if (_onChanged) _onChanged();
}

function _refreshGroupSelects() {
  document.querySelectorAll('[data-group-select]').forEach(sel => {
    const screen  = sel.dataset.screen;
    const cfg     = _getConfig();
    const current = cfg?.screens?.[screen]?.activeGroup || 'ungrouped';
    sel.innerHTML = _groups.map(g =>
      `<option value="${esc(g)}" ${current === g ? 'selected' : ''}>${esc(g)}</option>`
    ).join('');
  });
}

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

function _range(screen, key, label, min, max, step, value, fmt) {
  const id  = `adv-${screen}-${key}`;
  const dsp = fmt ? fmt(value) : value;
  return `
    <div class="adv-field">
      <label for="${id}">${label}</label>
      <div class="adv-range-row">
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"
          data-screen="${screen}" data-key="${key}">
        <span class="adv-range-val" data-display="${screen}-${key}">${dsp}</span>
      </div>
    </div>`;
}

function _formatRange(key, val) {
  const pctKeys  = ['cinematicWeight','dynamicWeight','neutralWeight','groupMixPct'];
  const pxKeys   = ['minTilePx'];
  const xKeys    = ['mosaicSwapRounds'];

  if (key === 'layoutDuration')  return (val/1000).toFixed(1)+'s';
  if (key === 'transitionTime')  return val+'ms';
  if (key === 'mosaicSwapDelay') return val+'ms';
  if (key === 'swapStaggerMs')   return val+'ms';
  if (key === 'cyclePhaseMs')    return val+'ms';
  if (key === 'heroCooldownSec' || key === 'crossScreenHeroLockSec') return val+'s';
  if (pctKeys.includes(key)) return val+'%';
  if (pxKeys.includes(key))  return val+'px';
  if (xKeys.includes(key))   return val+'×';
  return val;
}

function _select(screen, key, label, options, current) {
  const id = `adv-${screen}-${key}`;
  const opts = options.map(([v, l]) =>
    `<option value="${esc(String(v))}" ${String(current) === String(v) ? 'selected' : ''}>${esc(l)}</option>`
  ).join('');
  return `
    <div class="adv-field">
      <label for="${id}">${label}</label>
      <select id="${id}" data-screen="${screen}" data-key="${key}">${opts}</select>
    </div>`;
}

function _toggleGroup(screen, key, label, options, current) {
  const buttons = options.map(([val, lbl]) => {
    const on = current.includes(val) ? 'on' : '';
    return `<button class="adv-toggle ${on}" data-screen="${screen}" data-key="${key}" data-value="${esc(val)}">${esc(lbl)}</button>`;
  }).join('');
  return `
    <div class="adv-field">
      <label>${label}</label>
      <div class="adv-toggle-group">${buttons}</div>
    </div>`;
}

function _groupSelect(screen, current) {
  const opts = _groups.map(g =>
    `<option value="${esc(g)}" ${current === g ? 'selected' : ''}>${esc(g)}</option>`
  ).join('');
  return `
    <div class="adv-field">
      <label>Active group (manual mode)</label>
      <select data-screen="${screen}" data-key="activeGroup" data-group-select="${screen}">${opts}</select>
    </div>`;
}

/**
 * Apply safe fallback to both screens.
 */
export function applySafeFallback(getConfig, onChanged) {
  const base = {
    enabledLayouts: ['fullscreen', 'sidebyside', 'featuredduo', 'polaroid', 'mosaic'],
    transition: 'fade',
    groupMode: 'auto',
    cinematicWeight: 60,
    dynamicWeight: 25,
    neutralWeight: 15,
    groupMixPct: 20,
    mosaicSwapRounds: 1,
    mosaicSwapCount: 2,
    mosaicSwapDelay: 2200,
    swapStaggerMs: 130,
    crossScreenHeroLockSec: 40,
    heroCooldownSec: 45,
    minTilePx: 180,
  };
  const cfg = getConfig();
  const ids = _activeScreenIds(cfg);
  if (!cfg.screens['1']) cfg.screens['1'] = {};
  cfg.screens['1'] = { ...cfg.screens['1'], ...base, layoutDuration: 9000, preferHeroSide: 'right', cyclePhaseMs: 0 };
  for (const id of ids.filter(id => id !== '1')) {
    cfg.screens[id] = deriveLinkedScreenConfig({ ...cfg.screens['1'], ...base }, id);
  }
  if (onChanged) onChanged();
}


