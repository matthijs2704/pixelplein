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

const { DEFAULT_ENGINE, DEFAULT_CHANNELS, DEFAULT_COMMENT_POOLS } = require('./config-schema');
const hypeDb = require('./db');
const state  = require('./state');
const streamChat = require('./stream-chat');
const contentProvider = require('./content-provider');

const alertStore = require('../../server/features/alerts/store');
const { getConfig } = require('../../server/config');

const NS = 'hype';
const PHOTO_TAGS_NS = 'hype';
const LAUNCH_ACTIVE_TIMEOUT_MS = 10 * 60_000;

/* Only the two resting states are remembered for late joiners: a screen
 * that reboots mid-offline-night (or during pre-launch) must come back
 * showing the right scene, via the alert store → WS-hello getActiveAlerts().
 * One-time cutscenes (launch/reveal/trace/restart) are broadcast-only —
 * refreshing a screen must NOT replay them. */
const PERSISTED_STORY_ALERTS = new Set(['hype-prelaunch-active', 'hype-offline-active']);

/**
 * @param {object} alert - fired live to currently connected screens as-is
 * @param {object} [storedPayload] - payload variant persisted for late
 *   joiners (e.g. offline stores instant:true so a screen that reconnects
 *   jumps to the dead screen instead of replaying the full crash sequence)
 */
function _fireStoryAlert(alert, storedPayload = null) {
  if (PERSISTED_STORY_ALERTS.has(alert.id)) {
    const stored = alertStore.createAlert({
      ...alert,
      payload: storedPayload || alert.payload,
      fireNow: true,
    });
    _ctx.broadcast({ type: 'alert_fire', alert: { ...stored, payload: alert.payload } });
    return stored;
  }
  const fired = { active: true, firedAt: Date.now(), ...alert };
  _ctx.broadcast({ type: 'alert_fire', alert: fired });
  return fired;
}

function _dismissStoryAlert(alertId) {
  alertStore.dismissAlert(alertId); // no-op for non-persisted ids
  _ctx.broadcast({ type: 'alert_dismiss', alertId });
}

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
  const reach = 0.010 + Math.random() * 0.025; // 1–3.5% of followers, creators and general alike
  return Math.max(4, Math.round(followers * reach * saturation * (0.8 + Math.random() * 0.4)));
}

/**
 * One-time sweep at engine start: every ready photo without a state row
 * gets a believable baseline, so a photo that has never been on a live
 * screen still shows likes (previously only photos "seen" by a connected
 * screen were seeded — the rest sat at 0 forever).
 */
