// Sends screen_heartbeat and hero_claim messages to the server

let _ws        = null;
let _screenId  = null;
let _getState  = null; // function returning { layoutType, focusGroup, visibleIds, lastCycleAt, lastCycleDurationMs }
let _interval  = null;

/**
 * Start sending heartbeats.
 *
 * @param {WebSocket} ws
 * @param {string} screenId
 * @param {Function} getState - callback returning current display state
 */
export function startHeartbeat(ws, screenId, getState) {
  _ws       = ws;
  _screenId = screenId;
  _getState = getState;

  if (_interval) clearInterval(_interval);
  _interval = setInterval(sendHeartbeat, 1800);
}

export function stopHeartbeat() {
  if (_interval) clearInterval(_interval);
  _interval = null;
}

export function updateWs(ws) {
  _ws = ws;
}

function sendHeartbeat() {
  if (!_ws || _ws.readyState !== 1) return;
  const state = _getState ? _getState() : {};
  _ws.send(JSON.stringify({
    type:               'screen_heartbeat',
    screenId:           _screenId,
    layoutType:         state.layoutType         || null,
    focusGroup:         state.focusGroup         || null,
    visibleIds:         state.visibleIds         || [],
    lastCycleAt:        state.lastCycleAt        || 0,
    lastCycleDurationMs: state.lastCycleDurationMs || null,
  }));
}

/**
 * Send a hero_claim message to lock a photo as hero on this screen.
 *
 * @param {WebSocket} ws
 * @param {string} screenId
 * @param {string} photoId
 * @param {number} ttlSec
 */
export function claimHero(ws, screenId, photoId, ttlSec) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    type:     'hero_claim',
    screenId,
    photoId,
    ttlSec,
  }));
}
