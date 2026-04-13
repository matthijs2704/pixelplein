'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// Config lives in the data directory so it persists in the Docker named
// volume alongside the database — no bind-mount required.
const DATA_DIR   = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure the directory exists before any read/write attempt
fs.mkdirSync(DATA_DIR, { recursive: true });
const MAX_SCREENS = 4;

const ALERT_STYLES = new Set(['banner', 'popup', 'countdown']);
const ALERT_POSITIONS = new Set(['top', 'bottom', 'center', 'top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'bottom-bar']);
const ALERT_PRIORITIES = new Set(['normal', 'urgent']);
const ALERT_TRIGGERS = new Set(['manual', 'scheduled', 'event_auto']);
const SUBMISSION_DISPLAY_MODES = new Set(['off', 'single', 'grid', 'both']);

// Overlay field names that support null-inherit from global defaults.
// When a per-screen value is null the global default is used instead.
const OVERLAY_KEYS = [
  'tickerEnabled', 'tickerMessages', 'tickerMode', 'tickerAlign',
  'tickerPosition', 'tickerSpeed', 'tickerFadeDwellSec',
  'bugEnabled', 'bugText', 'bugCorner', 'bugImageUrl',
  'qrBugEnabled', 'qrBugUrl', 'qrBugCorner', 'qrBugLabel',
  'infoBarEnabled', 'infoBarShowClock', 'infoBarShowCurrentEvent',
  'infoBarShowNextEvent',
];

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
    mosaicMinDwellMs: 3000,
    mosaicGroupSync: false,
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
    // Overlay fields — null means "inherit from global defaults"
    tickerEnabled: null,
    tickerMessages: null,
    tickerMode: null,
    tickerAlign: null,
    tickerPosition: null,
    tickerSpeed: null,
    tickerFadeDwellSec: null,
    bugEnabled: null,
    bugText: null,
    bugCorner: null,
    bugImageUrl: null,
    qrBugEnabled: null,
    qrBugUrl: null,
    qrBugCorner: null,
    qrBugLabel: null,
    infoBarEnabled: null,
    infoBarShowClock: null,
    infoBarShowCurrentEvent: null,
    infoBarShowNextEvent: null,
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
    transcodeVideos: false,   // opt-in: auto-transcode .mov/.m4v → .mp4 via ffmpeg
    sessionSecret: null,
    theme: null,
    clock24h: true,
    infoBarFontSize: 15,
    // Global overlay defaults (per-screen null fields inherit from these)
    tickerEnabled: false,
    tickerMessages: [],
    tickerMode: 'scroll',
    tickerAlign: 'start',
    tickerPosition: 'bottom',
    tickerSpeed: 60,
    tickerFadeDwellSec: 5,
    bugEnabled: false,
    bugText: '',
    bugCorner: 'top-right',
    bugImageUrl: '',
    qrBugEnabled: false,
    qrBugUrl: '',
    qrBugCorner: 'bottom-right',
    qrBugLabel: '',
    infoBarEnabled: false,
    infoBarShowClock: true,
    infoBarShowCurrentEvent: true,
    infoBarShowNextEvent: true,
    // Alert defaults (pre-fill for manually-created alerts)
    alertStyle: 'banner',
    alertPosition: 'top-center',
    alertDurationSec: 18,
    // Schedule alert defaults (for auto-generated schedule alerts)
    scheduleAlertStyle: 'banner',
    scheduleAlertPosition: 'top-center',
    scheduleAlertDurationSec: 18,
    slides: [],
    playlists: [],
    alerts: [],
    eventSchedule: [],
    submissions: [],
    submissionEnabled: true,
    submissionFieldLabel: 'Naam',
    submissionRequirePhoto: false,
    submissionWallEnabled: true,
    submissionDisplayMode: 'both',
    submissionDisplayIntervalSec: 45,
    submissionDisplayDurationSec: 12,
    submissionGridCount: 6,
    submissionWallFreshForMin: 90,
    submissionWallRepeatAfterCycles: 3,
    submissionWallMinApproved: 2,
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

// ---------------------------------------------------------------------------
// Screen config schema
// ---------------------------------------------------------------------------
// Maps every allowed screen config key to its type and constraints.
// sanitizeScreenConfig uses this to coerce and validate without per-key
// handlers — to add a new key, add one line here and you're done.
//
// Types:
//   bool           – Boolean(value)
//   number         – clamped integer in [min, max]
//   string         – String(value), falls back to spec.default when empty
//   nullableString – null | String(value)
//   enum           – one of spec.values; falls back to spec.default or unchanged
//   stringArray    – array filtered to spec.allowed; falls back to spec.fallback
//                    (or all allowed when fallback is omitted)
//   special        – handled individually after the main loop
// ---------------------------------------------------------------------------
const SCREEN_CONFIG_SCHEMA = {
  // Core playback
  layoutDuration:          { type: 'number',      min: 3000,  max: 45000 },
  transitionTime:          { type: 'number',      min: 200,   max: 3000  },
  enabledLayouts:          { type: 'stringArray', allowed: ['fullscreen','sidebyside','featuredduo','polaroid','mosaic'], fallback: ['fullscreen'] },
  transition:              { type: 'enum',        values: ['fade','slide','zoom'] },
  // Grouping
  groupMode:               { type: 'enum',        values: ['auto','manual'] },
  activeGroup:             { type: 'string',      default: 'ungrouped' },
  groupMixPct:             { type: 'number',      min: 0,     max: 80    },
  // Mosaic rhythm
  mosaicSwapRounds:        { type: 'number',      min: 0,     max: 4     },
  mosaicSwapCount:         { type: 'number',      min: 1,     max: 12    },
  mosaicMinDwellMs:        { type: 'number',      min: 500,   max: 30000 },
  mosaicGroupSync:         { type: 'bool' },
  swapStaggerMs:           { type: 'number',      min: 60,    max: 500   },
  // Template style
  cinematicWeight:         { type: 'number',      min: 0,     max: 100   },
  dynamicWeight:           { type: 'number',      min: 0,     max: 100   },
  neutralWeight:           { type: 'number',      min: 0,     max: 100   },
  templateEnabled:         { type: 'stringArray', allowed: ALLOWED_TEMPLATES },  // fallback: all allowed
  // Motion / photo selection
  kenBurnsEnabled:         { type: 'bool' },
  recencyBias:             { type: 'number',      min: 0,     max: 100   },
  minTilePx:               { type: 'number',      min: 120,   max: 400   },
  // Screen pairing
  heroCooldownSec:         { type: 'number',      min: 10,    max: 240   },
  crossScreenHeroLockSec:  { type: 'number',      min: 10,    max: 180   },
  preferHeroSide:          { type: 'enum',        values: ['auto','left','right'], default: 'auto' },
  cyclePhaseMs:            { type: 'number',      min: 0,     max: 8000  },
  // Playlist
  playlistId:              { type: 'nullableString' },
  // Ticker overlay
  tickerEnabled:           { type: 'bool' },
  tickerMessages:          { type: 'special' },  // sanitized after main loop
  tickerMode:              { type: 'enum',        values: ['fade','scroll'] },
  tickerAlign:             { type: 'enum',        values: ['start','center','end'], default: 'start' },
  tickerPosition:          { type: 'enum',        values: ['top','bottom'] },
  tickerSpeed:             { type: 'number',      min: 10,    max: 300   },
  tickerFadeDwellSec:      { type: 'number',      min: 1,     max: 60    },
  // Image bug overlay
  bugEnabled:              { type: 'bool' },
  bugText:                 { type: 'string' },
  bugCorner:               { type: 'enum',        values: ['top-left','top-right','bottom-left','bottom-right'], default: 'top-right' },
  bugImageUrl:             { type: 'string' },
  // QR bug overlay
  qrBugEnabled:            { type: 'bool' },
  qrBugUrl:                { type: 'string' },
  qrBugCorner:             { type: 'enum',        values: ['top-left','top-right','bottom-left','bottom-right'], default: 'bottom-right' },
  qrBugLabel:              { type: 'string' },
  // Info bar overlay
  infoBarEnabled:          { type: 'bool' },
  infoBarShowClock:        { type: 'bool' },
  infoBarShowCurrentEvent: { type: 'bool' },
  infoBarShowNextEvent:    { type: 'bool' },
};

// Derived from schema — all keys that sanitizeScreenConfig will accept.
const SCREEN_CONFIG_KEYS = new Set(Object.keys(SCREEN_CONFIG_SCHEMA));

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

  const endMs = src.endTime ? Number(new Date(src.endTime)) : null;
  const endTime = (Number.isFinite(endMs) && endMs > startMs) ? new Date(endMs).toISOString() : null;

  return {
    id,
    name: String(src.name || '').slice(0, 200),
    location: String(src.location || '').slice(0, 200),
    startTime: new Date(startMs).toISOString(),
    endTime,
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

  const status = src.status === 'approved' || src.status === 'rejected' || src.status === 'handled'
    ? src.status
    : 'pending';
  const kind = src.kind === 'kampkrant_tip' ? 'kampkrant_tip' : 'screen';
  const submittedAt = Number(src.submittedAt);
  const approvedAt = Number(src.approvedAt);
  const rejectedAt = Number(src.rejectedAt);
  const handledAt = Number(src.handledAt);
  const lastWallShownAt = Number(src.lastWallShownAt);
  const wallImpressions = Number(src.wallImpressions);

  return {
    id,
    kind,
    message: String(src.message || '').slice(0, 800),
    submitterValue: String(src.submitterValue || '').slice(0, 120),
    status,
    submittedAt: Number.isFinite(submittedAt) ? Math.floor(submittedAt) : Date.now(),
    approvedAt: Number.isFinite(approvedAt) ? Math.floor(approvedAt) : null,
    rejectedAt: Number.isFinite(rejectedAt) ? Math.floor(rejectedAt) : null,
    handledAt: Number.isFinite(handledAt) ? Math.floor(handledAt) : null,
    photoOriginalUrl: src.photoOriginalUrl ? String(src.photoOriginalUrl) : null,
    photoThumbUrl: src.photoThumbUrl ? String(src.photoThumbUrl) : null,
    photoAssetPath: src.photoAssetPath ? String(src.photoAssetPath) : null,
    publishedPhotoId: src.publishedPhotoId ? String(src.publishedPhotoId) : null,
    lastWallShownAt: Number.isFinite(lastWallShownAt) ? Math.floor(lastWallShownAt) : null,
    wallImpressions: Number.isFinite(wallImpressions) ? Math.max(0, Math.floor(wallImpressions)) : 0,
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
    target.submissionFieldLabel = label ? label.slice(0, 40) : 'Naam';
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionRequirePhoto')) {
    target.submissionRequirePhoto = Boolean(input.submissionRequirePhoto);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionWallEnabled')) {
    target.submissionWallEnabled = Boolean(input.submissionWallEnabled);
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

  if (Object.prototype.hasOwnProperty.call(input, 'submissionWallFreshForMin')) {
    const val = Number(input.submissionWallFreshForMin);
    if (Number.isFinite(val)) {
      target.submissionWallFreshForMin = Math.max(5, Math.min(24 * 60, Math.floor(val)));
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionWallRepeatAfterCycles')) {
    const val = Number(input.submissionWallRepeatAfterCycles);
    if (Number.isFinite(val)) {
      target.submissionWallRepeatAfterCycles = Math.max(0, Math.min(20, Math.floor(val)));
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'submissionWallMinApproved')) {
    const val = Number(input.submissionWallMinApproved);
    if (Number.isFinite(val)) {
      target.submissionWallMinApproved = Math.max(1, Math.min(20, Math.floor(val)));
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
  const src  = input || {};

  for (const [key, value] of Object.entries(src)) {
    const spec = SCREEN_CONFIG_SCHEMA[key];
    if (!spec) continue;

    // Overlay keys accept null to mean "inherit from global defaults"
    if (value === null && OVERLAY_KEYS.includes(key)) {
      next[key] = null;
      continue;
    }

    switch (spec.type) {
      case 'bool':
        next[key] = Boolean(value);
        break;

      case 'number': {
        const n = Number(value);
        if (Number.isFinite(n)) next[key] = Math.max(spec.min, Math.min(spec.max, Math.floor(n)));
        break;
      }

      case 'string':
        next[key] = String(value ?? '') || (spec.default ?? '');
        break;

      case 'nullableString':
        next[key] = value == null ? null : String(value);
        break;

      case 'enum': {
        const v = String(value);
        if (spec.values.includes(v)) next[key] = v;
        else if (spec.default !== undefined) next[key] = spec.default;
        break;
      }

      case 'stringArray': {
        const allowed  = spec.allowed;
        const filter   = v => (Array.isArray(allowed) ? allowed.includes(v) : allowed.has(v));
        const filtered = Array.isArray(value) ? value.filter(filter) : [];
        if (filtered.length) {
          next[key] = filtered;
        } else if (spec.fallback) {
          next[key] = spec.fallback;
        } else {
          // No explicit fallback: allow all
          next[key] = [...(Array.isArray(allowed) ? allowed : [...allowed])];
        }
        break;
      }

      // 'special' keys are handled individually below
    }
  }

  // tickerMessages: sanitize array of strings (max 50, each max 500 chars)
  if (Object.prototype.hasOwnProperty.call(src, 'tickerMessages')) {
    const msgs = Array.isArray(src.tickerMessages) ? src.tickerMessages : [];
    next.tickerMessages = msgs
      .map(v => String(v ?? '').trim())
      .filter(Boolean)
      .slice(0, 50)
      .map(v => v.slice(0, 500));
  }

  // Legacy migration: infoBarShowEvent → both new flags
  if (Object.prototype.hasOwnProperty.call(src, 'infoBarShowEvent')) {
    next.infoBarShowCurrentEvent = Boolean(src.infoBarShowEvent);
    next.infoBarShowNextEvent    = Boolean(src.infoBarShowEvent);
  }

  // Weight sanity: at least one weight must be non-zero
  if ((next.cinematicWeight + next.dynamicWeight + next.neutralWeight) === 0) {
    next.cinematicWeight = 65;
    next.dynamicWeight   = 25;
    next.neutralWeight   = 10;
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

// Sanitize global overlay default fields from a raw input into a target.
function _sanitizeGlobalOverlayFields(raw, target) {
  // Ticker
  if (Object.prototype.hasOwnProperty.call(raw, 'tickerEnabled')) {
    target.tickerEnabled = Boolean(raw.tickerEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'tickerMessages')) {
    const msgs = Array.isArray(raw.tickerMessages) ? raw.tickerMessages : [];
    target.tickerMessages = msgs
      .map(v => String(v ?? '').trim())
      .filter(Boolean)
      .slice(0, 50)
      .map(v => v.slice(0, 500));
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'tickerMode')) {
    target.tickerMode = raw.tickerMode === 'fade' ? 'fade' : 'scroll';
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'tickerAlign')) {
    const valid = ['start', 'center', 'end'];
    target.tickerAlign = valid.includes(raw.tickerAlign) ? raw.tickerAlign : 'start';
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'tickerPosition')) {
    target.tickerPosition = raw.tickerPosition === 'top' ? 'top' : 'bottom';
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'tickerSpeed')) {
    const v = Number(raw.tickerSpeed);
    if (Number.isFinite(v)) target.tickerSpeed = Math.max(10, Math.min(300, Math.floor(v)));
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'tickerFadeDwellSec')) {
    const v = Number(raw.tickerFadeDwellSec);
    if (Number.isFinite(v)) target.tickerFadeDwellSec = Math.max(1, Math.min(60, Math.floor(v)));
  }

  // Corner bug
  if (Object.prototype.hasOwnProperty.call(raw, 'bugEnabled')) {
    target.bugEnabled = Boolean(raw.bugEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'bugText')) {
    target.bugText = String(raw.bugText ?? '');
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'bugCorner')) {
    const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    target.bugCorner = corners.includes(raw.bugCorner) ? raw.bugCorner : 'top-right';
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'bugImageUrl')) {
    target.bugImageUrl = String(raw.bugImageUrl ?? '');
  }

  // QR bug
  if (Object.prototype.hasOwnProperty.call(raw, 'qrBugEnabled')) {
    target.qrBugEnabled = Boolean(raw.qrBugEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'qrBugUrl')) {
    target.qrBugUrl = String(raw.qrBugUrl ?? '');
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'qrBugCorner')) {
    const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    target.qrBugCorner = corners.includes(raw.qrBugCorner) ? raw.qrBugCorner : 'bottom-right';
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'qrBugLabel')) {
    target.qrBugLabel = String(raw.qrBugLabel ?? '');
  }

  // Info bar
  if (Object.prototype.hasOwnProperty.call(raw, 'infoBarEnabled')) {
    target.infoBarEnabled = Boolean(raw.infoBarEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'infoBarShowClock')) {
    target.infoBarShowClock = Boolean(raw.infoBarShowClock);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'infoBarShowCurrentEvent')) {
    target.infoBarShowCurrentEvent = Boolean(raw.infoBarShowCurrentEvent);
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'infoBarShowNextEvent')) {
    target.infoBarShowNextEvent = Boolean(raw.infoBarShowNextEvent);
  }
}

