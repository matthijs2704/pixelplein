'use strict';

// Likes/comments engine. Ticks every `tickMs`, fed by the set of currently
// visible photos across all screens (from state.screenHealth). For each
// visible photo:
//   - bump likes via logistic-ish increment (viral photos grow faster)
//   - small chance of inserting a comment from the photo's channel pool
// Then broadcasts `hype:state_update` so screens/admin update live.
//
// Engine also drifts follower counts every minute so the dashboard slide
// has motion even without manual triggers.

const { DEFAULT_ENGINE } = require('./config-schema');
const hypeDb = require('./db');
const state  = require('./state');

const NS = 'hype';
const PHOTO_TAGS_NS = 'hype';

let _ctx       = null;
let _tickTimer = null;
let _follTimer = null;
let _opts      = { ...DEFAULT_ENGINE };

function _now() { return Date.now(); }

/**
 * Visible photos = union of visiblePhotoIds reported by online screens
 * within the last 10s. Falls back to empty set when nothing's on.
 */
function _visiblePhotoIds() {
  const ids = new Set();
  const cutoff = _now() - 10_000;
  const sh = _ctx?.state?.screenHealth;
  if (!sh) return [];
  for (const [, info] of sh.entries()) {
    if (!info.connected) continue;
    if ((info.lastSeenAt | 0) < cutoff) continue;
    const list = Array.isArray(info.visiblePhotoIds) ? info.visiblePhotoIds : [];
    for (const id of list) if (id) ids.add(String(id));
  }
  return [...ids];
}

async function _channelForPhoto(photoId) {
  // Photo→channel tag stored in generic photo_tags table by Phase 1.
  try {
    const tags = await _ctx.db.getPhotoTags(photoId, PHOTO_TAGS_NS);
    const channelId = tags?.channel || null;
    if (channelId && state.getChannel(channelId)) return channelId;
  } catch {}
  // Fall back to first channel so untagged photos still get hype activity.
  const channels = state.getChannels();
  return channels[0]?.id || null;
}

async function _tickOnce() {
  const visible = _visiblePhotoIds();
  if (!visible.length) return;

  for (const photoId of visible) {
    const channelId = await _channelForPhoto(photoId);
    if (!channelId) continue;

    const prev = state.getPhotoState(photoId) || { likes: 0, viral: false };
    const base = _opts.baseLikesPerTick * (0.6 + Math.random() * 0.8);
    const mul  = prev.viral ? _opts.viralMultiplier : 1;
    const delta = Math.max(1, Math.round(base * mul));

    const updated = await hypeDb.upsertPhotoState(_ctx.db, photoId, { likesDelta: delta });
    state.setPhotoState(photoId, updated);

    let newComment = null;
    const commentChance = _opts.commentChancePerTick * (prev.viral ? _opts.viralCommentBoost : 1);
    if (Math.random() < commentChance) {
      const pick = state.pickComment(channelId);
      const channel = state.getChannel(channelId);
      if (pick && channel) {
        newComment = await hypeDb.insertComment(_ctx.db, {
          photoId,
          channelId,
          author: channel.handle || channel.name,
          text:   pick.text,
          source: 'auto',
        });
      }
    }

    _ctx.broadcast({
      type:     `${NS}:state_update`,
      photoId,
      channelId,
      likes:    updated.likes,
      viral:    !!updated.viral,
      newComment,
    });
  }
}

async function _tick() {
  try { await _tickOnce(); }
  catch (err) { console.warn('[hype] tick error:', err && err.message); }
}

function _driftFollowers() {
  const updates = {};
  for (const channel of state.getChannels()) {
    // growth_rate is "new followers per minute baseline"; jitter ±50%.
    const drift = Math.round(channel.growth_rate * (0.5 + Math.random()));
    const next = state.bumpFollowerCount(channel.id, drift);
    updates[channel.id] = next;
    hypeDb.recordFollowerCount(_ctx.db, channel.id, next).catch(() => {});
  }
  _ctx.broadcast({ type: `${NS}:followers_update`, counts: updates });
}

function start(ctx, opts = {}) {
  _ctx  = ctx;
  _opts = { ...DEFAULT_ENGINE, ...opts };
  stop();
  _tickTimer = setInterval(_tick,             Math.max(500, _opts.tickMs));
  _follTimer = setInterval(_driftFollowers,   60_000);
  // First follower snapshot immediately so dashboards have data.
  setTimeout(_driftFollowers, 1500);
}

function stop() {
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  if (_follTimer) { clearInterval(_follTimer); _follTimer = null; }
}

/**
 * Manual operations (used by routes/admin tab):
 */
async function manualBoost(photoId, { likesDelta = 0, viral = null, comment = null } = {}) {
  const updated = await hypeDb.upsertPhotoState(_ctx.db, photoId, { likesDelta, viral });
  state.setPhotoState(photoId, updated);

  let newComment = null;
  if (comment && typeof comment.text === 'string' && comment.text.trim()) {
    const channelId = comment.channelId || (await _channelForPhoto(photoId));
    const ch = channelId ? state.getChannel(channelId) : null;
    newComment = await hypeDb.insertComment(_ctx.db, {
      photoId,
      channelId,
      author: comment.author || ch?.handle || 'staff',
      text:   comment.text.trim().slice(0, 280),
      source: 'manual',
    });
  }

  _ctx.broadcast({
    type:     `${NS}:state_update`,
    photoId,
    channelId: (await _channelForPhoto(photoId)) || null,
    likes:    updated.likes,
    viral:    !!updated.viral,
    newComment,
  });
  return { updated, newComment };
}

function setFollowerCount(channelId, count) {
  state.setFollowerCount(channelId, count);
  hypeDb.recordFollowerCount(_ctx.db, channelId, state.getFollowerCount(channelId)).catch(() => {});
  _ctx.broadcast({ type: `${NS}:followers_update`, counts: state.getAllFollowerCounts() });
}

function bumpFollowerCount(channelId, delta) {
  state.bumpFollowerCount(channelId, delta);
  hypeDb.recordFollowerCount(_ctx.db, channelId, state.getFollowerCount(channelId)).catch(() => {});
  _ctx.broadcast({ type: `${NS}:followers_update`, counts: state.getAllFollowerCounts() });
}

module.exports = {
  start,
  stop,
  manualBoost,
  setFollowerCount,
  bumpFollowerCount,
};
