'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { photoOverrides } = require('./state');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const MAX_SCREENS = 4;

function defaultScreenConfig() {
  return {
    layoutDuration: 8000,
    transitionTime: 800,
    enabledLayouts: ['fullscreen', 'sidebyside', 'featuredduo', 'polaroid', 'mosaic'],
    transition: 'fade',
    groupMode: 'auto',
    activeGroup: 'ungrouped',
    groupMixPct: 20,
    mosaicSwapRounds: 1,
    mosaicSwapCount: 2,
    mosaicSwapDelay: 2200,
    cinematicWeight: 65,
    dynamicWeight: 25,
    neutralWeight: 10,
    kenBurnsEnabled: true,
    templateEnabled: [
      'hero-left-9',
      'hero-right-9',
      'hero-top-9',
      'split-story-6',
      'uniform-4',
      'uniform-9',
      'uniform-6',
      'recent-strip-9',
      'portrait-bias-9',
    ],
    heroCooldownSec: 30,
    crossScreenHeroLockSec: 30,
    recencyBias: 60,
    minTilePx: 170,
    swapStaggerMs: 140,
    preferHeroSide: 'auto',
    cyclePhaseMs: 0,
    playlistId: null,
    tickerEnabled: false,
    tickerText: '',
    tickerPosition: 'bottom',
    tickerSpeed: 60,
    bugEnabled: false,
    bugText: '',
    bugCorner: 'top-right',
    bugImageUrl: '',
    qrBugEnabled: false,
    qrBugUrl: '',
    qrBugCorner: 'bottom-right',
    qrBugLabel: '',
  };
}

function defaultSlide(type) {
  const base = { type, label: '', enabled: true, playSoon: false };
  if (type === 'video') return { ...base, filename: '', muted: true, playCount: 1 };
  if (type === 'text-card') return { ...base, template: 'dark-center', title: '', body: '', bgColor: '', durationSec: 10 };
  if (type === 'qr') return { ...base, url: '', title: '', caption: '', durationSec: 10 };
  if (type === 'webpage') return { ...base, src: '', durationSec: 15 };
  if (type === 'image') return { ...base, filename: '', fit: 'contain', durationSec: 10 };
  if (type === 'article') return {
    ...base,
    title: '',
    body: '',
    imageFilename: '',
    imageSource: 'upload',
    layout: 'image-left',
    bgColor: '',
    durationSec: 12,
  };
  return base;
}

function defaultPlaylist() {
  return {
    name: 'Untitled playlist',
    slideIds: [],
    interleaveEvery: 5,
    coordinated: false,
  };
}

function defaultConfig() {
  return {
    screens: {
      '1': defaultScreenConfig(),
      '2': defaultScreenConfig(),
    },
    screenCount: 2,
    eventName: '',
    displayWidth: 1920,
    displayHeight: 1080,
    adminPinHash: null,
    theme: null,
    slides: [],
    playlists: [],
    photoOverrides: {},
  };
}

const SCREEN2_MISSING_DEFAULTS = {
  transition: 'zoom',
  cinematicWeight: 35,
  dynamicWeight: 45,
  neutralWeight: 20,
  cyclePhaseMs: 800,
};

const SCREEN_CONFIG_KEYS = new Set([
  'layoutDuration',
  'transitionTime',
  'enabledLayouts',
  'transition',
  'groupMode',
  'activeGroup',
  'groupMixPct',
  'mosaicSwapRounds',
  'mosaicSwapCount',
  'mosaicSwapDelay',
  'cinematicWeight',
  'dynamicWeight',
  'neutralWeight',
  'kenBurnsEnabled',
  'templateEnabled',
  'heroCooldownSec',
  'crossScreenHeroLockSec',
  'recencyBias',
  'minTilePx',
  'swapStaggerMs',
  'preferHeroSide',
  'cyclePhaseMs',
  'playlistId',
  'tickerEnabled',
  'tickerText',
  'tickerPosition',
  'tickerSpeed',
  'bugEnabled',
  'bugText',
  'bugCorner',
  'bugImageUrl',
  'qrBugEnabled',
  'qrBugUrl',
  'qrBugCorner',
  'qrBugLabel',
]);