async function _seedMissingPhotoStates() {
  try {
    const rows = await _ctx.db.all(`
      SELECT m.photo_id, m.added_at, m.captured_at
      FROM photo_metadata m
      LEFT JOIN hype_photo_state s ON s.photo_id = m.photo_id
      WHERE m.status = 'ready' AND s.photo_id IS NULL
    `);
    if (!rows.length) return;
    const tagMap = await _ctx.db.listPhotoTagsByNamespace(PHOTO_TAGS_NS).catch(() => ({}));
    for (const row of rows) {
      const channelId = tagMap?.[row.photo_id]?.channel || null;
      const ts = Number(row.captured_at || row.added_at) || 0;
      const ageMs = ts > 0 ? Math.max(0, _now() - ts) : 6 * 3.6e6;
      const updated = await hypeDb.upsertPhotoState(_ctx.db, row.photo_id, {
        likesDelta: _baselineLikes(ageMs, channelId),
      });
      state.setPhotoState(row.photo_id, updated);
    }
    console.log(`[hype] seeded baseline likes for ${rows.length} photos`);
    // No per-photo broadcast (could be hundreds); screens pick the counts up
    // via their periodic snapshot refresh.
  } catch (err) {
    console.warn('[hype] baseline seed sweep failed:', err && err.message);
  }

  // Comments too: photos without any comment get one from the pool (~40%
  // per boot), so comment popups and post-card bubbles have material from
  // day one instead of waiting for live engine activity.
  try {
    const bare = await _ctx.db.all(`
      SELECT m.photo_id FROM photo_metadata m
      LEFT JOIN hype_comments c ON c.photo_id = m.photo_id
      WHERE m.status = 'ready' AND c.photo_id IS NULL
    `);
    const tagMap = await _ctx.db.listPhotoTagsByNamespace(PHOTO_TAGS_NS).catch(() => ({}));
    let seeded = 0;
    for (const row of bare) {
      if (Math.random() > 0.4) continue;
      const channelId = tagMap?.[row.photo_id]?.channel || null;
      let text = null;
      if (channelId && state.getChannel(channelId)) {
        text = state.pickComment(channelId)?.text || null;
      } else {
        text = (await contentProvider.generateComment({
          settings: state.getSettings(),
          account: state.getSettings().generalAccount,
          photoId: row.photo_id,
        }))?.text || null;
      }
      if (!text) continue;
      await hypeDb.insertComment(_ctx.db, {
        photoId: row.photo_id, channelId, author: _fanAuthor(), text, source: 'auto',
      }).catch(() => {});
      seeded++;
    }
    if (seeded) console.log(`[hype] seeded ${seeded} starter comments`);
  } catch (err) {
    console.warn('[hype] comment seed sweep failed:', err && err.message);
  }
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
let _revealTimer = null;
let _followerDriftTimer = null;
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
  // nachtspelStage: no random glitches once the reveal is armed — a glitch
  // over the "grote onthulling" holding screen would give the plot away.
  if (!heat || settings.platformOff || settings.preLaunch || settings.nachtspelStage) return;
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
  if (!heat || settings.platformOff || settings.preLaunch || settings.nachtspelStage) return;
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
  // Pool/playlist videos aren't in photo_tags — their channel lives on the
  // slide itself (set via the admin video-edit form).
  const slide = getConfig().slides?.find(s => s.id === photoId);
  if (slide?.channelId && state.getChannel(slide.channelId)) return slide.channelId;
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
          // Fans comment here too — the account replying to its own post
          // reads wrong, same as on creator posts.
          author: _fanAuthor(),
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
  // Sidecar is leidend: zodra die verbonden is of ooit stats leverde, zwijgt
  // deze nep-generator — een bevroren echt getal is beter dan een nep-getal
  // dat ertegenin springt tijdens gaps (engine gestopt, reconnect).
  if (streamChat.isFeeding() || cur.source === 'sidecar') return;
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
  _followerDriftTimer = setInterval(_followerDriftTick, FOLLOWER_DRIFT.tickMs);
  setTimeout(_activityTick, 2500);
  setTimeout(() => _updateStreamStats({ force: true }), 1200);
  setTimeout(_seedMissingPhotoStates, 4000);
  _scheduleHarryGlitch();
}

function stop() {
  if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  if (_activityTimer) { clearInterval(_activityTimer); _activityTimer = null; }
  if (_streamStatsTimer) { clearInterval(_streamStatsTimer); _streamStatsTimer = null; }
  if (_followerDriftTimer) { clearInterval(_followerDriftTimer); _followerDriftTimer = null; }
  if (_launchTimer) { clearTimeout(_launchTimer); _launchTimer = null; }
  if (_revealTimer) { clearTimeout(_revealTimer); _revealTimer = null; }
  if (_harryGlitchTimer) { clearTimeout(_harryGlitchTimer); _harryGlitchTimer = null; }
}

/* ── Follower drift ───────────────────────────────────────────────────
 * All race channels grow on their own during the day; the channels whose
 * featured_days match today's spotlightDay grow much faster. Growth is NOT
 * linear — like real social media it compounds and stutters:
 *   · launch buzz: hot right after launch, cooling down over ~1.5h
 *   · momentum: bigger channels grow a bit faster (log-scaled, no runaway)
 *   · bursts: now and then a post "goes viral" and a chunk arrives at once
 *   · night: between 22:00 and 08:00 growth EXPLODES ("Amerika is wakker") —
 *     nobody is watching the screens, so the morning tussenstand opens with
 *     a wow: everyone jumped thousands overnight
 * The "Follower pulse" button stays for extra drama at plot moments.
 */
