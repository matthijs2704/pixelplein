// Hype client-side state cache. Hydrated from /api/modules/hype/snapshot
// then kept fresh by WS messages (hype:state_update, hype:followers_update,
// hype:channels_update, hype:photo_channel_update).
//
// Other module files import getters from here; the chrome overlay also
// subscribes to "change" events to re-render.

import { emitScreenEvent } from '/screen/module-registry.js';

const _state = {
  channels: [],                  // [{ id, name, handle, color, avatar_url, ... }]
  channelById: new Map(),
  pools: {},                     // channelId -> [{ text, weight }]
  followers: {},                 // channelId -> count
  photoState: new Map(),         // photoId -> { likes, viral }
  channelByPhotoId: new Map(),   // photoId -> channelId
  recentComments: [],            // [{ photoId, channelId, author, text, ts }] (rolling 30)
  settings: {
    mode: 'normal',
    harryHeat: 0,
    spotlightDay: 1,
    launchActive: false,
    generalAccount: { name: 'Kamp Live', handle: '@kamplive', color: '#00b2ff', avatarUrl: '' },
    streamStats: { viewers: 247, online: 247, updatedAt: 0 },
  },
  activity: [],
  videos: [],
  streamStats: { viewers: 247, online: 247, updatedAt: 0 },
  streamChat: [],                // live chat van de sidecar (rolling 60)
  ready: false,
};

const _listeners = new Set();

function _emit(detail) {
  for (const fn of _listeners) {
    try { fn(detail); } catch {}
  }
}

function _hasTakeover(settings) {
  return Boolean(settings?.stream?.enabled)
    || settings?.mode === 'dashboard'
    || settings?.mode === 'social-only';
}

export function onHypeChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getChannels()             { return _state.channels.slice(); }
export function getChannel(id)            { return _state.channelById.get(id) || null; }
export function getFollowerCount(id)      { return _state.followers[id] | 0; }
export function getAllFollowers()         { return { ..._state.followers }; }
// Counts of ~24h ago (hydrated once) — live delta = current − baseline.
export function getFollowerBaselines()    { return { ...(_state.followerBaselines || {}) }; }
export function getPhotoLikes(photoId)    { const st = _state.photoState.get(photoId); return st ? (st.likes | 0) : 0; }
export function getPhotoViral(photoId)    { const st = _state.photoState.get(photoId); return !!(st && st.viral); }
export function getPhotoChannel(photoId)  { return _state.channelByPhotoId.get(photoId) || null; }
export function getRecentComments(photoId, limit = 5) {
  return _state.recentComments
    .filter(c => c.photoId === photoId)
    .slice(0, limit);
}
export function getRecentCommentsAny(limit = 10) {
  return _state.recentComments.slice(0, limit);
}
export function getSettings() { return { ..._state.settings, generalAccount: { ..._state.settings.generalAccount } }; }
export function getGeneralAccount() { return { ..._state.settings.generalAccount }; }
export function getActivity(limit = 30) { return _state.activity.slice(0, limit); }
export function getStreamChat(limit = 40) { return _state.streamChat.slice(-limit); }
export function getVideos() { return _state.videos.slice(); }
export function getActor(id) {
  if (!id) return getGeneralAccount();
  return getChannel(id) || getGeneralAccount();
}
export function isReady() { return _state.ready; }

function _ingestChannels(channels) {
  _state.channels = Array.isArray(channels) ? channels.slice() : [];
  _state.channelById = new Map(_state.channels.map(c => [c.id, c]));
}

/**
 * Keep the snapshot fresh without a WS-reconnect hook: a screen that boots
 * before the server is up (TV and server on the same power strip) retries
 * every 5s until the first snapshot lands; after that a 5-minute refresh
 * catches up after server restarts. hydrate() never throws.
 */
export function startHydrateRefresh() {
  const tick = async () => {
    await hydrate();
    setTimeout(tick, _state.ready ? 300_000 : 5_000);
  };
  setTimeout(tick, _state.ready ? 300_000 : 5_000);
}

export async function hydrate() {
  try {
    const res = await fetch('/api/modules/hype/snapshot', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`snapshot ${res.status}`);
    const snap = await res.json();
    if (snap.settings) _state.settings = { ..._state.settings, ...snap.settings };
    _ingestChannels(snap.channels);
    _state.pools = snap.pools || {};
    _state.followers = snap.followers || {};
    _state.followerBaselines = snap.followerBaselines || {};
    _state.photoState = new Map(
      (snap.photoStates || []).map(p => [p.photo_id, { likes: p.likes | 0, viral: !!p.viral }]),
    );
    _state.channelByPhotoId = new Map(Object.entries(snap.channelByPhotoId || {}));
    _state.activity = Array.isArray(snap.activity) ? snap.activity.slice() : [];
    _state.videos = Array.isArray(snap.videos) ? snap.videos.slice() : [];
    _state.streamChat = Array.isArray(snap.streamChat) ? snap.streamChat.slice(-60) : [];
    if (snap.streamStats) {
      _state.streamStats = { ..._state.streamStats, ...snap.streamStats };
      _state.settings.streamStats = { ..._state.streamStats };
    }
    _state.ready = true;
    _emit({ kind: 'hydrate' });
  } catch (err) {
    console.warn('[hype] snapshot fetch failed:', err && err.message);
  }
}

