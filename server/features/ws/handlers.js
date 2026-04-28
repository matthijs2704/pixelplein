'use strict';

const state  = require('../../state');
const { broadcast } = require('./broadcast');
const { updateSlide, getSlides }        = require('../slides/store');
const { getReadyPhotos }                = require('../photos/serialize');
const { getConfig, getPublicConfig }    = require('../../config');
const { getActiveAlerts, getEventSchedule } = require('../alerts/store');
const { getApprovedSubmissions }        = require('../submissions/store');
const { verifyScreenToken }             = require('../screens/devices');

// ---------------------------------------------------------------------------
// Hero lock helpers
// ---------------------------------------------------------------------------

function pruneHeroLocks() {
  const now = Date.now();
  for (const [photoId, lock] of state.heroLocks.entries()) {
    if (!lock || lock.expiresAt <= now) state.heroLocks.delete(photoId);
  }
}

function serializeHeroLocks() {
  pruneHeroLocks();
  return Array.from(state.heroLocks.entries()).map(([photoId, lock]) => ({
    photoId,
    screenId:  lock.screenId,
    expiresAt: lock.expiresAt,
  }));
}

// ---------------------------------------------------------------------------
// Coordination state
// ---------------------------------------------------------------------------
//
// Tracks which screens have finished playing the current coordinated slide and
// are waiting for the server's "go ahead" before advancing their pointer.
//
// Shape per playlistId:
//   { slideId: string, ready: Set<screenId>, timer: TimeoutHandle | null }
//
// When both participating screens report ready (or only one screen is
// connected), the server fires slide_advance to all screens that share that
// playlist and clears the entry.

const _coordState = new Map(); // playlistId → { slideId, ready, timer }

// How long to wait for the second screen before giving up and advancing alone.
const COORD_TIMEOUT_MS = 15_000;

function _getConnectedScreenIds() {
  const ids = new Set();
  const { _getWss } = require('./broadcast');
  const wss = _getWss?.();
  if (!wss) return ids;
  for (const ws of wss.clients) {
    if (ws.clientType === 'screen' && ws.screenId) ids.add(ws.screenId);
  }
  return ids;
}

function _screensUsingPlaylist(playlistId) {
  const cfg = getConfig();
  const screens = [];
  for (const [id, screenCfg] of Object.entries(cfg.screens || {})) {
    if (screenCfg?.playlistId === playlistId) screens.push(String(id));
  }
  return screens;
}

function _tryAdvance(playlistId) {
  const entry = _coordState.get(playlistId);
  if (!entry) return;

  // Which screens are currently using this playlist AND connected?
  const connected = _getConnectedScreenIds();
  const using = _screensUsingPlaylist(playlistId).filter(id => connected.has(id));

  // Advance if all connected screens using this playlist are ready, or at
  // least one is ready and no other is connected.
  const allReady = using.length > 0 && using.every(id => entry.ready.has(id));
  if (!allReady) return;

  // Fire advance to every WS client (screens will ignore if not in this playlist)
  clearTimeout(entry.timer);
  _coordState.delete(playlistId);
  broadcast({ type: 'slide_advance', playlistId, slideId: entry.slideId });
}

// ---------------------------------------------------------------------------
// Handle an incoming WebSocket message from any client
// ---------------------------------------------------------------------------

async function _handleScreenAuth(ws, msg) {
  const screenId = String(msg.screenId || '');
  const device = await verifyScreenToken({
    deviceId: msg.deviceId,
    token:    msg.token,
    screenId,
  });

  if (!device) {
    ws.send(JSON.stringify({ type: 'screen_auth_failed' }));
    ws.close(1008, 'screen auth failed');
    return;
  }

  ws.authenticated = true;
  ws.clientType = 'screen';
  ws.deviceId = device.deviceId;
  ws.screenId = device.screenId;

  ws.send(JSON.stringify({
    type:     'screen_auth_ok',
    screenId: device.screenId,
  }));
  _sendScreenInit(ws);
}

