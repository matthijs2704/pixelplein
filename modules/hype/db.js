'use strict';

// Hype module schema. All tables prefixed `hype_` so disabling the module
// leaves zero ambiguity about ownership. Migrate is idempotent.

const { DEFAULT_CHANNELS, DEFAULT_COMMENT_POOLS, DEFAULT_SETTINGS } = require('./config-schema');

const SETTINGS_KEY = 'hype:settings';

async function migrate(db) {
  const { run, get } = db;

  await run(`
    CREATE TABLE IF NOT EXISTS hype_channels (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      handle        TEXT NOT NULL,
      color         TEXT NOT NULL,
      avatar_url    TEXT NOT NULL DEFAULT '',
      follower_base INTEGER NOT NULL DEFAULT 0,
      growth_rate   REAL    NOT NULL DEFAULT 1.0,
      featured_days TEXT NOT NULL DEFAULT '[]',
      race_participant INTEGER NOT NULL DEFAULT 1,
      sort_order    INTEGER NOT NULL DEFAULT 0
    )
  `);
  try { await run(`ALTER TABLE hype_channels ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''`); } catch {}
  try { await run(`ALTER TABLE hype_channels ADD COLUMN featured_days TEXT NOT NULL DEFAULT '[]'`); } catch {}
  try { await run(`ALTER TABLE hype_channels ADD COLUMN race_participant INTEGER NOT NULL DEFAULT 1`); } catch {}

  await run(`
    CREATE TABLE IF NOT EXISTS hype_comments_pool (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      text       TEXT NOT NULL,
      weight     INTEGER NOT NULL DEFAULT 1
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_hype_pool_channel ON hype_comments_pool(channel_id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS hype_photo_state (
      photo_id   TEXT PRIMARY KEY,
      likes      INTEGER NOT NULL DEFAULT 0,
      viral      INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS hype_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id   TEXT NOT NULL,
      channel_id TEXT,
      author     TEXT NOT NULL,
      text       TEXT NOT NULL,
      source     TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_hype_comments_photo ON hype_comments(photo_id, created_at)`);

  await run(`
    CREATE TABLE IF NOT EXISTS hype_followers_history (
      channel_id TEXT NOT NULL,
      ts         INTEGER NOT NULL,
      count      INTEGER NOT NULL,
      PRIMARY KEY (channel_id, ts)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS hype_activity (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id   TEXT,
      photo_id   TEXT,
      text       TEXT NOT NULL,
      meta_json  TEXT,
      source     TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_hype_activity_created ON hype_activity(created_at DESC)`);

  await run(`
    CREATE TABLE IF NOT EXISTS hype_videos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      slide_id   TEXT,
      filename   TEXT NOT NULL,
      label      TEXT NOT NULL,
      placement  TEXT NOT NULL,
      active     INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  // Seed default channels + comments only if empty.
  const existing = await get(`SELECT COUNT(*) AS c FROM hype_channels`);
  if (!existing || existing.c === 0) {
    for (let i = 0; i < DEFAULT_CHANNELS.length; i++) {
      const c = DEFAULT_CHANNELS[i];
      await run(
        `INSERT INTO hype_channels (id, name, handle, color, avatar_url, follower_base, growth_rate, featured_days, race_participant, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.handle, c.color, c.avatar_url || '', c.follower_base, 1.0, JSON.stringify(c.featured_days || []), c.race_participant === false ? 0 : 1, i],
      );
      const pool = DEFAULT_COMMENT_POOLS[c.id] || [];
      for (const p of pool) {
        await run(
          `INSERT INTO hype_comments_pool (channel_id, text, weight) VALUES (?, ?, ?)`,
          [c.id, p.text, p.weight | 0 || 1],
        );
      }
    }
  }
  for (let i = 0; i < DEFAULT_CHANNELS.length; i++) {
    const c = DEFAULT_CHANNELS[i];
    const row = await get(`SELECT id FROM hype_channels WHERE id = ?`, [c.id]);
    if (row) continue;
    const last = await get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM hype_channels`);
    await run(
      `INSERT INTO hype_channels (id, name, handle, color, avatar_url, follower_base, growth_rate, featured_days, race_participant, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.name, c.handle, c.color, c.avatar_url || '', c.follower_base, 1.0, JSON.stringify(c.featured_days || []), c.race_participant === false ? 0 : 1, (last?.m | 0) + 1],
    );
    const pool = DEFAULT_COMMENT_POOLS[c.id] || [];
    for (const p of pool) {
      await run(
        `INSERT INTO hype_comments_pool (channel_id, text, weight) VALUES (?, ?, ?)`,
        [c.id, p.text, p.weight | 0 || 1],
      );
    }
  }

  const settings = await db.getSettingJson(SETTINGS_KEY);
  if (!settings) await db.setSettingJson(SETTINGS_KEY, DEFAULT_SETTINGS);
}

