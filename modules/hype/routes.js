'use strict';

// Admin REST routes for the Hype module. All require auth (mounted with
// requireAuth in module.js). Mounted at /api/modules/hype.

const express = require('express');
const path = require('path');
const fs = require('fs');

const hypeDb = require('./db');
const state  = require('./state');
const engine = require('./engine');
const streamChat = require('./stream-chat');

/* ── OSM tile proxy + disk cache ──────────────────────────────────────
 * The trace scene zooms over real map tiles. We proxy + cache them so the
 * night game doesn't depend on festival wifi once prefetched from admin.
 * Constants must match alerts/trace.js (GRID/ZOOM_MIN/ZOOM_MAX).
 */
const TILE_DIR = path.join(__dirname, '..', '..', 'data', 'hype-tiles');
const TILE_UA = 'PixelPlein-DeHype/1.0 (+camp photo display)';
const TILE_GRID = 5, TILE_ZMIN = 8, TILE_ZMAX = 17;

async function _getTile(z, x, y) {
  const file = path.join(TILE_DIR, String(z), String(x), `${y}.png`);
  try { return await fs.promises.readFile(file); } catch { /* cache miss */ }
  const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
    headers: { 'User-Agent': TILE_UA },
  });
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, buf);
  return buf;
}

function _tileXY(lat, lon, z) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
  };
}

// Fetch the whole zoom pyramid around a target into the cache.
async function _prefetchTiles(lat, lon) {
  const half = Math.floor(TILE_GRID / 2);
  let ok = 0, failed = 0;
  for (let z = TILE_ZMIN; z <= TILE_ZMAX; z++) {
    const { x, y } = _tileXY(lat, lon, z);
    const max = 2 ** z;
    const jobs = [];
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const tx = x + dx, ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= max || ty >= max) continue;
        jobs.push(_getTile(z, tx, ty).then(() => { ok++; }, () => { failed++; }));
      }
    }
    await Promise.all(jobs); // one zoom level at a time — polite to OSM
  }
  return { ok, failed };
}