async function _handleAgentAuth(ws, msg) {
  const screenId = String(msg.screenId || '');
  const device = await verifyScreenToken({
    deviceId: msg.deviceId,
    token:    msg.token,
    screenId,
  });

  if (!device) {
    ws.send(JSON.stringify({ type: 'agent_auth_failed' }));
    ws.close(1008, 'agent auth failed');
    return;
  }

  ws.authenticated = true;
  ws.clientType = 'agent';
  ws.deviceId = device.deviceId;
  ws.screenId = device.screenId;
  ws.agentCapabilities = Array.isArray(msg.capabilities) ? msg.capabilities.map(String) : [];
  ws.agentLastSeenAt = Date.now();

  ws.send(JSON.stringify({
    type:     'agent_auth_ok',
    screenId: device.screenId,
  }));
}

function _sendScreenInit(ws) {
  const cfg = getConfig();
  ws.send(JSON.stringify({
    type:       'init',
    config:     getPublicConfig(),
    heroLocks:  serializeHeroLocks(),
    slides:     cfg.slides    || [],
    playlists:  cfg.playlists || [],
    alerts:     getActiveAlerts(),
    eventSchedule: [...getEventSchedule()].sort((a, b) => Number(new Date(a.startTime)) - Number(new Date(b.startTime))),
    approvedSubmissions: getApprovedSubmissions(80),
    totalPhotos: getReadyPhotos().length,
  }));
}

