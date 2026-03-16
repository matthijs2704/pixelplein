// Screen entry point: identity, WebSocket, reconnect, message dispatch

import {
  photoRegistry,
  addPhoto,
  removePhoto,
  removePhotos,
  updatePhoto,
  setOtherVisibleIds,
  resetPhotoState,
} from './photos.js';
import {
  initCycle,
  startCycle,
  stopCycle,
  updateConfig,
  updateHeroLocks,
  displayState,
} from './layouts/index.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { setWs, clearWs, sendSyncPhotos }  from './ws-send.js';
import { updateSlides as _updateSlides, updatePlaylists as _updatePlaylists, triggerPlaySoon, handleSlideAdvance } from './slides/index.js';
import {
  initOverlays,
  applyOverlays,
  removeAllOverlays,
  setAlerts,
  pushAlert,
  removeAlert,
  setSchedule,
} from './overlays/index.js';
import { setApprovedSubmissions, addApprovedSubmission } from './submissions.js';
import { applyTheme }    from './theme.js';
import { preloadBatch, getPreloadedCount } from './preload.js';
import { preloadSlideAssets, resetSlidePreload } from './slide-preload.js';
import {
  showSyncStatus,
  hideSyncStatus,
  resetSyncStatus,
  onCycleStarted,
  showOfflineBadge,
  hideOfflineBadge,
} from './sync-status.js';
import {
  savePhotos  as idbSavePhotos,
  loadPhotos  as idbLoadPhotos,
  saveMeta    as idbSaveMeta,
  loadMeta    as idbLoadMeta,
  removePhotos as idbRemovePhotos,
} from './idb.js';

// ---------------------------------------------------------------------------
// Waiting screen
// ---------------------------------------------------------------------------

const waitingEl = document.getElementById('waiting');

function hideWaiting() {
  if (!waitingEl || waitingEl.classList.contains('hidden')) return;
  waitingEl.classList.add('hidden');
  // Remove from DOM after fade so it can't intercept pointer events
  setTimeout(() => waitingEl.remove(), 900);
}