const ALLOWED_TEMPLATES = new Set([
  'hero-left-9',
  'hero-right-9',
  'hero-top-9',
  'split-story-6',
  'uniform-4',
  'uniform-9',
  'uniform-6',
  'recent-strip-9',
  'portrait-bias-9',
]);

let config = defaultConfig();

function _clampScreenCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 2;
  return Math.max(1, Math.min(MAX_SCREENS, Math.floor(num)));
}

function _isValidScreenId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n >= 1 && n <= MAX_SCREENS;
}

function _withScreen2MissingDefaults(sc) {
  const next = { ...(sc || defaultScreenConfig()) };
  for (const [k, v] of Object.entries(SCREEN2_MISSING_DEFAULTS)) {
    if (next[k] === undefined || next[k] === null) next[k] = v;
  }
  return next;
}

function _migrateLegacyRoot(raw) {
  if (!raw || typeof raw !== 'object') return { migrated: raw, changed: false };
  if (raw.screens && typeof raw.screens === 'object') return { migrated: raw, changed: false };
  if (!raw.screen1 && !raw.screen2) return { migrated: raw, changed: false };

  const migrated = { ...raw, screens: {} };
  if (raw.screen1 && typeof raw.screen1 === 'object') migrated.screens['1'] = raw.screen1;
  if (raw.screen2 && typeof raw.screen2 === 'object') migrated.screens['2'] = raw.screen2;
  delete migrated.screen1;
  delete migrated.screen2;
  if (migrated.screenCount == null) migrated.screenCount = 2;
  return { migrated, changed: true };
}

