// Screen entry point: identity, WebSocket, reconnect, message dispatch

import {
  setPhotos,
  addPhoto,
  removePhoto,
  updatePhoto,
  setOtherVisibleIds,
} from './photos.js';
import {
  initCycle,
  startCycle,
  stopCycle,
  updateConfig,
  updateHeroLocks,
  updateWs,
  displayState,
} from './layouts/index.js';
import { startHeartbeat, stopHeartbeat, updateWs as updateHbWs } from './heartbeat.js';
import { updateSlides, updatePlaylists, triggerPlaySoon, handleSlideAdvance } from './slides/index.js';
import { initOverlays, applyOverlays, removeAllOverlays }  from './overlays/index.js';
import { applyTheme } from './theme.js';

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

const params   = new URLSearchParams(location.search);
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

let ws       = null;
let retryTimer = null;
const RECONNECT_BASE = 2500;
const RECONNECT_JITTER = 1500;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    clearTimeout(retryTimer);
    updateWs(ws);
    updateHbWs(ws);
    startHeartbeat(ws, SCREEN_ID, () => displayState);
  };

  ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = ws.onerror = () => {
    stopHeartbeat();
    stopCycle();
    removeAllOverlays();
    retryTimer = setTimeout(connect, RECONNECT_BASE + Math.random() * RECONNECT_JITTER);
  };
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

async function handleMessage(msg) {
  switch (msg.type) {
    case 'init':
      setPhotos(msg.photos || []);
      if (msg.config) {
        updateConfig(msg.config);
        await applyTheme(msg.config.theme ?? null);
        applyOverlays(msg.config);
      }
      if (msg.heroLocks) updateHeroLocks(msg.heroLocks);
      if (msg.slides)    updateSlides(msg.slides);
      if (msg.playlists) updatePlaylists(msg.playlists);
      // Hide waiting screen as soon as we have at least one photo ready
      if ((msg.photos || []).some(p => p.status === 'ready')) hideWaiting();
      startCycle();
      break;

    case 'new_photo':
      if (msg.photo?.status === 'ready') {
        addPhoto(msg.photo);
        hideWaiting(); // first photo arrived — dismiss the waiting screen
      }
      break;

    case 'remove_photo':
      removePhoto(msg.id);
      break;

    case 'photo_update':
      if (msg.photo) updatePhoto(msg.photo);
      break;

    case 'config_update':
      if (msg.config) {
        updateConfig(msg.config);
        await applyTheme(msg.config.theme ?? null);
        applyOverlays(msg.config);
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
      if (msg.slides) updateSlides(msg.slides);
      break;

    case 'playlists_update':
      if (msg.playlists) updatePlaylists(msg.playlists);
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
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

connect();
