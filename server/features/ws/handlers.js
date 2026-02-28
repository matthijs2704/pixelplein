'use strict';

const state  = require('../../state');
const { broadcast, broadcastToScreens } = require('./broadcast');
const { updateSlide, getSlides }        = require('../slides/store');
const { getConfig }                     = require('../../config');

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
    if (ws.screenId) ids.add(ws.screenId);
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

function handleMessage(ws, msg) {
  // --- Screen heartbeat ---
  if (msg.type === 'screen_heartbeat') {
    const screenId = String(msg.screenId || 'unknown');
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
    const photoId  = String(msg.photoId || '');
    const screenId = String(msg.screenId || ws.screenId || 'unknown');
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

  // --- Admin: reload all screen clients ---
  if (msg.type === 'admin_reload_screens') {
    broadcastToScreens({ type: 'reload', delayMs: 1500 });
    return;
  }

  // --- Screen: slide ended (non-coordinated — clears playSoon flag) ---
  if (msg.type === 'slide_ended') {
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
}

// ---------------------------------------------------------------------------
// Handle a WebSocket client disconnecting
// ---------------------------------------------------------------------------

function handleClose(ws) {
  if (ws.screenId) {
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