function sanitizeScreenConfig(input, base) {
  const next = { ...base };

  for (const [key, value] of Object.entries(input || {})) {
    if (!SCREEN_CONFIG_KEYS.has(key)) continue;

    if (key === 'enabledLayouts') {
      const allowed = ['fullscreen', 'sidebyside', 'featuredduo', 'polaroid', 'mosaic'];
      next.enabledLayouts = Array.isArray(value)
        ? value.filter(v => allowed.includes(v))
        : next.enabledLayouts;
      if (!next.enabledLayouts.length) next.enabledLayouts = ['fullscreen'];
      continue;
    }
    if (key === 'transition') {
      if (['fade', 'slide', 'zoom'].includes(value)) next.transition = value;
      continue;
    }
    if (key === 'groupMode') {
      if (['auto', 'manual'].includes(value)) next.groupMode = value;
      continue;
    }
    if (key === 'activeGroup') {
      next.activeGroup = String(value || 'ungrouped');
      continue;
    }
    if (key === 'preferHeroSide') {
      next.preferHeroSide = value === 'left' || value === 'right' ? value : 'auto';
      continue;
    }
    if (key === 'kenBurnsEnabled') {
      next.kenBurnsEnabled = Boolean(value);
      continue;
    }
    if (key === 'templateEnabled') {
      const selected = Array.isArray(value) ? value.filter(v => ALLOWED_TEMPLATES.has(v)) : [];
      next.templateEnabled = selected.length ? selected : [...ALLOWED_TEMPLATES];
      continue;
    }
    if (key === 'playlistId') {
      next.playlistId = value == null ? null : String(value);
      continue;
    }
    if (['tickerEnabled', 'bugEnabled', 'qrBugEnabled'].includes(key)) {
      next[key] = Boolean(value);
      continue;
    }
    if (['tickerText', 'bugText', 'bugImageUrl', 'qrBugUrl', 'qrBugLabel'].includes(key)) {
      next[key] = String(value ?? '');
      continue;
    }
    if (key === 'tickerPosition') {
      next.tickerPosition = value === 'top' ? 'top' : 'bottom';
      continue;
    }
    if (key === 'bugCorner' || key === 'qrBugCorner') {
      const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
      next[key] = corners.includes(value) ? value : (key === 'bugCorner' ? 'top-right' : 'bottom-right');
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    next[key] = value;
  }

  next.layoutDuration = Math.max(3000, Math.min(45000, Math.floor(next.layoutDuration)));
  next.transitionTime = Math.max(200, Math.min(3000, Math.floor(next.transitionTime)));
  next.groupMixPct = Math.max(0, Math.min(80, Math.floor(next.groupMixPct)));
  next.mosaicSwapRounds = Math.max(0, Math.min(4, Math.floor(next.mosaicSwapRounds)));
  next.mosaicSwapCount = Math.max(1, Math.min(6, Math.floor(next.mosaicSwapCount)));
  next.mosaicSwapDelay = Math.max(700, Math.min(8000, Math.floor(next.mosaicSwapDelay)));
  next.cinematicWeight = Math.max(0, Math.min(100, Math.floor(next.cinematicWeight)));
  next.dynamicWeight = Math.max(0, Math.min(100, Math.floor(next.dynamicWeight)));
  next.neutralWeight = Math.max(0, Math.min(100, Math.floor(next.neutralWeight)));
  next.heroCooldownSec = Math.max(10, Math.min(240, Math.floor(next.heroCooldownSec)));
  next.crossScreenHeroLockSec = Math.max(10, Math.min(180, Math.floor(next.crossScreenHeroLockSec)));
  next.recencyBias = Math.max(0, Math.min(100, Math.floor(next.recencyBias ?? 60)));
  next.minTilePx = Math.max(120, Math.min(400, Math.floor(next.minTilePx)));
  next.swapStaggerMs = Math.max(60, Math.min(500, Math.floor(next.swapStaggerMs)));
  next.cyclePhaseMs = Math.max(0, Math.min(8000, Math.floor(next.cyclePhaseMs)));
  if (typeof next.tickerSpeed === 'number') {
    next.tickerSpeed = Math.max(10, Math.min(300, Math.floor(next.tickerSpeed)));
  }

  if ((next.cinematicWeight + next.dynamicWeight + next.neutralWeight) === 0) {
    next.cinematicWeight = 65;
    next.dynamicWeight = 25;
    next.neutralWeight = 10;
  }

  return next;
}

function sanitizeConfig(input, validThemeIds) {
  const raw = input && typeof input === 'object' ? input : {};
  const next = defaultConfig();

  const rawScreens = raw.screens && typeof raw.screens === 'object' ? raw.screens : {};
  next.screens = {};
  for (const [id, sc] of Object.entries(rawScreens)) {
    if (!_isValidScreenId(id)) continue;
    next.screens[String(Number(id))] = sanitizeScreenConfig(sc, defaultScreenConfig());
  }

  if (!next.screens['1']) next.screens['1'] = defaultScreenConfig();
  if (!next.screens['2']) next.screens['2'] = defaultScreenConfig();

  next.screens['2'] = _withScreen2MissingDefaults(next.screens['2']);

  next.screenCount = _clampScreenCount(raw.screenCount ?? 2);
  for (let i = 1; i <= next.screenCount; i++) {
    const id = String(i);
    if (!next.screens[id]) next.screens[id] = defaultScreenConfig();
  }

  next.eventName = typeof raw.eventName === 'string' ? raw.eventName : '';

  const width = Number(raw.displayWidth);
  const height = Number(raw.displayHeight);
  next.displayWidth = Number.isFinite(width) ? Math.max(320, Math.floor(width)) : 1920;
  next.displayHeight = Number.isFinite(height) ? Math.max(240, Math.floor(height)) : 1080;

  next.adminPinHash = typeof raw.adminPinHash === 'string' && raw.adminPinHash ? raw.adminPinHash : null;

  if (raw.theme === null || raw.theme === '' || raw.theme === undefined) {
    next.theme = null;
  } else if (typeof raw.theme === 'string' && (!validThemeIds || validThemeIds.has(raw.theme))) {
    next.theme = raw.theme;
  }

  next.slides = Array.isArray(raw.slides) ? raw.slides : [];
  next.playlists = Array.isArray(raw.playlists) ? raw.playlists : [];

  next.photoOverrides = raw.photoOverrides && typeof raw.photoOverrides === 'object'
    ? raw.photoOverrides
    : {};

  return next;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return;
  try {
    const rawParsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const { migrated, changed } = _migrateLegacyRoot(rawParsed);

    config = sanitizeConfig(migrated);

    photoOverrides.clear();
    for (const [id, override] of Object.entries(config.photoOverrides || {})) {
      photoOverrides.set(id, { heroCandidate: Boolean(override && override.heroCandidate) });
    }

    if (changed) saveConfig();
  } catch {
    console.warn('Config parse error, using defaults');
    config = defaultConfig();
  }
}

let _savePending = false;
let _saveQueued = false;

function saveConfig() {
  if (_savePending) {
    _saveQueued = true;
    return;
  }
  _savePending = true;

  const overridesObj = {};
  for (const [id, override] of photoOverrides.entries()) {
    overridesObj[id] = override;
  }

  const payload = JSON.stringify({ ...config, photoOverrides: overridesObj }, null, 2);
  const tmp = CONFIG_FILE + '.tmp';

  fsp.writeFile(tmp, payload, 'utf8')
    .then(() => fsp.rename(tmp, CONFIG_FILE))
    .catch(err => console.error('Config save failed:', err.message))
    .finally(() => {
      _savePending = false;
      if (_saveQueued) {
        _saveQueued = false;
        saveConfig();
      }
    });
}

function sanitizeGlobalConfig(input, target, validThemeIds) {
  if (!input || typeof input !== 'object' || !target) return;

  if (Object.prototype.hasOwnProperty.call(input, 'theme')) {
    const v = input.theme;
    if (v === null || v === '' || v === undefined) {
      target.theme = null;
    } else if (typeof v === 'string' && (!validThemeIds || validThemeIds.has(v))) {
      target.theme = v;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'eventName')) {
    target.eventName = String(input.eventName || '');
  }

  if (Object.prototype.hasOwnProperty.call(input, 'displayWidth')) {
    const w = Number(input.displayWidth);
    if (Number.isFinite(w)) target.displayWidth = Math.max(320, Math.floor(w));
  }

  if (Object.prototype.hasOwnProperty.call(input, 'displayHeight')) {
    const h = Number(input.displayHeight);
    if (Number.isFinite(h)) target.displayHeight = Math.max(240, Math.floor(h));
  }

  if (Object.prototype.hasOwnProperty.call(input, 'screenCount')) {
    target.screenCount = _clampScreenCount(input.screenCount);
    for (let i = 1; i <= target.screenCount; i++) {
      const id = String(i);
      if (!target.screens[id]) target.screens[id] = defaultScreenConfig();
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'adminPinHash')) {
    const pinHash = input.adminPinHash;
    target.adminPinHash = typeof pinHash === 'string' && pinHash ? pinHash : null;
  }
}

function getScreenConfig(id) {
  const key = String(Number(id));
  return config.screens[key] || defaultScreenConfig();
}

function setScreenConfig(id, patch) {
  const key = String(Number(id));
  if (!_isValidScreenId(key)) return null;
  const base = getScreenConfig(key);
  config.screens[key] = sanitizeScreenConfig(patch, base);
  return config.screens[key];
}

function getPublicConfig() {
  const { adminPinHash, ...rest } = config;
  return rest;
}

function getConfig() { return config; }

module.exports = {
  MAX_SCREENS,
  defaultScreenConfig,
  defaultSlide,
  defaultPlaylist,
  defaultConfig,
  SCREEN_CONFIG_KEYS,
  ALLOWED_TEMPLATES,
  loadConfig,
  saveConfig,
  sanitizeScreenConfig,
  sanitizeConfig,
  sanitizeGlobalConfig,
  getScreenConfig,
  setScreenConfig,
  getPublicConfig,
  getConfig,
};