const FOLLOWER_DRIFT = {
  tickMs: 90_000,        // ~40 ticks/hour
  featuredPerTick: 4,    // pre-multiplier baseline for spotlight channels
  ambientPerTick: 0.7,   // …and for everyone else
  jitter: 0.7,           // per-tick randomness
  burstChance: 0.06,     // ~2-3 bursts/hour across 6 channels
  launchBuzzMs: 90 * 60_000,
};

// ponytail: fixed 2-min grace; make it a setting if leaders want to tune it.
const DRIFT_GRACE_AFTER_LAUNCH_MS = 2 * 60_000;

async function _followerDriftTick() {
  const settings = state.getSettings();
  if (settings.platformOff || settings.preLaunch || settings.nachtspelStage) return;
  // Right after launch the platform is "brand new" — a short breather
  // before the first followers trickle in.
  if (settings.launchActive) return;
  const sinceLaunch = settings.launchedAt ? Date.now() - settings.launchedAt : Infinity;
  if (sinceLaunch < DRIFT_GRACE_AFTER_LAUNCH_MS) return;
  const spotlightDay = Math.max(1, Math.min(7, Number(settings.spotlightDay) || 1));
  const channels = state.getChannels().filter(ch => ch.race_participant !== false);
  if (!channels.length) return;

  // Launch buzz: ×4 right after the grace period, decaying to ×1 over ~1.5h.
  const buzz = 1 + 3 * Math.exp(-Math.max(0, sinceLaunch - DRIFT_GRACE_AFTER_LAUNCH_MS) / FOLLOWER_DRIFT.launchBuzzMs);
  // Night mode: kids are asleep but the rest of the world is not — counts
  // surge overnight so the morning reveal lands with a wow.
  const hour = new Date().getHours();
  const night = hour >= 22 || hour < 8;
  const dayPart = night ? 2.5 : 1;
  const burstChance = night ? FOLLOWER_DRIFT.burstChance * 2 : FOLLOWER_DRIFT.burstChance;

  let changed = false;
  for (const ch of channels) {
    const featuredDays = Array.isArray(ch.featured_days) ? ch.featured_days : [];
    const base = featuredDays.includes(spotlightDay)
      ? FOLLOWER_DRIFT.featuredPerTick
      : FOLLOWER_DRIFT.ambientPerTick;
    const count = state.getFollowerCount(ch.id);
    // Mild rich-get-richer: ×1 around 10 followers, ×~1.8 around 10K.
    const momentum = 0.6 + 0.4 * Math.log10(count + 10);
    const jitterMul = 1 + (Math.random() * 2 - 1) * FOLLOWER_DRIFT.jitter;
    const burst = Math.random() < burstChance ? 6 + Math.random() * 8 : 1;
    const raw = base * buzz * momentum * dayPart * jitterMul * burst;
    // Probabilistic rounding so fractional rates still add up over time.
    const delta = Math.floor(raw) + (Math.random() < raw % 1 ? 1 : 0);
    if (delta <= 0) continue;
    state.bumpFollowerCount(ch.id, delta);
    await hypeDb.recordFollowerCount(_ctx.db, ch.id, state.getFollowerCount(ch.id)).catch(() => {});
    if (burst > 1 && delta >= 30) {
      await _recordActivity({
        kind: 'platform', actorType: 'system',
        text: `${ch.handle} gaat viral — +${delta} volgers!`, source: 'system',
      }).catch(() => {});
    }
    changed = true;
  }
  if (changed) {
    _ctx.broadcast({ type: `${NS}:followers_update`, counts: state.getAllFollowerCounts() });
  }
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
    }, LAUNCH_ACTIVE_TIMEOUT_MS);
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
    launchedAt: Date.now(),
    physicalTrigger: null, // launch fired — button rests until the finale

    stream: { ...state.getSettings().stream, enabled: false },
  });

  // Dismiss the pre-launch idle teaser (if active) before the cinematic plays.
  _dismissStoryAlert('hype-prelaunch-active');
  state.setSettings(saved);

  const accountName = saved.generalAccount?.name || 'Kamp Live';
  const launchItems = [
    { kind: 'platform', actorType: 'system', text: 'DeHype wordt opgestart', source: 'system' },
    { kind: 'platform', actorType: 'system', text: `Het account ${accountName} is aangemaakt`, source: 'system' },
    { kind: 'platform', actorType: 'system', text: 'De influencer-kanalen zijn online', source: 'system' },
    { kind: 'chat', actorType: 'viewer', text: `${accountName}: welkom op DeHype`, source: 'system' },
  ];
  for (const item of launchItems) await _recordActivity(item);

  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  _ctx.broadcast({ type: `${NS}:activity_reset`, activity: state.getActivity() });
  _ctx.broadcast({ type: `${NS}:launch`, settings: saved });
  _fireStoryAlert({
      id: 'hype-launch-active',
      type: 'hype-launch',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: 'De Hype gaat live',
      payload: { account: saved.generalAccount },
      durationSec: 0 /* infinite */,
      firedAt: Date.now(),
  });

  _launchTimer = setTimeout(async () => {
    try {
      const next = await hypeDb.updateSettings(_ctx.db, { launchActive: false });
      state.setSettings(next);
      _ctx.broadcast({ type: `${NS}:settings_update`, settings: next });
    } catch (err) {
      console.warn('[hype] launch reset failed:', err && err.message);
    }
  }, LAUNCH_ACTIVE_TIMEOUT_MS);

  return { settings: saved, activity: state.getActivity() };
}