/* ── WS ingestion ──────────────────────────────────────────────────── */

export function handleWsMessage(msg) {
  if (!msg || typeof msg.type !== 'string') return;
  const sub = msg.type.slice('hype:'.length);

  if (sub === 'state_update') {
    const photoId = msg.photoId;
    if (!photoId) return;
    _state.photoState.set(photoId, { likes: msg.likes | 0, viral: !!msg.viral });
    if (msg.channelId) _state.channelByPhotoId.set(photoId, msg.channelId);
    if (msg.newComment) {
      _state.recentComments.unshift({
        photoId,
        channelId: msg.channelId,
        author:    msg.newComment.author,
        text:      msg.newComment.text,
        ts:        msg.newComment.created_at || Date.now(),
      });
      if (_state.recentComments.length > 30) _state.recentComments.length = 30;
    }
    _emit({ kind: 'state', photoId });
    return;
  }

  if (sub === 'followers_update') {
    _state.followers = { ..._state.followers, ...(msg.counts || {}) };
    _emit({ kind: 'followers' });
    return;
  }

  if (sub === 'settings_update') {
    const wasStreamEnabled = Boolean(_state.settings.stream?.enabled);
    const hadTakeover = _hasTakeover(_state.settings);
    _state.settings = { ..._state.settings, ...(msg.settings || {}) };
    const hasTakeover = _hasTakeover(_state.settings);
    _emit({ kind: 'settings' });
    if (wasStreamEnabled && !_state.settings.stream?.enabled) {
      document.body.classList.remove('hype-stream-mode');
    }
    if (hadTakeover !== hasTakeover) {
      emitScreenEvent('layout:request-cycle', {
        clear: !hasTakeover,
        reason: hasTakeover ? 'hype-takeover-enabled' : 'hype-takeover-disabled',
      });
    } else if (wasStreamEnabled && !_state.settings.stream?.enabled) {
      emitScreenEvent('layout:request-cycle', { clear: true, reason: 'stream-disabled' });
    }
    return;
  }

  if (sub === 'activity') {
    if (msg.item) _state.activity.unshift(msg.item);
    if (_state.activity.length > 80) _state.activity.length = 80;
    _emit({ kind: 'activity' });
    return;
  }

  if (sub === 'activity_reset') {
    _state.activity = Array.isArray(msg.activity) ? msg.activity.slice() : [];
    _emit({ kind: 'activity' });
    return;
  }

  if (sub === 'launch') {
    if (msg.settings) _state.settings = { ..._state.settings, ...msg.settings };
    _emit({ kind: 'launch' });
    return;
  }

  if (sub === 'videos_update') {
    _state.videos = Array.isArray(msg.videos) ? msg.videos.slice() : [];
    _emit({ kind: 'videos' });
    return;
  }

  if (sub === 'stream_chat') {
    if (msg.item) _state.streamChat.push(msg.item);
    if (_state.streamChat.length > 60) _state.streamChat.shift();
    _emit({ kind: 'stream_chat' });
    return;
  }

  if (sub === 'stream_chat_update') {
    const idx = _state.streamChat.findIndex(m => m.id === msg.item?.id);
    if (idx >= 0) _state.streamChat[idx] = msg.item;
    _emit({ kind: 'stream_chat' });
    return;
  }

  if (sub === 'stream_chat_reset') {
    _state.streamChat = [];
    _emit({ kind: 'stream_chat' });
    return;
  }

  if (sub === 'stream_stats') {
    _state.streamStats = { ..._state.streamStats, ...(msg.stats || {}) };
    _state.settings.streamStats = { ..._state.streamStats };
    _emit({ kind: 'stream_stats' });
    return;
  }

  if (sub === 'channels_update') {
    _ingestChannels(msg.channels);
    _emit({ kind: 'channels' });
    return;
  }

  if (sub === 'photo_channel_update') {
    if (msg.photoId) {
      if (msg.channelId) _state.channelByPhotoId.set(msg.photoId, msg.channelId);
      else _state.channelByPhotoId.delete(msg.photoId);
      _emit({ kind: 'photo_channel', photoId: msg.photoId });
    }
    return;
  }
}