/* ── Read helpers ─────────────────────────────────────────────────────── */

function _normalizeChannel(row) {
  if (!row) return row;
  let featured = [];
  try {
    const parsed = JSON.parse(row.featured_days || '[]');
    if (Array.isArray(parsed)) {
      featured = parsed.map(n => Math.max(1, Math.min(6, Number(n) | 0))).filter(Boolean);
    }
  } catch {}
  return { ...row, featured_days: featured, race_participant: row.race_participant !== 0 };
}

async function listChannels(db) {
  const rows = await db.all(`SELECT * FROM hype_channels ORDER BY sort_order ASC, id ASC`);
  return rows.map(_normalizeChannel);
}

async function getChannel(db, id) {
  const row = await db.get(`SELECT * FROM hype_channels WHERE id = ?`, [id]);
  return _normalizeChannel(row);
}

async function listCommentPool(db, channelId) {
  return db.all(
    `SELECT id, channel_id, text, weight FROM hype_comments_pool WHERE channel_id = ? ORDER BY id ASC`,
    [channelId],
  );
}

async function getPhotoStateRow(db, photoId) {
  return db.get(`SELECT * FROM hype_photo_state WHERE photo_id = ?`, [photoId]);
}

async function listPhotoStates(db, photoIds) {
  if (!photoIds || !photoIds.length) return [];
  const placeholders = photoIds.map(() => '?').join(',');
  return db.all(
    `SELECT * FROM hype_photo_state WHERE photo_id IN (${placeholders})`,
    photoIds,
  );
}

async function listRecentComments(db, photoId, limit = 5) {
  return db.all(
    `SELECT * FROM hype_comments WHERE photo_id = ? ORDER BY id DESC LIMIT ?`,
    [photoId, Math.max(1, Math.min(50, limit | 0))],
  );
}

async function getSettings(db) {
  const saved = await db.getSettingJson(SETTINGS_KEY);
  return _mergeSettings(saved || {});
}

async function updateSettings(db, patch) {
  const current = await getSettings(db);
  const next = _mergeSettings({ ...current, ...(patch || {}) });
  if (patch?.generalAccount) {
    next.generalAccount = _mergeSettings({
      generalAccount: { ...current.generalAccount, ...patch.generalAccount },
    }).generalAccount;
  }
  if (patch?.feedMix) {
    next.feedMix = _mergeSettings({
      feedMix: { ...current.feedMix, ...patch.feedMix },
    }).feedMix;
  }
  await db.setSettingJson(SETTINGS_KEY, next);
  return next;
}

/* ── Write helpers ────────────────────────────────────────────────────── */

