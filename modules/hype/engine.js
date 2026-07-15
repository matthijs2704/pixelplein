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

// Fan handles for auto-comments (welpen-vibe usernames).
const FAN_AUTHORS = [
  '@welpje_daan', '@kampfan_88', '@scout4life', '@lisa_hyped', '@bosbaas_bram',
  '@tommie_tent', '@hype_kim', '@welp_niek', '@sterre_kampt', '@juul_2016',
  '@kampvuurkoning', '@femke_fan', '@mees_online', '@noor_hyper', '@sam_scout',
];

function _fanAuthor() {
  return FAN_AUTHORS[Math.floor(Math.random() * FAN_AUTHORS.length)];
}

// Pseudo-channel id for the general account's fake follower count. It rides
// the normal followers map/history so it persists and broadcasts like the rest.
const GENERAL_FOLLOWERS_ID = 'general';
const GENERAL_FOLLOWER_SEED = 8400;

/* ── Aliveness: baseline likes + background drift ─────────────────────
 * A photo the platform has never seen gets seeded with a believable like
 * count based on its age (saturating curve) and the owning account's
 * followers, so nothing ever shows "0 vindt dit hype". After that, a slow
 * background drift keeps all known photos creeping upward even when they
 * are not on screen.
 */

async function _photoAgeMs(photoId) {
  try {
    const row = await _ctx.db.get(
      `SELECT added_at, captured_at FROM photo_metadata WHERE photo_id = ?`, [photoId]);
    const ts = Number(row?.captured_at || row?.added_at) || 0;
    if (ts > 0) return Math.max(0, _now() - ts);
  } catch {}
  return 6 * 3.6e6; // unknown — assume a few hours old
}

function _baselineLikes(ageMs, channelId) {
  const followers = channelId
    ? state.getFollowerCount(channelId)
    : (state.getFollowerCount(GENERAL_FOLLOWERS_ID) || GENERAL_FOLLOWER_SEED);
  const ageH = ageMs / 3.6e6;
  const saturation = 1 - Math.exp(-(0.5 + ageH) / 8);   // climbs fast, flattens after ~a day
  const reach = channelId
    ? 0.010 + Math.random() * 0.025   // creators: 1–3.5% of followers
    : 0.005 + Math.random() * 0.012;  // general account: a bit shyer
  return Math.max(4, Math.round(followers * reach * saturation * (0.8 + Math.random() * 0.4)));
}

async function _driftOnce() {
  const settings = state.getSettings();
  if (settings.platformOff || settings.preLaunch) return;

  // Nudge a couple of random known photos so the whole feed keeps moving.
  const ids = [...state.getAllPhotoStateIds()];
  for (let i = 0; i < 2 && ids.length; i++) {
    const photoId = ids[Math.floor(Math.random() * ids.length)];
    const updated = await hypeDb.upsertPhotoState(_ctx.db, photoId, {
      likesDelta: 1 + Math.floor(Math.random() * 3),
    });
    state.setPhotoState(photoId, updated);
    _ctx.broadcast({
      type: `${NS}:state_update`,
      photoId,
      channelId: await _channelForPhoto(photoId),
      likes: updated.likes,
      viral: !!updated.viral,
      newComment: null,
    });
  }

  // The general account quietly gains followers in the background.
  if (Math.random() < 0.3) {
    const next = state.bumpFollowerCount(GENERAL_FOLLOWERS_ID, 1 + Math.floor(Math.random() * 3));
    hypeDb.recordFollowerCount(_ctx.db, GENERAL_FOLLOWERS_ID, next).catch(() => {});
    _ctx.broadcast({ type: `${NS}:followers_update`, counts: state.getAllFollowerCounts() });
  }
}

let _ctx       = null;
let _tickTimer = null;
let _activityTimer = null;
let _streamStatsTimer = null;
let _harryGlitchTimer = null;
let _opts      = { ...DEFAULT_ENGINE };
let _chatCount = 0;
let _launchTimer = null;
let _streamViewerSeed = 247;

// heat → { avgMs, levels[] } — level picked randomly per glitch
// levels array: pick one at random, biased toward heavier levels at higher heat
const HARRY_HEAT_CFG = [
  null,                                           // 0: dormant
  { avgMs: 600_000, levels: [1,1,1,1,1] },       // 1: ~10 min, always level 1
  { avgMs: 300_000, levels: [1,1,1,2,2] },       // 2: ~5 min, mostly level 1
  { avgMs: 150_000, levels: [1,2,2,2,3] },       // 3: ~2.5 min, mostly level 2
  { avgMs:  75_000, levels: [2,2,3,3,3] },       // 4: ~75 s, mostly level 3
  { avgMs:  20_000, levels: [2,3,3,3,3] },       // 5: ~20 s, almost always level 3
];