/**
 * Pre-launch idle: fires the infinite teaser alert on screens. Called at
 * server boot when settings.preLaunch is true, so kids opening the screen
 * before Day 1 see a "binnenkort live" state instead of the bare feed.
 */
function firePreLaunch() {
  _fireStoryAlert({
      id: 'hype-prelaunch-active',
      type: 'hype-prelaunch',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: 'binnenkort live',
      payload: { infinite: true },
      durationSec: 0 /* infinite */,
      firedAt: Date.now(),
  });
}

/**
 * Boot-time variant of firePreLaunch: the alert store persists across a
 * server restart, so reconnecting screens already get the teaser from the
 * WS-hello snapshot. Only re-fire it if that persisted alert is missing/
 * dismissed — otherwise every restart double-plays the teaser's intro.
 */
function ensurePreLaunchAlert() {
  const existing = alertStore.getAlertById('hype-prelaunch-active');
  if (existing && existing.active && !existing.dismissed) return existing;
  return firePreLaunch();
}

/**
 * Reset to pre-launch idle: re-arms the teaser so it shows again. Useful
 * during rehearsals when the operator wants to "rewind" to the before-the-
 * show state without restarting the server.
 */
async function resetPreLaunch() {
  if (_launchTimer) { clearTimeout(_launchTimer); _launchTimer = null; }
  if (_revealTimer) { clearTimeout(_revealTimer); _revealTimer = null; }
  const saved = await hypeDb.updateSettings(_ctx.db, {
    preLaunch: true,
    launchActive: false,
    launchedAt: null,
    platformOff: false,
    nachtspelStage: null,
    // Teaser up → one press launches the platform (day-1 moment).
    physicalTrigger: 'launch',
  });
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  // Dismiss any lingering takeover alerts before arming the teaser.
  _dismissStoryAlert('hype-offline-active');
  _dismissStoryAlert('hype-reveal-active');
  _dismissStoryAlert('hype-trace-active');
  firePreLaunch();
  return saved;
}

/**
 * Power-off: theatrical full-screen takeover that lasts until restart.
 * Sets platformOff=true (persisted) and fires an alert with no auto-dismiss.
 */