// Compare two values for overlay migration equality.
// Arrays are compared by JSON serialization; primitives by strict equality.
function _overlayValuesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

// Migrate pre-existing per-screen overlay values: if a per-screen field has an
// explicit value that matches the new global default, convert it to null so it
// inherits automatically.  This preserves current behaviour transparently.
function _migrateOverlayInherit(globalCfg, screens) {
  let changed = false;
  for (const sc of Object.values(screens)) {
    for (const key of OVERLAY_KEYS) {
      if (sc[key] !== null && sc[key] !== undefined && _overlayValuesEqual(sc[key], globalCfg[key])) {
        sc[key] = null;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Resolve a per-screen config by filling in null overlay fields from global defaults.
 * Returns a new object — does not mutate the input.
 * @param {object} globalCfg - top-level config
 * @param {object} screenCfg - per-screen config
 * @returns {object}
 */
function resolveScreenConfig(globalCfg, screenCfg) {
  const resolved = { ...screenCfg };
  for (const key of OVERLAY_KEYS) {
    if (resolved[key] === null || resolved[key] === undefined) {
      resolved[key] = globalCfg[key];
    }
  }
  return resolved;
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

  next.clock24h = raw.clock24h !== false;

  // --- Global overlay defaults ---
  _sanitizeGlobalOverlayFields(raw, next);

  // --- Alert defaults (for manually-created alerts) ---
  const alertStyle = String(raw.alertStyle || '');
  next.alertStyle = ALERT_STYLES.has(alertStyle) ? alertStyle : 'banner';
  const alertPos = String(raw.alertPosition || '');
  next.alertPosition = ALERT_POSITIONS.has(alertPos) ? alertPos : 'top-center';
  const alertDur = Number(raw.alertDurationSec);
  next.alertDurationSec = Number.isFinite(alertDur) ? Math.max(0, Math.min(3600, Math.floor(alertDur))) : 18;

  // --- Schedule alert defaults ---
  const schedAlertStyle = String(raw.scheduleAlertStyle || '');
  next.scheduleAlertStyle = ALERT_STYLES.has(schedAlertStyle) ? schedAlertStyle : 'banner';
  const schedAlertPos = String(raw.scheduleAlertPosition || '');
  next.scheduleAlertPosition = ALERT_POSITIONS.has(schedAlertPos) ? schedAlertPos : 'top-center';
  const schedAlertDur = Number(raw.scheduleAlertDurationSec);
  next.scheduleAlertDurationSec = Number.isFinite(schedAlertDur) ? Math.max(0, Math.min(3600, Math.floor(schedAlertDur))) : 18;

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

  // Migrate per-screen overlay values that match global defaults to null
  _migrateOverlayInherit(next, next.screens);

  return next;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return;
  try {
    const rawParsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const { migrated, changed } = _migrateLegacyRoot(rawParsed);

    // Detect if any per-screen overlay fields need null-inherit migration
    const hadGlobalOverlays = Object.prototype.hasOwnProperty.call(migrated, 'tickerEnabled');
    config = sanitizeConfig(migrated);
    const needsSave = changed || !hadGlobalOverlays;

    if (needsSave) saveConfig();
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

  if (Object.prototype.hasOwnProperty.call(input, 'clock24h')) {
    target.clock24h = Boolean(input.clock24h);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'infoBarFontSize')) {
    const v = Number(input.infoBarFontSize);
    if (Number.isFinite(v)) target.infoBarFontSize = Math.max(8, Math.min(60, Math.floor(v)));
  }

  if (Object.prototype.hasOwnProperty.call(input, 'scheduleAlertStyle')) {
    const v = String(input.scheduleAlertStyle || '');
    target.scheduleAlertStyle = ALERT_STYLES.has(v) ? v : 'banner';
  }

  if (Object.prototype.hasOwnProperty.call(input, 'scheduleAlertPosition')) {
    const v = String(input.scheduleAlertPosition || '');
    target.scheduleAlertPosition = ALERT_POSITIONS.has(v) ? v : 'top-center';
  }

  if (Object.prototype.hasOwnProperty.call(input, 'scheduleAlertDurationSec')) {
    const v = Number(input.scheduleAlertDurationSec);
    if (Number.isFinite(v)) target.scheduleAlertDurationSec = Math.max(0, Math.min(3600, Math.floor(v)));
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

  if (Object.prototype.hasOwnProperty.call(input, 'transcodeVideos')) {
    target.transcodeVideos = Boolean(input.transcodeVideos);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'screenCount')) {
    target.screenCount = _clampScreenCount(input.screenCount);
    for (let i = 1; i <= target.screenCount; i++) {
      const id = String(i);
      if (!target.screens[id]) target.screens[id] = defaultScreenConfig();
    }
  }

  // Global overlay defaults
  _sanitizeGlobalOverlayFields(input, target);

  // Alert defaults (for manually-created alerts)
  if (Object.prototype.hasOwnProperty.call(input, 'alertStyle')) {
    const v = String(input.alertStyle || '');
    target.alertStyle = ALERT_STYLES.has(v) ? v : 'banner';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'alertPosition')) {
    const v = String(input.alertPosition || '');
    target.alertPosition = ALERT_POSITIONS.has(v) ? v : 'top-center';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'alertDurationSec')) {
    const v = Number(input.alertDurationSec);
    if (Number.isFinite(v)) target.alertDurationSec = Math.max(0, Math.min(3600, Math.floor(v)));
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
  OVERLAY_KEYS,
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
  resolveScreenConfig,
  getScreenConfig,
  setScreenConfig,
  getPublicConfig,
  getConfig,
};
