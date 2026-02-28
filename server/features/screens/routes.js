'use strict';

const express = require('express');
const state   = require('../../state');
const {
  MAX_SCREENS,
  getConfig,
  getPublicConfig,
  saveConfig,
  sanitizeScreenConfig,
  sanitizeGlobalConfig,
  defaultScreenConfig,
} = require('../../config');
const { getValidThemeIds } = require('../themes/store');
const { broadcast } = require('../ws/broadcast');
const { serializeHeroLocks, pruneHeroLocks } = require('../ws/handlers');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------
router.get('/config', (_req, res) => {
  res.json(getPublicConfig());
});

// ---------------------------------------------------------------------------
// POST /api/config
// ---------------------------------------------------------------------------
router.post('/config', (req, res) => {
  const config = getConfig();
  const body = req.body || {};

  for (const [id, patch] of Object.entries(body.screens || {}).filter(([id]) => {
    const n = Number(id);
    return Number.isInteger(n) && n >= 1 && n <= MAX_SCREENS;
  })) {
    const key = String(Number(id));
    config.screens[key] = sanitizeScreenConfig(patch, config.screens[key] || defaultScreenConfig());
  }

  sanitizeGlobalConfig(body, config, getValidThemeIds());
  saveConfig();
  broadcast({ type: 'config_update', config: getPublicConfig() });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/stats
// ---------------------------------------------------------------------------
router.get('/stats', (_req, res) => {
  res.json(buildStats());
});

// ---------------------------------------------------------------------------
// GET /health — lightweight liveness probe for monitoring / Docker health checks
// ---------------------------------------------------------------------------
router.get('/health', (_req, res) => {
  const photos  = Array.from(state.photosById.values());
  const ready   = photos.filter(p => p.status === 'ready').length;
  const screens = Array.from(state.screenHealth.values()).filter(s => s.connected).length;
  res.json({
    status:           'ok',
    uptimeSec:        Math.floor(process.uptime()),
    photosReady:      ready,
    screensConnected: screens,
  });
});

// ---------------------------------------------------------------------------
// Stats builder (also used by WS periodic broadcast)
// ---------------------------------------------------------------------------
function buildStats() {
  const photos     = Array.from(state.photosById.values());
  const total      = photos.length;
  const ready      = photos.filter(p => p.status === 'ready').length;
  const processing = photos.filter(p => p.status === 'processing').length;
  const queued     = photos.filter(p => p.status === 'queued').length;
  const failed     = photos.filter(p => p.status === 'failed').length;
  const hourAgo    = Date.now() - 3_600_000;
  const addedLastHour = photos.filter(p => p.addedAt > hourAgo).length;

  const groups = {};
  for (const p of photos) groups[p.eventGroup] = (groups[p.eventGroup] || 0) + 1;

  const now = Date.now();
  const screens = Array.from(state.screenHealth.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([screenId, data]) => ({
      screenId,
      connected:           Boolean(data.connected),
      lastSeenAt:          data.lastSeenAt || 0,
      heartbeatAgeMs:      data.lastSeenAt ? now - data.lastSeenAt : null,
      lastCycleAt:         data.lastCycleAt || 0,
      lastCycleDurationMs: data.lastCycleDurationMs || null,
      layoutType:          data.layoutType || null,
      focusGroup:          data.focusGroup || null,
      reconnects:          data.reconnects || 0,
      visiblePhotoIds:     Array.isArray(data.visiblePhotoIds) ? data.visiblePhotoIds : [],
    }));

  return {
    photos: { total, ready, processing, queued, failed, addedLastHour, groups },
    cache: {
      coveragePct:    total ? Math.round((ready / total) * 100) : 100,
      queueDepth:     state.queue.length,
      activeWorkers:  state.activeWorkers,
      completed:      state.metrics.queueCompleted,
      failed:         state.metrics.queueFailed,
      cacheFileServed: state.metrics.cacheFileServed,
      lastIngestAt:   state.metrics.lastIngestAt,
      lastScanAt:     state.metrics.lastScanAt,
    },
    screens,
    heroLocks: serializeHeroLocks(),
  };
}

module.exports = router;
module.exports.buildStats = buildStats;