async function powerOff({ message, instant } = {}) {
  if (_launchTimer) { clearTimeout(_launchTimer); _launchTimer = null; }
  if (_revealTimer) { clearTimeout(_revealTimer); _revealTimer = null; }
  const saved = await hypeDb.updateSettings(_ctx.db, {
    platformOff: true, launchActive: false, nachtspelStage: 'offline',
  });
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  // If the reveal cutscene led us here, its alert ends around now — make sure.
  _dismissStoryAlert('hype-reveal-active');
  _dismissStoryAlert('hype-prelaunch-active');
  const offlinePayload = { infinite: true, subtitle: 'het platform ligt eruit — iemand moet DeHype opnieuw opstarten' };
  _fireStoryAlert({
      id: 'hype-offline-active',
      type: 'hype-offline',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: message || 'DeHype is offline',
      payload: { ...offlinePayload, instant: !!instant },
      // Effectively infinite; only clearable by restartPlatform / alert_dismiss.
      durationSec: 0 /* infinite */,
      firedAt: Date.now(),
  },
  // Late joiners / reconnects skip the crash cinematic → straight to dead screen.
  { ...offlinePayload, instant: true });
  return saved;
}

/**
 * Camp-start reset: one button that puts the whole platform back to day 0.
 * Follower counts + history to 0, activity cleared, plot knobs to rest,
 * pre-launch teaser armed. For rehearsals and the real Saturday morning.
 */
async function resetForCamp() {
  await hypeDb.clearFollowerHistory(_ctx.db);
  await hypeDb.clearActivity(_ctx.db);
  state.clearActivity();
  // Restore each channel's canon spotlight/featured days and comment pool —
  // both get edited live during the week (Regie tab) and must snap back to
  // the draaiboek defaults on a fresh camp, not just carry over last edit.
  for (const defaults of DEFAULT_CHANNELS) {
    const current = state.getChannels().find(ch => ch.id === defaults.id);
    if (!current) continue;
    const saved = await hypeDb.upsertChannel(_ctx.db, { ...current, featured_days: defaults.featured_days });
    state.setChannel(saved);
    await hypeDb.replaceCommentPool(_ctx.db, defaults.id, DEFAULT_COMMENT_POOLS[defaults.id] || []);
    state.setCommentPool(defaults.id, await hypeDb.listCommentPool(_ctx.db, defaults.id));
  }
  for (const ch of state.getChannels()) {
    state.setFollowerCount(ch.id, ch.follower_base | 0);
  }
  state.setFollowerCount(GENERAL_FOLLOWERS_ID, 0);
  await hypeDb.updateSettings(_ctx.db, {
    harryHeat: 0,
    spotlightDay: 1,
    physicalTrigger: null,
    traceTarget: { location: '', lat: null, lon: null },
  });
  _ctx.broadcast({ type: `${NS}:channels_update`, channels: state.getChannels() });
  _ctx.broadcast({ type: `${NS}:followers_update`, counts: state.getAllFollowerCounts() });
  _ctx.broadcast({ type: `${NS}:activity_reset`, activity: [] });
  // resetPreLaunch handles stage/platformOff/launchedAt + teaser + dismissals,
  // and broadcasts the final settings snapshot.
  return resetPreLaunch();
}

/* ── Nachtspel: the Thursday-night finale ─────────────────────────────
 * armReveal   → infinite "grote onthulling" holding screen (crowd gathers)
 * startReveal → countdown → hack cutscene; server timer ends in powerOff()
 * traceHacker → Mark's trace scene over the offline screen
 * endTrace    → back to the offline screen (reboot game can start)
 */

async function armReveal() {
  if (_revealTimer) { clearTimeout(_revealTimer); _revealTimer = null; }
  // Holding screen up → the physical button becomes the "start" button.
  const saved = await hypeDb.updateSettings(_ctx.db, { nachtspelStage: 'armed', physicalTrigger: 'reveal' });
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  _scheduleHarryGlitch(); // stage set → auto-glitches go quiet
  _dismissStoryAlert('hype-prelaunch-active');
  _fireStoryAlert({
      id: 'hype-reveal-active',
      type: 'hype-reveal',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: 'De grote onthulling',
      payload: { standby: true },
      durationSec: 0 /* infinite */,
      firedAt: Date.now(),
  });
  await _recordActivity({ kind: 'platform', actorType: 'system', text: 'De grote onthulling begint zo…', source: 'system' });
  return saved;
}

