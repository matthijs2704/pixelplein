'use strict';

// Admin REST routes for the Hype module. All require auth (mounted with
// requireAuth in module.js). Mounted at /api/modules/hype.

const express = require('express');

const hypeDb = require('./db');
const state  = require('./state');

function createRouter(ctx, engine) {
  const router = express.Router();

  /* ── Snapshot for admin tab boot ──────────────────────────────────── */
  router.get('/snapshot', async (_req, res) => {
    try {
      const channels = state.getChannels();
      const pools = {};
      for (const c of channels) pools[c.id] = state.getCommentPool(c.id);
      const photoStates = await ctx.db.all(`SELECT * FROM hype_photo_state`);
      res.json({
        channels,
        pools,
        followers: state.getAllFollowerCounts(),
        photoStates,
      });
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
      emoji:          String(body.emoji || '').slice(0, 8),
      follower_base:  Math.max(0, Number(body.follower_base) | 0),
      growth_rate:    Math.max(0, Number(body.growth_rate) || 0),
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

  /* ── Special state alerts (proxy to base alerts API) ──────────────── */
  // These four are pure conveniences — they construct an alert payload with
  // the right type so existing /api/alerts plumbing fires it. Renderers on
  // the screen side know hype-glitch / hype-hacker / hype-offline /
  // hype-comeback.
  // Actual implementation deferred to admin UI POSTing /api/alerts directly.

  return router;
}

module.exports = { createRouter };
