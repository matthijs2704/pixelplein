'use strict';

const { WebSocketServer } = require('ws');
const { setWss, broadcast } = require('./broadcast');
const { handleMessage, handleClose, pruneHeroLocks, serializeHeroLocks } = require('./handlers');
const { getReadyPhotos } = require('../photos/serialize');
const { getConfig, getPublicConfig } = require('../../config');
const { buildStats } = require('../screens/routes');

function createWss(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });
  setWss(wss);

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------
  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', function () { this.isAlive = true; });

    // Send full initial state on connect
    const cfg = getConfig();
    ws.send(JSON.stringify({
      type:       'init',
      photos:     getReadyPhotos(),
      config:     getPublicConfig(),
      heroLocks:  serializeHeroLocks(),
      slides:     cfg.slides    || [],
      playlists:  cfg.playlists || [],
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

  // Health broadcast every 3 s
  setInterval(() => {
    broadcast({ type: 'health_update', stats: buildStats() });
  }, 3_000);

  // Prune expired hero locks every 5 s
  setInterval(() => {
    const before = require('../../state').heroLocks.size;
    pruneHeroLocks();
    if (require('../../state').heroLocks.size !== before) {
      broadcast({ type: 'hero_locks', locks: serializeHeroLocks() });
    }
  }, 5_000);

  return wss;
}

module.exports = { createWss };

// Re-export the stored wss so index.js can close it on shutdown
module.exports.getWss = () => require('./broadcast').getWss();
