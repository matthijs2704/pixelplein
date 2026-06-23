'use strict';

// Likes/comments engine. Ticks every `tickMs`, fed by the set of currently
// visible photos across all screens (from state.screenHealth). For each
// visible photo:
//   - bump likes via logistic-ish increment (viral photos grow faster)
//   - small chance of inserting a comment from the photo's channel pool
// Then broadcasts `hype:state_update` so screens/admin update live.
//
// Ambient activity keeps the dashboard moving; follower counts are controlled
// manually by leadership for the story.

const { DEFAULT_ENGINE } = require('./config-schema');
const hypeDb = require('./db');
const state  = require('./state');
const contentProvider = require('./content-provider');

const NS = 'hype';
const PHOTO_TAGS_NS = 'hype';

let _ctx       = null;
let _tickTimer = null;
let _activityTimer = null;
let _streamStatsTimer = null;
let _opts      = { ...DEFAULT_ENGINE };
let _chatCount = 0;
let _launchTimer = null;
let _streamViewerSeed = 247;

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
  return null;
}

async function _tickOnce() {
  const visible = _visiblePhotoIds();
  if (!visible.length) return;

  for (const photoId of visible) {
    const channelId = await _channelForPhoto(photoId);
    const prev = state.getPhotoState(photoId) || { likes: 0, viral: false };
    const base = (channelId ? _opts.baseLikesPerTick : _opts.generalLikesPerTick) * (0.6 + Math.random() * 0.8);
    const mul  = prev.viral ? _opts.viralMultiplier : 1;
    const delta = Math.max(1, Math.round(base * mul));

    const updated = await hypeDb.upsertPhotoState(_ctx.db, photoId, { likesDelta: delta });
    state.setPhotoState(photoId, updated);

    let newComment = null;
    const commentChance = _opts.commentChancePerTick * (prev.viral ? _opts.viralCommentBoost : 1);
    if (Math.random() < commentChance) {
      const channel = state.getChannel(channelId);
      if (channel) {
        const pick = state.pickComment(channelId);
        if (pick) {
          newComment = await hypeDb.insertComment(_ctx.db, {
            photoId,
            channelId,
            author: channel.handle || channel.name,
            text:   pick.text,
            source: 'auto',
          });
        }
      } else {
        const generated = await contentProvider.generateComment({
          settings: state.getSettings(),
          account: state.getSettings().generalAccount,
          photoId,
        });
        newComment = await hypeDb.insertComment(_ctx.db, {
          photoId,
          channelId: null,
          author: generated.author,
          text: generated.text,
          source: generated.source,
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

async function _recordActivity(item) {
  const saved = await hypeDb.insertActivity(_ctx.db, item);
  state.addActivity(saved);
  _ctx.broadcast({ type: `${NS}:activity`, item: saved });
  return saved;
}

async function _activityOnce() {
  const settings = state.getSettings();
  const visible = _visiblePhotoIds();

  if (Math.random() < _opts.chatChancePerTick) {
    const msg = await contentProvider.generateChatMessage({ settings, chatCount: _chatCount++ });
    await _recordActivity({
      kind: 'chat',
      actorType: msg.meta?.harry ? 'harry' : 'viewer',
      text: `${msg.author}: ${msg.text}`,
      source: msg.source,
      meta: msg.meta,
    });
    return;
  }

  if (visible.length && Math.random() < 0.38) {
    const photoId = visible[Math.floor(Math.random() * visible.length)];
    const channelId = await _channelForPhoto(photoId);
    const channel = state.getChannel(channelId);
    const generated = await contentProvider.generateComment({
      settings,
      channel,
      account: settings.generalAccount,
      photoId,
    });
    await _recordActivity({
      kind: 'comment',
      actorType: channel ? 'influencer' : 'general',
      actorId: channel?.id || null,
      photoId,
      text: `${generated.author}: ${generated.text}`,
      source: generated.source,
    });
    return;
  }

  const msg = await contentProvider.generatePlatformMessage({ settings });
  await _recordActivity({
    kind: 'platform',
    actorType: 'system',
    text: msg.text,
    source: msg.source,
  });
}

async function _activityTick() {
  try { await _activityOnce(); }
  catch (err) { console.warn('[hype] activity error:', err && err.message); }
}

function _connectedScreenCount() {
  let count = 0;
  for (const info of _ctx?.state?.screenHealth?.values?.() || []) {
    if (info.connected) count++;
  }
  return count;
}

function _updateStreamStats({ force = false } = {}) {
  const settings = state.getSettings();
  if (!settings.stream?.enabled && !force) return;
  const screenCount = Math.max(1, _connectedScreenCount());
  const drift = Math.round((Math.random() * 10) - 3);
  const floor = 90 + screenCount * 55;
  const ceiling = 780 + screenCount * 120;
  _streamViewerSeed = Math.max(floor, Math.min(ceiling, _streamViewerSeed + drift));
  const online = Math.max(screenCount, Math.round(_streamViewerSeed * 0.34));
  const stats = {
    viewers: _streamViewerSeed,
    online,
    updatedAt: Date.now(),
  };
  state.setStreamStats(stats);
  _ctx.broadcast({ type: `${NS}:stream_stats`, stats });
}

function start(ctx, opts = {}) {
  _ctx  = ctx;
  _opts = { ...DEFAULT_ENGINE, ...opts };
  stop();
  _tickTimer = setInterval(_tick,             Math.max(500, _opts.tickMs));
  _activityTimer = setInterval(_activityTick, Math.max(1500, _opts.activityTickMs));
  _streamStatsTimer = setInterval(_updateStreamStats, 5000);
  setTimeout(_activityTick, 2500);
  setTimeout(() => _updateStreamStats({ force: true }), 1200);
}

function stop() {
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  if (_activityTimer) { clearInterval(_activityTimer); _activityTimer = null; }
  if (_streamStatsTimer) { clearInterval(_streamStatsTimer); _streamStatsTimer = null; }
  if (_launchTimer) { clearTimeout(_launchTimer); _launchTimer = null; }
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
    const account = state.getSettings().generalAccount;
    newComment = await hypeDb.insertComment(_ctx.db, {
      photoId,
      channelId,
      author: comment.author || ch?.handle || account.handle || 'staff',
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

async function updateSettings(patch) {
  const saved = await hypeDb.updateSettings(_ctx.db, patch || {});
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  if (saved.stream?.enabled) _updateStreamStats({ force: true });
  if (saved.launchActive) {
    if (_launchTimer) clearTimeout(_launchTimer);
    _launchTimer = setTimeout(async () => {
      try {
        const next = await hypeDb.updateSettings(_ctx.db, { launchActive: false });
        state.setSettings(next);
        _ctx.broadcast({ type: `${NS}:settings_update`, settings: next });
      } catch (err) {
        console.warn('[hype] launch reset failed:', err && err.message);
      }
    }, 11_000);
  }
  return saved;
}

async function launchPlatform() {
  if (_launchTimer) {
    clearTimeout(_launchTimer);
    _launchTimer = null;
  }

  await hypeDb.clearActivity(_ctx.db);
  state.clearActivity();

  const saved = await hypeDb.updateSettings(_ctx.db, {
    mode: 'dashboard',
    platformOff: false,
    preLaunch: false,
    launchActive: true,
    stream: { ...state.getSettings().stream, enabled: false },
  });

  // Dismiss the pre-launch idle teaser (if active) before the cinematic plays.
  _ctx.broadcast({ type: 'alert_dismiss', alertId: 'hype-prelaunch-active' });
  state.setSettings(saved);

  const launchItems = [
    { kind: 'platform', actorType: 'system', text: 'DeHype wordt opgestart', source: 'system' },
    { kind: 'platform', actorType: 'system', text: 'Het account Kamp Live is aangemaakt', source: 'system' },
    { kind: 'platform', actorType: 'system', text: 'De influencer-kanalen zijn online', source: 'system' },
    { kind: 'chat', actorType: 'viewer', text: 'Kamp Live: welkom op DeHype', source: 'system' },
  ];
  for (const item of launchItems) await _recordActivity(item);

  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  _ctx.broadcast({ type: `${NS}:activity_reset`, activity: state.getActivity() });
  _ctx.broadcast({ type: `${NS}:launch`, settings: saved });
  _ctx.broadcast({
    type: 'alert_fire',
    alert: {
      id: `hype-launch-${Date.now()}`,
      type: 'hype-launch',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: 'De Hype gaat live',
      payload: { account: saved.generalAccount },
      durationSec: 30,
      firedAt: Date.now(),
    },
  });

  _launchTimer = setTimeout(async () => {
    try {
      const next = await hypeDb.updateSettings(_ctx.db, { launchActive: false });
      state.setSettings(next);
      _ctx.broadcast({ type: `${NS}:settings_update`, settings: next });
    } catch (err) {
      console.warn('[hype] launch reset failed:', err && err.message);
    }
  }, 30_000);

  return { settings: saved, activity: state.getActivity() };
}

/**
 * Pre-launch idle: fires the infinite teaser alert on screens. Called at
 * server boot when settings.preLaunch is true, so kids opening the screen
 * before Day 1 see a "binnenkort live" state instead of the bare feed.
 */
function firePreLaunch() {
  _ctx.broadcast({
    type: 'alert_fire',
    alert: {
      id: 'hype-prelaunch-active',
      type: 'hype-prelaunch',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: 'binnenkort live',
      payload: { infinite: true },
      durationSec: 86400,
      firedAt: Date.now(),
    },
  });
}

/**
 * Reset to pre-launch idle: re-arms the teaser so it shows again. Useful
 * during rehearsals when the operator wants to "rewind" to the before-the-
 * show state without restarting the server.
 */
async function resetPreLaunch() {
  if (_launchTimer) { clearTimeout(_launchTimer); _launchTimer = null; }
  const saved = await hypeDb.updateSettings(_ctx.db, {
    preLaunch: true,
    launchActive: false,
    platformOff: false,
  });
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  // Dismiss any lingering takeover alerts before arming the teaser.
  _ctx.broadcast({ type: 'alert_dismiss', alertId: 'hype-offline-active' });
  firePreLaunch();
  return saved;
}

/**
 * Power-off: theatrical full-screen takeover that lasts until restart.
 * Sets platformOff=true (persisted) and fires an alert with no auto-dismiss.
 */
async function powerOff({ message } = {}) {
  if (_launchTimer) { clearTimeout(_launchTimer); _launchTimer = null; }
  const saved = await hypeDb.updateSettings(_ctx.db, { platformOff: true, launchActive: false });
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  _ctx.broadcast({
    type: 'alert_fire',
    alert: {
      id: 'hype-offline-active',
      type: 'hype-offline',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: message || 'DeHype is offline',
      payload: { infinite: true, subtitle: 'het platform ligt eruit — iemand moet DeHype opnieuw opstarten' },
      // Effectively infinite; only clearable by restartPlatform / alert_dismiss.
      durationSec: 86400,
      firedAt: Date.now(),
    },
  });
  return saved;
}

/**
 * Restart: BIOS-y boot animation that clears platformOff. Separate from
 * Launch (which is the Day 1 celebratory takeover).
 */
async function restartPlatform() {
  if (_launchTimer) { clearTimeout(_launchTimer); _launchTimer = null; }
  // Dismiss the lingering offline alert before playing restart sequence.
  _ctx.broadcast({ type: 'alert_dismiss', alertId: 'hype-offline-active' });

  const saved = await hypeDb.updateSettings(_ctx.db, { platformOff: false });
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });

  const channelCount = state.getChannels().length;
  _ctx.broadcast({
    type: 'alert_fire',
    alert: {
      id: `hype-restart-${Date.now()}`,
      type: 'hype-restart',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: 'DeHype is terug!',
      payload: {
        channelCount,
        channels: state.getChannels().map(c => ({ id: c.id, name: c.name, handle: c.handle, color: c.color })),
        // Playful boot lines for the renderer — Dutch, welpen-friendly.
        steps: [
          'Influencers worden wakker gemaakt…',
          'Likes worden teruggezet…',
          'Kanalen worden opnieuw verbonden…',
          'Comments worden opgehaald…',
          'Confetti wordt geladen…',
        ],
        cheer: 'Het kamp heeft DeHype gered!',
      },
      durationSec: 16,
      firedAt: Date.now(),
    },
  });

  await _recordActivity({ kind: 'platform', actorType: 'system', text: 'DeHype is terug!', source: 'system' });
  return saved;
}

/**
 * Operator-triggered follower pulse. This gives every channel a visible bump
 * without encoding a camp-day or story-day schedule into the tool.
 */
async function morningCheck({ featuredBump = 1800, ambientBump = 220, jitter = 0.4 } = {}) {
  const channels = state.getChannels().filter(ch => ch.race_participant !== false);
  const settings = state.getSettings();
  const spotlightDay = Math.max(1, Math.min(6, Number(settings.spotlightDay) || 1));
  const results = {};
  for (const ch of channels) {
    const featuredDays = Array.isArray(ch.featured_days) ? ch.featured_days : [];
    const featured = featuredDays.includes(spotlightDay);
    const target = featured ? featuredBump : ambientBump;
    const base = target * (0.78 + Math.random() * 0.44);
    const jitterMul = 1 + (Math.random() * 2 - 1) * jitter;
    const delta = Math.max(0, Math.round(base * jitterMul));
    if (delta > 0) state.bumpFollowerCount(ch.id, delta);
    const count = state.getFollowerCount(ch.id);
    await hypeDb.recordFollowerCount(_ctx.db, ch.id, count).catch(() => {});
    results[ch.id] = { delta, count, featured };
  }
  _ctx.broadcast({ type: `${NS}:followers_update`, counts: state.getAllFollowerCounts() });
  await _recordActivity({
    kind: 'platform',
    actorType: 'system',
    text: `Follower pulse dag ${spotlightDay}: spotlight-kanalen stijgen harder`,
    source: 'system',
  });
  return { results };
}

async function addActivity(item) {
  return _recordActivity({
    kind: item.kind || 'juice',
    actorType: item.actorType || 'manual',
    actorId: item.actorId || null,
    photoId: item.photoId || null,
    text: item.text || '',
    source: 'manual',
    meta: item.meta || null,
  });
}

module.exports = {
  start,
  stop,
  manualBoost,
  setFollowerCount,
  bumpFollowerCount,
  updateSettings,
  launchPlatform,
  firePreLaunch,
  resetPreLaunch,
  powerOff,
  restartPlatform,
  morningCheck,
  addActivity,
};