function showWaiting() {
  if (!waitingEl) return;
  waitingEl.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Screen identity
// ---------------------------------------------------------------------------

const params    = new URLSearchParams(location.search);
const SCREEN_ID = params.get('screen') || '1';

document.title = `Screen ${SCREEN_ID}`;

// ---------------------------------------------------------------------------
// Mount point
// ---------------------------------------------------------------------------

const container = document.getElementById('display');
if (!container) throw new Error('Missing #display element');
initCycle(container, SCREEN_ID);
initOverlays(SCREEN_ID);

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

let ws             = null;
let retryTimer     = null;
let cycleStartTimer = null;
let _cycleRunning  = false;  // true once startCycle() has been called

// Local mirrors of slide library + playlists so slide_update handlers can
// cross-reference without importing from slides/index.js (which owns them).
let _slides    = [];
let _playlists = [];

function updateSlides(slides) {
  _slides = slides || [];
  _updateSlides(_slides);
}

function updatePlaylists(playlists) {
  _playlists = playlists || [];
  _updatePlaylists(_playlists);
}

const RECONNECT_BASE      = 2500;
const RECONNECT_JITTER    = 1500;
const PRELOAD_WAIT_MAX_MS = 1200;  // max wait for preloads before starting cycle
const PRELOAD_POLL_MS     = 120;   // interval for checking preload readiness
const PRELOAD_INITIAL_DELAY = 80;  // delay before first preload check

function scheduleCycleStart() {
  if (cycleStartTimer) return;
  const startedAt = Date.now();

  const tick = () => {
    cycleStartTimer = null;
    if (!photoRegistry.size) return;

    const waitedMs = Date.now() - startedAt;
    if (getPreloadedCount() > 0 || waitedMs >= PRELOAD_WAIT_MAX_MS) {
      hideWaiting();
      if (!_cycleRunning) {
        _cycleRunning = true;
        startCycle();
        onCycleStarted();
      }
      return;
    }

    cycleStartTimer = setTimeout(tick, PRELOAD_POLL_MS);
  };

  cycleStartTimer = setTimeout(tick, PRELOAD_INITIAL_DELAY);
}

// ---------------------------------------------------------------------------
// Boot from IDB cache (offline / pre-connect path)
// ---------------------------------------------------------------------------

async function bootFromCache() {
  let photos, config, slides, playlists;
  try {
    [photos, config, slides, playlists] = await Promise.all([
      idbLoadPhotos(),
      idbLoadMeta('config'),
      idbLoadMeta('slides'),
      idbLoadMeta('playlists'),
    ]);
  } catch {
    return; // IDB unavailable — proceed to normal WS connect
  }

  if (!photos?.length) return; // nothing cached yet

  if (config) {
    updateConfig(config);
    applyTheme(config.theme ?? null).catch(() => {});
    applyOverlays(config);
  }
  if (slides)    updateSlides(slides);
  if (playlists) updatePlaylists(playlists);

  for (const photo of photos) {
    if (photo?.status === 'ready') addPhoto(photo);
  }

  preloadBatch(photos);
  if (slides && playlists) preloadSlideAssets(slides, playlists);
  scheduleCycleStart();
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    clearTimeout(retryTimer);
    hideOfflineBadge();
    setWs(ws, SCREEN_ID);
    startHeartbeat(SCREEN_ID, () => displayState);
  };

  ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onerror = () => {};  // 'close' always follows an error; handle there

  ws.onclose = () => {
    clearWs();
    stopHeartbeat();
    resetSyncStatus(); // immediate — offline badge takes over if cycle is running

    if (_cycleRunning && photoRegistry.size > 0) {
      // Keep the cycle alive from cached photos; reconnect quietly in background
      showOfflineBadge();
    } else {
      // Nothing cached yet — fall back to the waiting screen
      stopCycle();
      removeAllOverlays();
      resetPhotoState();
      _cycleRunning = false;
      if (cycleStartTimer) {
        clearTimeout(cycleStartTimer);
        cycleStartTimer = null;
      }
    }

    retryTimer = setTimeout(connect, RECONNECT_BASE + Math.random() * RECONNECT_JITTER);
  };
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

async function handleMessage(msg) {
  switch (msg.type) {
    case 'init':
      if (msg.config) {
        updateConfig(msg.config);
        await applyTheme(msg.config.theme ?? null);
        applyOverlays(msg.config);
        idbSaveMeta('config', msg.config).catch(() => {});
      }
      if (msg.heroLocks) updateHeroLocks(msg.heroLocks);
      if (msg.slides) {
        updateSlides(msg.slides);
        idbSaveMeta('slides', msg.slides).catch(() => {});
      }
      if (msg.playlists) {
        updatePlaylists(msg.playlists);
        idbSaveMeta('playlists', msg.playlists).catch(() => {});
      }
      // Kick off slide asset preloading whenever we have fresh slides+playlists
      if (msg.slides || msg.playlists) {
        const allSlides    = msg.slides    || [];
        const allPlaylists = msg.playlists || [];
        if (allSlides.length && allPlaylists.length) {
          preloadSlideAssets(allSlides, allPlaylists);
        }
      }
      if (msg.alerts)          setAlerts(msg.alerts);
      if (msg.eventSchedule)   setSchedule(msg.eventSchedule);
      if (msg.approvedSubmissions) setApprovedSubmissions(msg.approvedSubmissions);

      if (photoRegistry.size > 0) {
        scheduleCycleStart();
      }

      if (ws && ws.readyState === 1) {
        const knownIds    = Array.from(photoRegistry.keys());
        const totalPhotos = Number(msg.totalPhotos || 0);
        if (totalPhotos > 0 || knownIds.length > 0) showSyncStatus(0, totalPhotos);
        sendSyncPhotos(knownIds);
      }
      break;

    case 'photo_batch': {
      const removed = Array.isArray(msg.remove) ? msg.remove : [];
      if (removed.length) {
        removePhotos(removed);
        idbRemovePhotos(removed).catch(() => {});
      }

      const incoming = Array.isArray(msg.photos) ? msg.photos : [];
      for (const photo of incoming) {
        if (photo?.status === 'ready') addPhoto(photo);
      }
      preloadBatch(incoming);

      if (msg.progress) {
        showSyncStatus(msg.progress.sent || 0, msg.progress.total || 0);
      }

      if (photoRegistry.size > 0) {
        scheduleCycleStart();
      }
      break;
    }

    case 'sync_complete':
      hideSyncStatus();
      if (photoRegistry.size > 0) {
        scheduleCycleStart();
        // Persist the full up-to-date registry so cache is consistent
        idbSavePhotos(Array.from(photoRegistry.values())).catch(() => {});
      }
      break;

    case 'new_photo':
      if (msg.photo?.status === 'ready') {
        addPhoto(msg.photo);
        preloadBatch([msg.photo]);
        idbSavePhotos([msg.photo]).catch(() => {});
        scheduleCycleStart();
      }
      break;

    case 'remove_photo':
      removePhoto(msg.id);
      idbRemovePhotos([msg.id]).catch(() => {});
      break;

    case 'photo_update':
      if (msg.photo) updatePhoto(msg.photo);
      break;

    case 'config_update':
      if (msg.config) {
        updateConfig(msg.config);
        await applyTheme(msg.config.theme ?? null);
        applyOverlays(msg.config);
        idbSaveMeta('config', msg.config).catch(() => {});
      }
      break;

    case 'hero_locks':
      updateHeroLocks(msg.locks || []);
      break;

    case 'health_update':
      // Extract the other screen's visible IDs for cross-screen avoidance
      if (msg.stats?.screens) {
        const other = msg.stats.screens.find(s => s.screenId !== SCREEN_ID);
        if (other) setOtherVisibleIds(other.visiblePhotoIds || []);
      }
      break;

    case 'slides_update':
      if (msg.slides) {
        updateSlides(msg.slides);
        idbSaveMeta('slides', msg.slides).catch(() => {});
        // Re-run preload in case new slides were added or enabled
        resetSlidePreload();
        preloadSlideAssets(msg.slides, _playlists);
      }
      break;

    case 'playlists_update':
      if (msg.playlists) {
        updatePlaylists(msg.playlists);
        idbSaveMeta('playlists', msg.playlists).catch(() => {});
        resetSlidePreload();
        preloadSlideAssets(_slides, msg.playlists);
      }
      break;

    case 'play_soon':
      if (msg.slideId) triggerPlaySoon(msg.slideId);
      break;

    case 'slide_advance':
      if (msg.playlistId) handleSlideAdvance(msg.playlistId);
      break;

    case 'reload':
      setTimeout(() => location.reload(), msg.delayMs ?? 1500);
      break;

    case 'schedule_update':
      if (msg.schedule) setSchedule(msg.schedule);
      break;

    case 'alert_fire':
      if (msg.alert) pushAlert(msg.alert);
      break;

    case 'alert_dismiss':
      if (msg.alertId) removeAlert(msg.alertId);
      break;

    case 'submission_approved':
      if (msg.submission) addApprovedSubmission(msg.submission);
      break;
  }
}

// ---------------------------------------------------------------------------
// Start — boot from cache first, then open WS in parallel
// ---------------------------------------------------------------------------

bootFromCache().catch(() => {}).finally(() => connect());
