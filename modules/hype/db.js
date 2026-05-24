'use strict';

// Hype module schema. All tables prefixed `hype_` so disabling the module
// leaves zero ambiguity about ownership. Migrate is idempotent.

const { DEFAULT_CHANNELS, DEFAULT_COMMENT_POOLS } = require('./config-schema');

async function migrate(db) {
  const { run, get } = db;

  await run(`
    CREATE TABLE IF NOT EXISTS hype_channels (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      handle        TEXT NOT NULL,
      color         TEXT NOT NULL,
      emoji         TEXT,
      follower_base INTEGER NOT NULL DEFAULT 0,
      growth_rate   REAL    NOT NULL DEFAULT 1.0,
      sort_order    INTEGER NOT NULL DEFAULT 0
    )
  `);

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

  // Seed default channels + comments only if empty.
  const existing = await get(`SELECT COUNT(*) AS c FROM hype_channels`);
  if (!existing || existing.c === 0) {
    for (let i = 0; i < DEFAULT_CHANNELS.length; i++) {
      const c = DEFAULT_CHANNELS[i];
      await run(
        `INSERT INTO hype_channels (id, name, handle, color, emoji, follower_base, growth_rate, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.handle, c.color, c.emoji || '', c.follower_base, c.growth_rate, i],
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
}

/* ── Read helpers ─────────────────────────────────────────────────────── */

async function listChannels(db) {
  return db.all(`SELECT * FROM hype_channels ORDER BY sort_order ASC, id ASC`);
}

async function getChannel(db, id) {
  return db.get(`SELECT * FROM hype_channels WHERE id = ?`, [id]);
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
  const existing = await getChannel(db, c.id);
  if (existing) {
    await db.run(
      `UPDATE hype_channels SET name=?, handle=?, color=?, emoji=?, follower_base=?, growth_rate=?
       WHERE id=?`,
      [c.name, c.handle, c.color, c.emoji || '', c.follower_base | 0, Number(c.growth_rate) || 1.0, c.id],
    );
  } else {
    const last = await db.get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM hype_channels`);
    await db.run(
      `INSERT INTO hype_channels (id, name, handle, color, emoji, follower_base, growth_rate, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.name, c.handle, c.color, c.emoji || '', c.follower_base | 0, Number(c.growth_rate) || 1.0, (last?.m | 0) + 1],
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

module.exports = {
  migrate,
  listChannels,
  getChannel,
  listCommentPool,
  getPhotoStateRow,
  listPhotoStates,
  listRecentComments,
  upsertPhotoState,
  insertComment,
  upsertChannel,
  replaceCommentPool,
  recordFollowerCount,
};
