'use strict';

const { WebSocketServer } = require('ws');
const { setWss, broadcast } = require('./broadcast');
const { handleMessage, handleClose, pruneHeroLocks, serializeHeroLocks } = require('./handlers');
const { getReadyPhotos } = require('../photos/serialize');
const { getConfig, getPublicConfig } = require('../../config');
const { buildStats } = require('../screens/routes');
const { getActiveAlerts, getEventSchedule } = require('../alerts/store');
const { getApprovedSubmissions } = require('../submissions/store');
const state = require('../../state');

let _healthTimer = null;

function restartHealthBroadcast() {
  if (_healthTimer) clearInterval(_healthTimer);
  const intervalMs = getConfig().healthBroadcastIntervalMs || 3000;
  _healthTimer = setInterval(() => {
    broadcast({ type: 'health_update', stats: buildStats() });
  }, intervalMs);
}

function createWss(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });
  setWss(wss);

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------
  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', function () { this.isAlive = true; });

    // Send initial state on connect; photos are synced in batches after init
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

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      handleMessage(ws, msg);
    });

    ws.on('close', () => handleClose(ws));
    ws.on('error', () => {});
  });

  // ---------------------------------------------------------------------------
  // Periodic tasks
  // ---------------------------------------------------------------------------

  // Ping / pong keepalive — terminate dead connections
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 10_000);

  // Health broadcast every configured interval
  restartHealthBroadcast();

  // Prune expired hero locks every 5 s
  setInterval(() => {
    const before = state.heroLocks.size;
    pruneHeroLocks();
    if (state.heroLocks.size !== before) {
      broadcast({ type: 'hero_locks', locks: serializeHeroLocks() });
    }
  }, 5_000);

  return wss;
}

module.exports = { createWss, restartHealthBroadcast };

// Re-export the stored wss so index.js can close it on shutdown
module.exports.getWss = () => require('./broadcast')._getWss();