async function startReveal({ countdownSec } = {}) {
  const countdown = Math.max(3, Math.min(60, Number(countdownSec) || 10));
  // Client timeline: countdown + compute(3) + glitch burst(starts +3).
  // powerOff fires MID-burst (+4): the offline shutdown animation (Harry
  // crashes the platform by accident) mounts under the reveal, which
  // glitch-fades out over it — a seamless handoff. The alert's own
  // durationSec (+5) is only the backstop if powerOff were to fail.
  const handoffSec = countdown + 4;
  const totalSec = countdown + 5;

  const saved = await hypeDb.updateSettings(_ctx.db, { nachtspelStage: 'reveal' });
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  _fireStoryAlert({
      id: 'hype-reveal-active',
      type: 'hype-reveal',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: 'De grote onthulling',
      payload: { countdownSec: countdown },
      durationSec: totalSec,
      firedAt: Date.now(),
  });

  // Server-side handoff into the full shutdown animation — survives a
  // closed admin tab. NOT instant: the hype-offline renderer plays Harry's
  // accidental crash (terminal → panic → countdown → CRT collapse).
  if (_revealTimer) clearTimeout(_revealTimer);
  _revealTimer = setTimeout(() => {
    _revealTimer = null;
    powerOff({}).catch(err => console.warn('[hype] reveal power-off failed:', err && err.message));
  }, handoffSec * 1000);

  await _recordActivity({ kind: 'platform', actorType: 'system', text: 'Onthulling gestart — wie heeft de meeste volgers?', source: 'system' });
  return saved;
}

async function traceHacker({ location, lat, lon } = {}) {
  const target = {
    location: String(location || '').slice(0, 120),
    lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
    lon: Number.isFinite(Number(lon)) ? Number(lon) : null,
  };
  const saved = await hypeDb.updateSettings(_ctx.db, { nachtspelStage: 'trace', traceTarget: target });
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  _fireStoryAlert({
      id: 'hype-trace-active',
      type: 'hype-trace',
      style: 'popup',
      position: 'center',
      priority: 'urgent',
      active: true,
      message: 'Signaal traceren',
      payload: target,
      // Stays until the operator ends it; the infinite offline alert sits underneath.
      durationSec: 0 /* infinite */,
      firedAt: Date.now(),
  });
  await _recordActivity({ kind: 'platform', actorType: 'system', text: 'Mark Suikerberg traceert het signaal van de hacker…', source: 'system' });
  return saved;
}

async function endTrace() {
  _dismissStoryAlert('hype-trace-active');
  const saved = await hypeDb.updateSettings(_ctx.db, { nachtspelStage: 'offline' });
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });
  return saved;
}

/**
 * Restart: BIOS-y boot animation that clears platformOff. Separate from
 * Launch (which is the Day 1 celebratory takeover).
 */
async function restartPlatform() {
  if (_launchTimer) { clearTimeout(_launchTimer); _launchTimer = null; }
  if (_revealTimer) { clearTimeout(_revealTimer); _revealTimer = null; }
  // Dismiss lingering finale alerts before playing the restart sequence.
  _dismissStoryAlert('hype-offline-active');
  _dismissStoryAlert('hype-reveal-active');
  _dismissStoryAlert('hype-trace-active');

  const saved = await hypeDb.updateSettings(_ctx.db, { platformOff: false, nachtspelStage: null, physicalTrigger: null });
  state.setSettings(saved);
  _ctx.broadcast({ type: `${NS}:settings_update`, settings: saved });

  const channelCount = state.getChannels().length;
  _fireStoryAlert({
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
      durationSec: 0 /* infinite */,
      firedAt: Date.now(),
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
  const spotlightDay = Math.max(1, Math.min(7, Number(settings.spotlightDay) || 1));
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
  ensurePreLaunchAlert,
  resetPreLaunch,
  resetForCamp,
  armReveal,
  startReveal,
  traceHacker,
  endTrace,
  powerOff,
  restartPlatform,
  morningCheck,
  addActivity,
};
