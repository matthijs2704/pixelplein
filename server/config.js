'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const MAX_SCREENS = 4;

const ALERT_STYLES = new Set(['banner', 'popup', 'countdown']);
const ALERT_POSITIONS = new Set(['top', 'bottom', 'center']);
const ALERT_PRIORITIES = new Set(['normal', 'urgent']);
const ALERT_TRIGGERS = new Set(['manual', 'scheduled', 'event_auto']);
const SUBMISSION_DISPLAY_MODES = new Set(['off', 'single', 'grid', 'both']);

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
    publicBaseUrl: '',
    displayWidth: 1920,
    displayHeight: 1080,
    healthBroadcastIntervalMs: 3000,
    sessionSecret: null,
    theme: null,
    slides: [],
    playlists: [],
    alerts: [],
    eventSchedule: [],
    submissions: [],
    submissionEnabled: true,
    submissionFieldLabel: 'Name',
    submissionRequirePhoto: false,
    submissionDisplayMode: 'both',
    submissionDisplayIntervalSec: 45,
    submissionDisplayDurationSec: 12,
    submissionGridCount: 6,
    submissionWallShowQr: true,
    submissionWallHideWhenEmpty: true,
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

function _sanitizeAlert(alert) {
  const now = Date.now();
  const src = alert && typeof alert === 'object' ? alert : {};
  const id = typeof src.id === 'string' && src.id ? src.id : '';
  if (!id) return null;

  const style = ALERT_STYLES.has(src.style) ? src.style : 'banner';
  const position = ALERT_POSITIONS.has(src.position) ? src.position
    : (style === 'popup' ? 'center' : 'top');
  const priority = ALERT_PRIORITIES.has(src.priority) ? src.priority : 'normal';
  const trigger = ALERT_TRIGGERS.has(src.trigger) ? src.trigger : 'manual';

  const durationSecRaw = Number(src.durationSec);
  const durationSec = Number.isFinite(durationSecRaw)
    ? Math.max(0, Math.min(3600, Math.floor(durationSecRaw)))
    : 15;

  const scheduledAt = src.scheduledAt ? Number(new Date(src.scheduledAt)) : null;
  const countdownTo = src.countdownTo ? Number(new Date(src.countdownTo)) : null;

  const firedAtRaw = Number(src.firedAt);
  const createdAtRaw = Number(src.createdAt);
  const dismissedAtRaw = Number(src.dismissedAt);

  return {
    id,
    style,
    message: String(src.message || ''),
    position,
    priority,
    durationSec,
    trigger,
    scheduledAt: Number.isFinite(scheduledAt) ? new Date(scheduledAt).toISOString() : null,
    countdownTo: Number.isFinite(countdownTo) ? new Date(countdownTo).toISOString() : null,
    active: Boolean(src.active),
    dismissed: Boolean(src.dismissed),
    createdAt: Number.isFinite(createdAtRaw) ? Math.floor(createdAtRaw) : now,
    firedAt: Number.isFinite(firedAtRaw) ? Math.floor(firedAtRaw) : null,
    dismissedAt: Number.isFinite(dismissedAtRaw) ? Math.floor(dismissedAtRaw) : null,
    eventId: src.eventId ? String(src.eventId) : null,
  };
}

function _sanitizeAlertList(rawAlerts) {
  if (!Array.isArray(rawAlerts)) return [];
  const next = [];
  const seen = new Set();
  for (const raw of rawAlerts) {
    const alert = _sanitizeAlert(raw);
    if (!alert || seen.has(alert.id)) continue;
    seen.add(alert.id);
    next.push(alert);
  }
  return next;
}

function _sanitizeEventScheduleEntry(entry) {
  const src = entry && typeof entry === 'object' ? entry : {};
  const id = typeof src.id === 'string' && src.id ? src.id : '';
  if (!id) return null;

  const startMs = Number(new Date(src.startTime));
  if (!Number.isFinite(startMs)) return null;

  const offsets = Array.isArray(src.alertMinutesBefore)
    ? src.alertMinutesBefore
      .map(v => Math.floor(Number(v)))
      .filter(v => Number.isFinite(v) && v >= 0 && v <= 240)
    : [15, 5];

  const firedOffsets = Array.isArray(src.firedOffsets)
    ? src.firedOffsets
      .map(v => Math.floor(Number(v)))
      .filter(v => Number.isFinite(v) && v >= 0)
    : [];

  return {
    id,
    name: String(src.name || '').slice(0, 200),
    location: String(src.location || '').slice(0, 200),
    startTime: new Date(startMs).toISOString(),
    alertMinutesBefore: [...new Set(offsets)].sort((a, b) => b - a),
    firedOffsets: [...new Set(firedOffsets)].sort((a, b) => b - a),
  };
}

