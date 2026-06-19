'use strict';

const express = require('express');
const state   = require('./state');

const NS = 'expedition';

function createPublicRouter() {
  const r = express.Router();
  r.get('/snapshot', (_req, res) => res.json(state.getState()));
  return r;
}

function createAdminRouter(broadcast, photoState, db) {
  const r = express.Router();

  r.post('/level', (req, res) => {
    const n = parseInt(req.body?.level, 10);
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'level required' });
    state.setLevel(n);
    broadcast({ type: `${NS}:state`, ...state.getState() });
    res.json(state.getState());
  });

  r.post('/mode', (req, res) => {
    state.setManual(req.body?.manual !== false);
    broadcast({ type: `${NS}:state`, ...state.getState() });
    res.json(state.getState());
  });

  // Update a photo's eventGroup so it appears in the correct expedition zone.
  r.post('/photo-zone', async (req, res) => {
    const { photoId, zone } = req.body || {};
    if (!photoId || !ZONE_KEYS.has(zone)) {
      return res.status(400).json({ error: 'photoId and valid zone required' });
    }
    const photo = photoState.photosById.get(photoId);
    if (!photo) return res.status(404).json({ error: 'photo not found' });

    photo.eventGroup = zone === 'ungrouped' ? null : zone;
    try { await db.upsertPhotoMetadata(photo); } catch {}
    broadcast({ type: 'photo_update', photo: { id: photo.id, eventGroup: photo.eventGroup } });
    res.json({ ok: true, photoId, zone });
  });

  return r;
}

module.exports = { createPublicRouter, createAdminRouter };
