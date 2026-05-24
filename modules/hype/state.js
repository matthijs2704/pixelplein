'use strict';

// In-memory cache of channels + photo state for hot reads (engine ticks,
// WS snapshots). Source of truth stays SQLite; this cache is rebuilt on
// boot and updated when writes happen.

const hypeDb = require('./db');

const _state = {
  channels: [],                  // array of channel rows
  channelById: new Map(),        // id → channel row
  pools: new Map(),              // channelId → [{ text, weight }]
  photoState: new Map(),         // photoId → { likes, viral, updated_at }
  followers: new Map(),          // channelId → current follower count
};

async function load(db) {
  _state.channels = await hypeDb.listChannels(db);
  _state.channelById.clear();
  _state.pools.clear();
  for (const c of _state.channels) {
    _state.channelById.set(c.id, c);
    const pool = await hypeDb.listCommentPool(db, c.id);
    _state.pools.set(c.id, pool);
    if (!_state.followers.has(c.id)) {
      _state.followers.set(c.id, c.follower_base | 0);
    }
  }

  const allStates = await db.all(`SELECT * FROM hype_photo_state`);
  _state.photoState.clear();
  for (const row of allStates) {
    _state.photoState.set(row.photo_id, {
      likes: row.likes | 0,
      viral: !!row.viral,
      updated_at: row.updated_at | 0,
    });
  }
}

function getChannels()           { return _state.channels.slice(); }
function getChannel(id)          { return _state.channelById.get(id) || null; }
function getCommentPool(id)      { return _state.pools.get(id) || []; }
function getPhotoState(photoId)  { return _state.photoState.get(photoId) || null; }
function getAllFollowerCounts()  { return Object.fromEntries(_state.followers); }
function getFollowerCount(id)    { return _state.followers.get(id) | 0; }

function setChannel(channel) {
  if (!channel || !channel.id) return;
  const idx = _state.channels.findIndex(c => c.id === channel.id);
  if (idx >= 0) _state.channels[idx] = channel;
  else _state.channels.push(channel);
  _state.channelById.set(channel.id, channel);
  if (!_state.followers.has(channel.id)) {
    _state.followers.set(channel.id, channel.follower_base | 0);
  }
}

function setCommentPool(channelId, items) {
  _state.pools.set(channelId, items.slice());
}

function setPhotoState(photoId, st) {
  _state.photoState.set(photoId, {
    likes: st.likes | 0,
    viral: !!st.viral,
    updated_at: st.updated_at | Date.now(),
  });
}

function setFollowerCount(channelId, n) {
  _state.followers.set(channelId, Math.max(0, n | 0));
}

function bumpFollowerCount(channelId, delta) {
  const cur = _state.followers.get(channelId) | 0;
  const next = Math.max(0, cur + (delta | 0));
  _state.followers.set(channelId, next);
  return next;
}

/**
 * Weighted random pick from a comment pool. Returns null when empty.
 */
function pickComment(channelId) {
  const pool = _state.pools.get(channelId) || [];
  if (!pool.length) return null;
  const totalWeight = pool.reduce((s, p) => s + (p.weight | 0 || 1), 0);
  let r = Math.random() * totalWeight;
  for (const p of pool) {
    r -= (p.weight | 0 || 1);
    if (r <= 0) return p;
  }
  return pool[pool.length - 1];
}

module.exports = {
  load,
  getChannels,
  getChannel,
  getCommentPool,
  getPhotoState,
  getAllFollowerCounts,
  getFollowerCount,
  setChannel,
  setCommentPool,
  setPhotoState,
  setFollowerCount,
  bumpFollowerCount,
  pickComment,
};