function _sanitizeEventSchedule(rawSchedule) {
  if (!Array.isArray(rawSchedule)) return [];
  const next = [];
  const seen = new Set();
  for (const raw of rawSchedule) {
    const item = _sanitizeEventScheduleEntry(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function _sanitizeSubmissionEntry(entry) {
  const src = entry && typeof entry === 'object' ? entry : {};
  const id = typeof src.id === 'string' && src.id ? src.id : '';
  if (!id) return null;

  const status = src.status === 'approved' || src.status === 'rejected' ? src.status : 'pending';
  const submittedAt = Number(src.submittedAt);
  const approvedAt = Number(src.approvedAt);
  const rejectedAt = Number(src.rejectedAt);

  return {
    id,
    message: String(src.message || '').slice(0, 800),
    submitterValue: String(src.submitterValue || '').slice(0, 120),
    status,
    submittedAt: Number.isFinite(submittedAt) ? Math.floor(submittedAt) : Date.now(),
    approvedAt: Number.isFinite(approvedAt) ? Math.floor(approvedAt) : null,
    rejectedAt: Number.isFinite(rejectedAt) ? Math.floor(rejectedAt) : null,
    photoOriginalUrl: src.photoOriginalUrl ? String(src.photoOriginalUrl) : null,
    photoThumbUrl: src.photoThumbUrl ? String(src.photoThumbUrl) : null,
    photoAssetPath: src.photoAssetPath ? String(src.photoAssetPath) : null,
    publishedPhotoId: src.publishedPhotoId ? String(src.publishedPhotoId) : null,
  };
}

function _sanitizeSubmissions(rawSubmissions) {
  if (!Array.isArray(rawSubmissions)) return [];
  const next = [];
  const seen = new Set();
  for (const raw of rawSubmissions) {
    const item = _sanitizeSubmissionEntry(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function _sanitizeSubmissionSettings(input, target) {
  if (!input || typeof input !== 'object' || !target) return;

  if (Object.prototype.hasOwnProperty.call(input, 'submissionEnabled')) {
    target.submissionEnabled = Boolean(input.submissionEnabled);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionFieldLabel')) {
    const label = String(input.submissionFieldLabel || '').trim();
    target.submissionFieldLabel = label ? label.slice(0, 40) : 'Name';
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionRequirePhoto')) {
    target.submissionRequirePhoto = Boolean(input.submissionRequirePhoto);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionDisplayMode')) {
    const mode = String(input.submissionDisplayMode || '').trim();
    target.submissionDisplayMode = SUBMISSION_DISPLAY_MODES.has(mode) ? mode : 'both';
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionDisplayIntervalSec')) {
    const val = Number(input.submissionDisplayIntervalSec);
    if (Number.isFinite(val)) {
      target.submissionDisplayIntervalSec = Math.max(10, Math.min(300, Math.floor(val)));
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionDisplayDurationSec')) {
    const val = Number(input.submissionDisplayDurationSec);
    if (Number.isFinite(val)) {
      target.submissionDisplayDurationSec = Math.max(5, Math.min(120, Math.floor(val)));
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionGridCount')) {
    const val = Number(input.submissionGridCount);
    if (Number.isFinite(val)) {
      target.submissionGridCount = Math.max(3, Math.min(12, Math.floor(val)));
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionWallShowQr')) {
    target.submissionWallShowQr = Boolean(input.submissionWallShowQr);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionWallHideWhenEmpty')) {
    target.submissionWallHideWhenEmpty = Boolean(input.submissionWallHideWhenEmpty);
  }
}

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

function sanitizeOidc(rawOidc) {
  if (!rawOidc || typeof rawOidc !== 'object') return null;

  const issuerUrl = typeof rawOidc.issuerUrl === 'string' ? rawOidc.issuerUrl.trim() : '';
  const clientId = typeof rawOidc.clientId === 'string' ? rawOidc.clientId.trim() : '';
  const clientSecret = typeof rawOidc.clientSecret === 'string' ? rawOidc.clientSecret.trim() : '';
  const redirectUri = typeof rawOidc.redirectUri === 'string' ? rawOidc.redirectUri.trim() : '';
  const providerName = typeof rawOidc.providerName === 'string' ? rawOidc.providerName.trim() : '';
  const allowedEmails = Array.isArray(rawOidc.allowedEmails)
    ? rawOidc.allowedEmails
      .map(v => String(v || '').trim().toLowerCase())
      .filter(Boolean)
    : [];

  if (!issuerUrl || !clientId || !clientSecret || !redirectUri) return null;

  return {
    issuerUrl,
    clientId,
    clientSecret,
    redirectUri,
    providerName: providerName || null,
    allowedEmails,
  };
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
  next.publicBaseUrl = typeof raw.publicBaseUrl === 'string' ? raw.publicBaseUrl.trim().slice(0, 400) : '';

  const width = Number(raw.displayWidth);
  const height = Number(raw.displayHeight);
  next.displayWidth = Number.isFinite(width) ? Math.max(320, Math.floor(width)) : 1920;
  next.displayHeight = Number.isFinite(height) ? Math.max(240, Math.floor(height)) : 1080;

  const healthBroadcastIntervalMs = Number(raw.healthBroadcastIntervalMs);
  next.healthBroadcastIntervalMs = Number.isFinite(healthBroadcastIntervalMs)
    ? Math.max(1000, Math.min(30000, Math.floor(healthBroadcastIntervalMs)))
    : 3000;

  next.sessionSecret = typeof raw.sessionSecret === 'string' && raw.sessionSecret ? raw.sessionSecret : null;

  if (raw.theme === null || raw.theme === '' || raw.theme === undefined) {
    next.theme = null;
  } else if (typeof raw.theme === 'string' && (!validThemeIds || validThemeIds.has(raw.theme))) {
    next.theme = raw.theme;
  }

  next.slides = Array.isArray(raw.slides) ? raw.slides : [];
  next.playlists = Array.isArray(raw.playlists) ? raw.playlists : [];
  next.alerts = _sanitizeAlertList(raw.alerts);
  next.eventSchedule = _sanitizeEventSchedule(raw.eventSchedule);
  next.submissions = _sanitizeSubmissions(raw.submissions);

  _sanitizeSubmissionSettings(raw, next);

  return next;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return;
  try {
    const rawParsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const { migrated, changed } = _migrateLegacyRoot(rawParsed);

    config = sanitizeConfig(migrated);

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

  const payload = JSON.stringify(config, null, 2);
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

  if (Object.prototype.hasOwnProperty.call(input, 'publicBaseUrl')) {
    target.publicBaseUrl = String(input.publicBaseUrl || '').trim().slice(0, 400);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'displayWidth')) {
    const w = Number(input.displayWidth);
    if (Number.isFinite(w)) target.displayWidth = Math.max(320, Math.floor(w));
  }

  if (Object.prototype.hasOwnProperty.call(input, 'displayHeight')) {
    const h = Number(input.displayHeight);
    if (Number.isFinite(h)) target.displayHeight = Math.max(240, Math.floor(h));
  }

  if (Object.prototype.hasOwnProperty.call(input, 'healthBroadcastIntervalMs')) {
    const ms = Number(input.healthBroadcastIntervalMs);
    if (Number.isFinite(ms)) target.healthBroadcastIntervalMs = Math.max(1000, Math.min(30000, Math.floor(ms)));
  }

  if (Object.prototype.hasOwnProperty.call(input, 'screenCount')) {
    target.screenCount = _clampScreenCount(input.screenCount);
    for (let i = 1; i <= target.screenCount; i++) {
      const id = String(i);
      if (!target.screens[id]) target.screens[id] = defaultScreenConfig();
    }
  }

  _sanitizeSubmissionSettings(input, target);

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
  const {
    sessionSecret,
    alerts,
    eventSchedule,
    submissions,
    ...rest
  } = config;
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
  sanitizeOidc,
  sanitizeConfig,
  sanitizeGlobalConfig,
  getScreenConfig,
  setScreenConfig,
  getPublicConfig,
  getConfig,
};