function _fireHarryGlitch() {
  _harryGlitchTimer = null;
  const settings = state.getSettings();
  const heat = Math.max(0, Math.min(5, Number(settings.harryHeat) || 0));
  if (!heat || settings.platformOff || settings.preLaunch) return;
  const cfg = HARRY_HEAT_CFG[heat];
  const level = cfg.levels[Math.floor(Math.random() * cfg.levels.length)];
  const durSec = level === 1 ? 1.2 : level === 2 ? 2.0 : 3.0;
  _ctx.broadcast({
    type: 'alert_fire',
    alert: {
      id: `hype-glitch-${Date.now()}`,
      type: 'hype-glitch',
      style: 'popup',
      position: 'center',
      priority: 'normal',
      active: true,
      message: 'glitch',
      payload: { level, durationSec: durSec },
      durationSec: durSec,
      firedAt: Date.now(),
    },
  });
  _scheduleHarryGlitch();
}

function _scheduleHarryGlitch() {
  if (_harryGlitchTimer) { clearTimeout(_harryGlitchTimer); _harryGlitchTimer = null; }
  const settings = state.getSettings();
  const heat = Math.max(0, Math.min(5, Number(settings.harryHeat) || 0));
  if (!heat || settings.platformOff || settings.preLaunch) return;
  const cfg = HARRY_HEAT_CFG[heat];
  const delay = Math.round(cfg.avgMs * (0.6 + Math.random() * 0.8)); // ±40% jitter
  _harryGlitchTimer = setTimeout(_fireHarryGlitch, delay);
}

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
    const seen = state.getPhotoState(photoId);
    const prev = seen || { likes: 0, viral: false };
    const base = (channelId ? _opts.baseLikesPerTick : _opts.generalLikesPerTick) * (0.6 + Math.random() * 0.8);
    const mul  = prev.viral ? _opts.viralMultiplier : 1;
    // First time this photo is seen: seed a believable age/followers-based
    // baseline instead of starting from zero.
    const delta = seen
      ? Math.max(1, Math.round(base * mul))
      : _baselineLikes(await _photoAgeMs(photoId), channelId);

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
            // Fans comment on posts — the channel commenting on its own
            // post reads wrong on the post-card layout.
            author: _fanAuthor(),
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
  try { await _driftOnce(); }
  catch (err) { console.warn('[hype] drift error:', err && err.message); }
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
  const cur = state.getStreamStats();
  const screenCount = Math.max(1, _connectedScreenCount());
  const floor = 90 + screenCount * 55;
  const ceiling = 780 + screenCount * 120;
  if (Number.isFinite(cur.viewers)) {
    _streamViewerSeed = Math.max(floor, Math.min(ceiling, Number(cur.viewers) | 0));
  }
  let drift = Math.floor(Math.random() * 11) - 4;
  if (drift === 0) drift = 1;
  let nextViewers = Math.max(floor, Math.min(ceiling, _streamViewerSeed + drift));
  if (nextViewers === _streamViewerSeed) {
    nextViewers = Math.max(floor, Math.min(ceiling, _streamViewerSeed - drift));
  }
  _streamViewerSeed = nextViewers;
  const stats = {
    viewers: _streamViewerSeed,
    online: _streamViewerSeed,
    title: cur.title,
    subtitle: cur.subtitle,
    source: cur.source,
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
  _scheduleHarryGlitch();
}

function stop() {
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  if (_activityTimer) { clearInterval(_activityTimer); _activityTimer = null; }
  if (_streamStatsTimer) { clearInterval(_streamStatsTimer); _streamStatsTimer = null; }
  if (_launchTimer) { clearTimeout(_launchTimer); _launchTimer = null; }
  if (_harryGlitchTimer) { clearTimeout(_harryGlitchTimer); _harryGlitchTimer = null; }
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
  _scheduleHarryGlitch(); // reschedule whenever settings change (heat or platformOff may differ)
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
      id: 'hype-launch-active',
      type: 'hype-launch',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: 'De Hype gaat live',
      payload: { account: saved.generalAccount },
      durationSec: 86400,
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
async function powerOff({ message, instant } = {}) {
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
      payload: { infinite: true, instant: !!instant, subtitle: 'het platform ligt eruit — iemand moet DeHype opnieuw opstarten' },
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
      id: 'hype-restart-active',
      type: 'hype-restart',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: 'DeHype is terug!',
      payload: {
        channelCount,
        channels: state.getChannels().map(c => ({ id: c.id, name: c.name, handle: c.handle, color: c.color })),
        // Boot lines for the renderer — Dutch, dramatic, welpen-friendly.
        steps: [
          'Noodverbinding herstellen…',
          'Creator-kanalen opnieuw verbinden…',
          'Volgersdata synchroniseren…',
          'Beveiligingsprotocol herstellen…',
          'Beveiliging extra versterkt na lek…',
          'De Hype opnieuw opstarten…',
        ],
        cheer: 'Het kamp heeft DeHype gered!',
      },
      durationSec: 86400,
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