async function upsertPhotoState(db, photoId, { likesDelta = 0, viral = null } = {}) {
  const now = Date.now();
  const row = await getPhotoStateRow(db, photoId);
  if (!row) {
    await db.run(
      `INSERT INTO hype_photo_state (photo_id, likes, viral, updated_at) VALUES (?, ?, ?, ?)`,
      [photoId, Math.max(0, likesDelta | 0), viral ? 1 : 0, now],
    );
    return { photo_id: photoId, likes: Math.max(0, likesDelta | 0), viral: viral ? 1 : 0, updated_at: now };
  }
  const nextLikes = Math.max(0, (row.likes | 0) + (likesDelta | 0));
  const nextViral = viral == null ? row.viral : (viral ? 1 : 0);
  await db.run(
    `UPDATE hype_photo_state SET likes = ?, viral = ?, updated_at = ? WHERE photo_id = ?`,
    [nextLikes, nextViral, now, photoId],
  );
  return { photo_id: photoId, likes: nextLikes, viral: nextViral, updated_at: now };
}

async function insertComment(db, { photoId, channelId, author, text, source }) {
  const now = Date.now();
  const res = await db.run(
    `INSERT INTO hype_comments (photo_id, channel_id, author, text, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [photoId, channelId || null, author, text, source || 'auto', now],
  );
  return {
    id: res.lastID,
    photo_id: photoId,
    channel_id: channelId || null,
    author,
    text,
    source: source || 'auto',
    created_at: now,
  };
}

async function upsertChannel(db, c) {
  const featured = JSON.stringify(
    Array.isArray(c.featured_days)
      ? c.featured_days.map(n => Math.max(1, Math.min(6, Number(n) | 0))).filter(Boolean)
      : [],
  );
  const existing = await db.get(`SELECT id FROM hype_channels WHERE id = ?`, [c.id]);
  if (existing) {
    await db.run(
      `UPDATE hype_channels SET name=?, handle=?, color=?, avatar_url=?, follower_base=?, featured_days=?, race_participant=?
       WHERE id=?`,
      [c.name, c.handle, c.color, c.avatar_url || '', c.follower_base | 0, featured, c.race_participant === false ? 0 : 1, c.id],
    );
  } else {
    const last = await db.get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM hype_channels`);
    await db.run(
      `INSERT INTO hype_channels (id, name, handle, color, avatar_url, follower_base, growth_rate, featured_days, race_participant, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.name, c.handle, c.color, c.avatar_url || '', c.follower_base | 0, 1.0, featured, c.race_participant === false ? 0 : 1, (last?.m | 0) + 1],
    );
  }
  return getChannel(db, c.id);
}

async function replaceCommentPool(db, channelId, items) {
  await db.run(`DELETE FROM hype_comments_pool WHERE channel_id = ?`, [channelId]);
  for (const it of items) {
    if (!it || typeof it.text !== 'string' || !it.text.trim()) continue;
    await db.run(
      `INSERT INTO hype_comments_pool (channel_id, text, weight) VALUES (?, ?, ?)`,
      [channelId, it.text.trim().slice(0, 200), Math.max(1, Math.min(100, it.weight | 0 || 1))],
    );
  }
}

async function recordFollowerCount(db, channelId, count) {
  await db.run(
    `INSERT OR REPLACE INTO hype_followers_history (channel_id, ts, count) VALUES (?, ?, ?)`,
    [channelId, Date.now(), count | 0],
  );
}

async function insertActivity(db, item) {
  const now = Date.now();
  const meta = item.meta && typeof item.meta === 'object' ? JSON.stringify(item.meta) : null;
  const res = await db.run(
    `INSERT INTO hype_activity (kind, actor_type, actor_id, photo_id, text, meta_json, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.kind || 'message',
      item.actorType || 'system',
      item.actorId || null,
      item.photoId || null,
      String(item.text || '').slice(0, 280),
      meta,
      item.source || 'template',
      now,
    ],
  );
  return {
    id: res.lastID,
    kind: item.kind || 'message',
    actor_type: item.actorType || 'system',
    actor_id: item.actorId || null,
    photo_id: item.photoId || null,
    text: String(item.text || '').slice(0, 280),
    meta_json: meta,
    source: item.source || 'template',
    created_at: now,
  };
}

async function listRecentActivity(db, limit = 40) {
  return db.all(
    `SELECT * FROM hype_activity ORDER BY id DESC LIMIT ?`,
    [Math.max(1, Math.min(200, limit | 0))],
  );
}