function handleMessage(ws, msg) {
  if (msg.type === 'screen_auth') {
    _handleScreenAuth(ws, msg).catch(() => {
      try { ws.close(1011, 'screen auth error'); } catch {}
    });
    return;
  }

  if (msg.type === 'agent_auth') {
    _handleAgentAuth(ws, msg).catch(() => {
      try { ws.close(1011, 'agent auth error'); } catch {}
    });
    return;
  }

  if (!ws.authenticated) return;

  if (msg.type === 'agent_heartbeat') {
    if (ws.clientType !== 'agent') return;
    ws.agentLastSeenAt = Date.now();
    ws.agentStatus = msg.status && typeof msg.status === 'object' ? msg.status : null;
    return;
  }

  if (msg.type === 'agent_command_result') {
    if (ws.clientType !== 'agent') return;
    ws.agentLastSeenAt = Date.now();
    ws.lastCommandResult = {
      commandId: String(msg.commandId || ''),
      command:   String(msg.command || ''),
      ok:        Boolean(msg.ok),
      error:     String(msg.error || ''),
      at:        Date.now(),
    };
    return;
  }

  // --- Screen heartbeat ---
  if (msg.type === 'screen_heartbeat') {
    if (ws.clientType !== 'screen') return;
    const screenId = String(msg.screenId || 'unknown');
    if (screenId !== ws.screenId) return;
    const prev     = state.screenHealth.get(screenId) || { reconnects: 0 };
    const reconnects = prev.connected ? prev.reconnects : (prev.reconnects || 0) + 1;
    state.screenHealth.set(screenId, {
      connected:          true,
      reconnects,
      lastSeenAt:         Date.now(),
      lastCycleAt:        msg.lastCycleAt || 0,
      lastCycleDurationMs: msg.lastCycleDurationMs || null,
      layoutType:         msg.layoutType || null,
      focusGroup:         msg.focusGroup || null,
      visiblePhotoIds:    Array.isArray(msg.visibleIds) ? msg.visibleIds.slice(0, 24) : [],
    });
    ws.screenId = screenId;
    return;
  }

  // --- Hero claim ---
  if (msg.type === 'hero_claim') {
    if (ws.clientType !== 'screen') return;
    const photoId  = String(msg.photoId || '');
    const screenId = String(msg.screenId || ws.screenId || 'unknown');
    if (screenId !== ws.screenId) return;
    if (!photoId) return;

    const ttlSec    = Math.max(10, Math.min(180, Math.floor(msg.ttlSec || 30)));
    const expiresAt = Date.now() + ttlSec * 1000;
    const existing  = state.heroLocks.get(photoId);

    if (!existing || existing.expiresAt < Date.now() || existing.screenId === screenId) {
      state.heroLocks.set(photoId, { screenId, expiresAt });
    }

    broadcast({ type: 'hero_locks', locks: serializeHeroLocks() });
    return;
  }

  // --- Screen: slide ended (non-coordinated — clears playSoon flag) ---
  if (msg.type === 'slide_ended') {
    if (ws.clientType !== 'screen') return;
    const slideId = String(msg.slideId || '');
    if (!slideId) return;
    const slide = getConfig().slides.find(s => s.id === slideId);
    if (slide && slide.playSoon) {
      updateSlide(slideId, { playSoon: false });
      broadcast({ type: 'slides_update', slides: getSlides() });
    }
    return;
  }

  // --- Screen: slide_ready (coordinated playlist — screen finished playing) ---
  if (msg.type === 'slide_ready') {
    if (ws.clientType !== 'screen') return;
    const slideId    = String(msg.slideId    || '');
    const playlistId = String(msg.playlistId || '');
    const screenId   = String(msg.screenId   || ws.screenId || '');
    if (!slideId || !playlistId || !screenId) return;

    // Also clear playSoon on coordinated slides
    const slide = getConfig().slides.find(s => s.id === slideId);
    if (slide && slide.playSoon) {
      updateSlide(slideId, { playSoon: false });
      broadcast({ type: 'slides_update', slides: getSlides() });
    }

    // Create or update coord entry for this playlist
    let entry = _coordState.get(playlistId);
    if (!entry || entry.slideId !== slideId) {
      // New slide cycle; discard any stale entry
      if (entry) clearTimeout(entry.timer);
      entry = { slideId, ready: new Set(), timer: null };
      _coordState.set(playlistId, entry);
    }
    entry.ready.add(screenId);

    // Set a timeout so we don't wait forever for a screen that's offline
    if (!entry.timer) {
      entry.timer = setTimeout(() => {
        _tryAdvance(playlistId);
      }, COORD_TIMEOUT_MS);
    }

    _tryAdvance(playlistId);
    return;
  }

  // --- Screen: request photo delta sync ---
  if (msg.type === 'sync_photos') {
    if (ws.clientType !== 'screen') return;
    const knownIds = new Set(Array.isArray(msg.knownIds) ? msg.knownIds.map(String) : []);
    const readyPhotos = getReadyPhotos();
    const serverIds = new Set(readyPhotos.map(p => p.id));

    const toAdd = readyPhotos.filter(p => !knownIds.has(p.id));
    const toRemove = Array.from(knownIds).filter(id => !serverIds.has(id));

    const BATCH_SIZE = 50;
    const total = toAdd.length;
    let sent = 0;

    const sendBatch = (offset) => {
      if (ws.readyState !== 1) return;

      if (offset >= toAdd.length) {
        if (!toAdd.length && toRemove.length) {
          ws.send(JSON.stringify({
            type: 'photo_batch',
            photos: [],
            remove: toRemove,
            progress: { sent: 0, total },
          }));
        }
        ws.send(JSON.stringify({ type: 'sync_complete', total }));
        return;
      }

      const photos = toAdd.slice(offset, offset + BATCH_SIZE);
      sent += photos.length;
      ws.send(JSON.stringify({
        type: 'photo_batch',
        photos,
        remove: offset === 0 ? toRemove : [],
        progress: { sent, total },
      }));

      setImmediate(() => sendBatch(offset + BATCH_SIZE));
    };

    sendBatch(0);
    return;
  }
}

// ---------------------------------------------------------------------------
// Handle a WebSocket client disconnecting
// ---------------------------------------------------------------------------

function handleClose(ws) {
  if (ws.clientType === 'screen' && ws.screenId) {
    const prev = state.screenHealth.get(ws.screenId);
    if (prev) {
      state.screenHealth.set(ws.screenId, { ...prev, connected: false, lastSeenAt: Date.now() });
    }

    // If this screen was the only one missing for a coordinated advance, unblock it now
    for (const [playlistId] of _coordState) {
      _tryAdvance(playlistId);
    }
  }
}

module.exports = { handleMessage, handleClose, pruneHeroLocks, serializeHeroLocks };
