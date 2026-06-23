// Hype client-side state cache. Hydrated from /api/modules/hype/snapshot
// then kept fresh by WS messages (hype:state_update, hype:followers_update,
// hype:channels_update, hype:photo_channel_update).
//
// Other module files import getters from here; the chrome overlay also
// subscribes to "change" events to re-render.

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
    generalAccount: { name: 'Scouting Ridder Fulco', handle: '@scoutingridderfulco', color: '#00b2ff', avatarUrl: '' },
    streamStats: { viewers: 247, online: 88, updatedAt: 0 },
  },
  activity: [],
  videos: [],
  streamStats: { viewers: 247, online: 88, updatedAt: 0 },
  ready: false,
};

const _listeners = new Set();

function _emit(detail) {
  for (const fn of _listeners) {
    try { fn(detail); } catch {}
  }
}

export function onHypeChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getChannels()             { return _state.channels.slice(); }
export function getChannel(id)            { return _state.channelById.get(id) || null; }
export function getFollowerCount(id)      { return _state.followers[id] | 0; }
export function getAllFollowers()         { return { ..._state.followers }; }
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

export async function hydrate() {
  try {
    const res = await fetch('/api/modules/hype/snapshot', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`snapshot ${res.status}`);
    const snap = await res.json();
    if (snap.settings) _state.settings = { ..._state.settings, ...snap.settings };
    _ingestChannels(snap.channels);
    _state.pools = snap.pools || {};
    _state.followers = snap.followers || {};
    _state.photoState = new Map(
      (snap.photoStates || []).map(p => [p.photo_id, { likes: p.likes | 0, viral: !!p.viral }]),
    );
    _state.channelByPhotoId = new Map(Object.entries(snap.channelByPhotoId || {}));
    _state.activity = Array.isArray(snap.activity) ? snap.activity.slice() : [];
    _state.videos = Array.isArray(snap.videos) ? snap.videos.slice() : [];
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
    _state.settings = { ..._state.settings, ...(msg.settings || {}) };
    _emit({ kind: 'settings' });
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