async function clearActivity(db) {
  await db.run(`DELETE FROM hype_activity`);
}

async function upsertVideo(db, item) {
  const now = Date.now();
  if (item.id) {
    await db.run(
      `UPDATE hype_videos SET slide_id=?, filename=?, label=?, placement=?, active=? WHERE id=?`,
      [item.slideId || null, item.filename, item.label, item.placement || 'post', item.active ? 1 : 0, item.id],
    );
    return db.get(`SELECT * FROM hype_videos WHERE id = ?`, [item.id]);
  }
  const res = await db.run(
    `INSERT INTO hype_videos (slide_id, filename, label, placement, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [item.slideId || null, item.filename, item.label, item.placement || 'post', item.active ? 1 : 0, now],
  );
  return db.get(`SELECT * FROM hype_videos WHERE id = ?`, [res.lastID]);
}

async function listVideos(db) {
  return db.all(`SELECT * FROM hype_videos ORDER BY id DESC`);
}

function _mergeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const account = src.generalAccount && typeof src.generalAccount === 'object' ? src.generalAccount : {};
  const feedMix = src.feedMix && typeof src.feedMix === 'object' ? src.feedMix : {};
  const stream = src.stream && typeof src.stream === 'object' ? src.stream : {};
  return {
    ...DEFAULT_SETTINGS,
    mode: ['dashboard', 'social-only'].includes(src.mode) ? src.mode : 'normal',
    harryHeat: Math.max(0, Math.min(5, Number(src.harryHeat) | 0)),
    spotlightDay: Math.max(1, Math.min(6, Number(src.spotlightDay || DEFAULT_SETTINGS.spotlightDay) | 0)),
    platformOff: Boolean(src.platformOff),
    preLaunch: src.preLaunch === undefined ? true : Boolean(src.preLaunch),
    launchActive: Boolean(src.launchActive),
    activeVideo: src.activeVideo || DEFAULT_SETTINGS.activeVideo,
    generalAccount: {
      ...DEFAULT_SETTINGS.generalAccount,
      ...account,
      name: String(account.name || DEFAULT_SETTINGS.generalAccount.name).slice(0, 80),
      handle: String(account.handle || DEFAULT_SETTINGS.generalAccount.handle).slice(0, 40),
      color: String(account.color || DEFAULT_SETTINGS.generalAccount.color).slice(0, 16),
      avatarUrl: String(account.avatarUrl || '').slice(0, 500),
    },
    feedMix: {
      generalWeight: Math.max(1, Number(feedMix.generalWeight || DEFAULT_SETTINGS.feedMix.generalWeight) | 0),
      influencerWeight: Math.max(1, Number(feedMix.influencerWeight || DEFAULT_SETTINGS.feedMix.influencerWeight) | 0),
    },
    stream: {
      ...DEFAULT_SETTINGS.stream,
      ...stream,
      enabled: Boolean(stream.enabled),
      sourceType: ['video', 'url', 'camera'].includes(stream.sourceType) ? stream.sourceType : 'video',
      videoId: stream.videoId == null || stream.videoId === '' ? null : Number(stream.videoId) || null,
      url: String(stream.url || '').slice(0, 1000),
      deviceId: String(stream.deviceId || '').slice(0, 300),
      title: String(stream.title || DEFAULT_SETTINGS.stream.title).slice(0, 80),
      subtitle: String(stream.subtitle || DEFAULT_SETTINGS.stream.subtitle).slice(0, 120),
    },
    contentProvider: src.contentProvider === 'ai' ? 'ai' : 'template',
  };
}

module.exports = {
  migrate,
  listChannels,
  getChannel,
  listCommentPool,
  getPhotoStateRow,
  listPhotoStates,
  listRecentComments,
  getSettings,
  updateSettings,
  upsertPhotoState,
  insertComment,
  upsertChannel,
  replaceCommentPool,
  recordFollowerCount,
  insertActivity,
  listRecentActivity,
  clearActivity,
  upsertVideo,
  listVideos,
};