function createPublicRouter(ctx) {
  const router = express.Router();

  // Screen-side snapshot — read-only display data. No auth: nothing
  // sensitive (channel names, follower counts, like counts, photo→channel
  // mapping). Admin endpoints below still require auth.
  router.get('/snapshot', async (_req, res) => {
    try {
      const channels = state.getChannels();
      const pools = {};
      for (const c of channels) pools[c.id] = state.getCommentPool(c.id);
      const photoStates = await ctx.db.all(`SELECT * FROM hype_photo_state`);
      // Follower counts of ~24h ago, for "sinds gisteren" deltas on the
      // morning dashboard. Fallback: a channel's earliest recorded count.
      const cutoff = Date.now() - 24 * 3600 * 1000;
      const baselineRows = await ctx.db.all(`
        SELECT channel_id, count FROM hype_followers_history h
        WHERE ts = COALESCE(
          (SELECT MAX(ts) FROM hype_followers_history WHERE channel_id = h.channel_id AND ts <= ?),
          (SELECT MIN(ts) FROM hype_followers_history WHERE channel_id = h.channel_id)
        )
      `, [cutoff]);
      const followerBaselines = {};
      for (const row of baselineRows) followerBaselines[row.channel_id] = row.count | 0;
      const tagMap = await ctx.db.listPhotoTagsByNamespace('hype');
      const channelByPhotoId = {};
      for (const [photoId, tags] of Object.entries(tagMap || {})) {
        if (tags?.channel) channelByPhotoId[photoId] = tags.channel;
      }
      res.json({
        settings: state.getSettings(),
        channels,
        pools,
        followers: state.getAllFollowerCounts(),
        followerBaselines,
        photoStates,
        channelByPhotoId,
        activity: state.getActivity(),
        videos: state.getVideos(),
        streamStats: state.getStreamStats(),
        streamChat: state.getStreamChat(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Map tiles for the trace scene. No auth: screens fetch these directly.
  router.get('/tiles/:z/:x/:y', async (req, res) => {
    const z = Number(req.params.z) | 0, x = Number(req.params.x) | 0, y = Number(req.params.y) | 0;
    const max = 2 ** z;
    if (z < 0 || z > 19 || x < 0 || y < 0 || x >= max || y >= max) {
      return res.status(400).json({ error: 'invalid tile' });
    }
    try {
      const buf = await _getTile(z, x, y);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // Fired by the physical reboot console (tablet). Triggers the full restart
  // sequence — same as admin restart — no auth needed on the local festival network.
  router.post('/reboot-trigger', async (_req, res) => {
    try {
      await engine.restartPlatform();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Physical showtime button (M5 Atom). Fires whatever action the operator
  // armed in admin (settings.physicalTrigger) and then disarms — one-shot,
  // so stray presses are harmless. No auth: local festival network, and a
  // disarmed button does nothing.
  router.get('/trigger', (_req, res) => {
    res.json({ armed: state.getSettings().physicalTrigger || null });
  });

  router.post('/trigger', async (_req, res) => {
    try {
      const action = state.getSettings().physicalTrigger;
      const run = {
        launch:      () => engine.launchPlatform(),
        reveal:      () => engine.startReveal({}),
        trace:       () => engine.traceHacker(state.getSettings().traceTarget || {}),
        'trace-end': () => engine.endTrace(),
        restart:     () => engine.restartPlatform(),
      }[action];
      if (!run) return res.status(409).json({ error: 'geen actie geselecteerd' });
      // Disarm BEFORE running so a double-press can't fire twice, then
      // auto-advance to the story's next beat (reveal → trace → offline).
      await engine.updateSettings({ physicalTrigger: null });
      await run();
      const next = { reveal: 'trace', trace: 'trace-end' }[action] || null;
      if (next) await engine.updateSettings({ physicalTrigger: next });
      res.json({ ok: true, fired: action, next });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function createAdminRouter(ctx, engine) {
  const router = express.Router();

  router.get('/snapshot', (_req, res) => {
    res.json({
      settings: state.getSettings(),
      channels: state.getChannels(),
      followers: state.getAllFollowerCounts(),
      activity: state.getActivity(),
      videos: state.getVideos(),
      streamStats: state.getStreamStats(),
      streamChat: state.getStreamChat(),
    });
  });

  router.patch('/settings', async (req, res) => {
    try {
      res.json(await engine.updateSettings(req.body || {}));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/launch', async (_req, res) => {
    try {
      res.json(await engine.launchPlatform());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/reset-prelaunch', async (_req, res) => {
    try {
      res.json(await engine.resetPreLaunch());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Everything back to day 0: followers/history/activity wiped, knobs to
  // rest, pre-launch teaser armed. The Saturday-morning button.
  router.post('/reset-camp', async (_req, res) => {
    try {
      res.json(await engine.resetForCamp());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ── Nachtspel (Thursday-night finale) ── */

  router.post('/reveal-arm', async (_req, res) => {
    try {
      res.json(await engine.armReveal());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/reveal', async (req, res) => {
    try {
      res.json(await engine.startReveal({ countdownSec: req.body?.countdownSec }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/trace', async (req, res) => {
    try {
      res.json(await engine.traceHacker({
        location: req.body?.location,
        lat: req.body?.lat,
        lon: req.body?.lon,
      }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/trace-end', async (_req, res) => {
    try {
      res.json(await engine.endTrace());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cache the tile pyramid for the trace location (operator does this in
  // the afternoon). Also persists the target in settings.
  router.post('/trace-prefetch', async (req, res) => {
    const lat = Number(req.body?.lat), lon = Number(req.body?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
      return res.status(400).json({ error: 'valid lat/lon required' });
    }
    try {
      const saved = await engine.updateSettings({
        traceTarget: { location: String(req.body?.location || '').slice(0, 120), lat, lon },
      });
      const result = await _prefetchTiles(lat, lon);
      const { x, y } = _tileXY(lat, lon, 16);
      res.json({ ...result, settings: saved, previewTile: `/api/modules/hype/tiles/16/${x}/${y}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/power-off', async (req, res) => {
    try {
      res.json(await engine.powerOff({ message: req.body?.message, instant: !!req.body?.instant }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/restart', async (_req, res) => {
    try {
      res.json(await engine.restartPlatform());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/morning-check', async (req, res) => {
    try {
      res.json(await engine.morningCheck({
        day: req.body?.day,
        featuredBump: req.body?.featuredBump,
        ambientBump: req.body?.ambientBump,
      }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/activity', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
      res.status(201).json(await engine.addActivity({
        kind: req.body?.kind || 'juice',
        actorType: req.body?.actorType || 'manual',
        actorId: req.body?.actorId || null,
        photoId: req.body?.photoId || null,
        text: text.slice(0, 280),
      }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/videos', (_req, res) => {
    res.json(state.getVideos());
  });

  router.put('/videos', async (req, res) => {
    const filename = String(req.body?.filename || '').trim();
    if (!filename) return res.status(400).json({ error: 'filename required' });
    try {
      const saved = await hypeDb.upsertVideo(ctx.db, {
        id: Number(req.body?.id) || null,
        slideId: req.body?.slideId || null,
        filename,
        label: String(req.body?.label || filename).slice(0, 120),
        placement: req.body?.placement === 'stream' ? 'stream' : 'post',
        active: req.body?.active !== false,
      });
      state.setVideos(await hypeDb.listVideos(ctx.db));
      ctx.broadcast({ type: 'hype:videos_update', videos: state.getVideos() });
      res.json(saved);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ── Channels CRUD ────────────────────────────────────────────────── */
  router.get('/channels', (_req, res) => {
    res.json(state.getChannels());
  });

  router.put('/channels/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!/^[a-z0-9_-]+$/i.test(id)) return res.status(400).json({ error: 'invalid id' });
    const body = req.body || {};
    const channel = {
      id,
      name:           String(body.name || '').slice(0, 80),
      handle:         String(body.handle || '').slice(0, 40),
      color:          String(body.color || '#888888').slice(0, 16),
      avatar_url:     String(body.avatar_url || body.avatarUrl || '').slice(0, 500),
      follower_base:  Math.max(0, Number(body.follower_base) | 0),
      featured_days:  Array.isArray(body.featured_days) ? body.featured_days : [],
      race_participant: body.race_participant !== false,
    };
    if (!channel.name || !channel.handle) return res.status(400).json({ error: 'name and handle required' });
    try {
      const saved = await hypeDb.upsertChannel(ctx.db, channel);
      state.setChannel(saved);
      ctx.broadcast({ type: 'hype:channels_update', channels: state.getChannels() });
      res.json(saved);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ── Comment pool ─────────────────────────────────────────────────── */
  router.get('/channels/:id/pool', (req, res) => {
    res.json(state.getCommentPool(req.params.id));
  });

  router.put('/channels/:id/pool', async (req, res) => {
    const id = String(req.params.id || '');
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    try {
      await hypeDb.replaceCommentPool(ctx.db, id, items);
      const fresh = await hypeDb.listCommentPool(ctx.db, id);
      state.setCommentPool(id, fresh);
      res.json(fresh);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ── Photo tagging (channel + viral) ──────────────────────────────── */
  router.put('/photos/:id/channel', async (req, res) => {
    const photoId = String(req.params.id || '');
    const channelId = req.body?.channelId ? String(req.body.channelId) : null;
    if (channelId && !state.getChannel(channelId)) {
      return res.status(400).json({ error: 'unknown channel' });
    }
    try {
      await ctx.db.setPhotoTag(photoId, 'hype', 'channel', channelId);
      ctx.broadcast({ type: 'hype:photo_channel_update', photoId, channelId });
      res.json({ photoId, channelId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/photos/:id/viral', async (req, res) => {
    const photoId = String(req.params.id || '');
    const viral = !!req.body?.viral;
    try {
      const { updated } = await engine.manualBoost(photoId, { viral });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ── Manual boost (likes / comment) ───────────────────────────────── */
  router.post('/photos/:id/boost', async (req, res) => {
    const photoId = String(req.params.id || '');
    const likesDelta = Number(req.body?.likesDelta) | 0;
    const comment = req.body?.comment || null;
    try {
      const { updated, newComment } = await engine.manualBoost(photoId, { likesDelta, comment });
      res.json({ updated, newComment });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/photos/:id/comments', async (req, res) => {
    const photoId = String(req.params.id || '');
    const limit = Number(req.query?.limit) || 10;
    try {
      res.json(await hypeDb.listRecentComments(ctx.db, photoId, limit));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ── Followers ────────────────────────────────────────────────────── */
  router.get('/followers', (_req, res) => {
    res.json(state.getAllFollowerCounts());
  });

  router.put('/channels/:id/followers', (req, res) => {
    const id = String(req.params.id || '');
    if (!state.getChannel(id)) return res.status(404).json({ error: 'unknown channel' });
    const count = Number(req.body?.count);
    const bump  = Number(req.body?.bump);
    try {
      if (Number.isFinite(count)) engine.setFollowerCount(id, count);
      else if (Number.isFinite(bump)) engine.bumpFollowerCount(id, bump);
      else return res.status(400).json({ error: 'count or bump required' });
      res.json({ [id]: state.getFollowerCount(id) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ── Stream-chat sidecar (regie) ──────────────────────────────────── */
  // Dunne proxy zodat de admin-UI niet rechtstreeks bij de sidecar hoeft.
  // De sidecar start alleen expliciet via deze knoppen — nooit automatisch.
  const _sidecarProxy = (method, path) => async (req, res) => {
    try {
      const { status, data } = await streamChat.sidecarRequest(method, path, req.body);
      res.status(status).json(data);
    } catch (err) {
      res.status(502).json({ error: `sidecar niet bereikbaar: ${err.message}` });
    }
  };
  router.post('/stream-chat/start',  _sidecarProxy('POST', '/start'));
  router.post('/stream-chat/stop',   _sidecarProxy('POST', '/stop'));
  router.post('/stream-chat/leader', _sidecarProxy('POST', '/leader'));
  router.get('/stream-chat/status',  _sidecarProxy('GET', '/status'));
  router.get('/stream-chat/tail', (_req, res) => {
    res.json({ streamChat: state.getStreamChat(), streamStats: state.getStreamStats(), feeding: streamChat.isFeeding() });
  });
  router.post('/stream-chat/reset', (_req, res) => {
    state.clearStreamChat();
    ctx.broadcast({ type: 'hype:stream_chat_reset' });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createPublicRouter, createAdminRouter };
