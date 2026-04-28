'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'pixelplein.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      return resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      return resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows || []);
    });
  });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS photo_metadata (
      photo_id TEXT PRIMARY KEY,
      name TEXT,
      event_group TEXT,
      relative_path TEXT,
      source_path TEXT,
      source_url TEXT,
      display_url TEXT,
      added_at INTEGER,
      captured_at INTEGER,
      processed_at INTEGER,
      status TEXT,
      error TEXT,
      width INTEGER,
      height INTEGER,
      display_width INTEGER,
      display_height INTEGER,
      hero_candidate INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `);

  try {
    await run('ALTER TABLE photo_metadata ADD COLUMN captured_at INTEGER');
  } catch {}

  try {
    await run('ALTER TABLE photo_metadata ADD COLUMN processed_at INTEGER');
  } catch {}
}

async function listUsersFromDb() {
  return all('SELECT id, username FROM users ORDER BY lower(username) ASC');
}

async function getUserByUsername(username) {
  return get(
    'SELECT id, username, password_hash AS passwordHash FROM users WHERE lower(username) = lower(?) LIMIT 1',
    [username],
  );
}

async function insertUser({ id, username, passwordHash }) {
  await run(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    [id, username, passwordHash, Date.now()],
  );
}

async function deleteUserByUsername(username) {
  const info = await run('DELETE FROM users WHERE lower(username) = lower(?)', [username]);
  return info.changes || 0;
}

async function getSettingJson(key) {
  const row = await get('SELECT value FROM app_settings WHERE key = ? LIMIT 1', [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function setSettingJson(key, value) {
  await run(
    `INSERT INTO app_settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}

async function upsertPhotoMetadata(photo) {
  if (!photo?.id) return;

  await run(
    `INSERT INTO photo_metadata (
      photo_id, name, event_group, relative_path, source_path, source_url,
      display_url, added_at, captured_at, processed_at, status, error, width, height, display_width,
      display_height, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(photo_id) DO UPDATE SET
      name = excluded.name,
      event_group = excluded.event_group,
      relative_path = excluded.relative_path,
      source_path = excluded.source_path,
      source_url = excluded.source_url,
      display_url = excluded.display_url,
      added_at = excluded.added_at,
      captured_at = excluded.captured_at,
      processed_at = excluded.processed_at,
      status = excluded.status,
      error = excluded.error,
      width = excluded.width,
      height = excluded.height,
      display_width = excluded.display_width,
      display_height = excluded.display_height,
      updated_at = excluded.updated_at`,
    [
      photo.id,
      photo.name || null,
      photo.eventGroup || null,
      photo.relativePath || null,
      photo.sourcePath || null,
      photo.sourceUrl || null,
      photo.displayUrl || null,
      Number(photo.addedAt || 0),
      Number.isFinite(photo.capturedAt) ? photo.capturedAt : null,
      Number(photo.processedAt || 0) || null,
      photo.status || null,
      photo.error || null,
      Number.isFinite(photo.width) ? photo.width : null,
      Number.isFinite(photo.height) ? photo.height : null,
      Number.isFinite(photo.displayWidth) ? photo.displayWidth : null,
      Number.isFinite(photo.displayHeight) ? photo.displayHeight : null,
      Date.now(),
    ],
  );
}

async function setHeroCandidate(photoId, heroCandidate) {
  await run(
    `INSERT INTO photo_metadata (photo_id, hero_candidate, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(photo_id) DO UPDATE SET
       hero_candidate = excluded.hero_candidate,
       updated_at = excluded.updated_at`,
    [photoId, heroCandidate ? 1 : 0, Date.now()],
  );
}

async function deletePhotoMetadata(photoId) {
  await run('DELETE FROM photo_metadata WHERE photo_id = ?', [photoId]);
}

async function loadPhotoOverrides() {
  const rows = await all('SELECT photo_id, hero_candidate FROM photo_metadata WHERE hero_candidate = 1');
  return rows.map(r => ({ id: r.photo_id, heroCandidate: Boolean(r.hero_candidate) }));
}

/**
 * Load all persisted photo records so the server can restore ready-photo state
 * on startup without re-running Sharp on every file.
 * @returns {Promise<object[]>}
 */
async function clearAllPhotoMetadata() {
  await run('DELETE FROM photo_metadata');
}

async function loadAllPhotoMetadata() {
  const rows = await all('SELECT * FROM photo_metadata');
  return rows.map(r => ({
    id:            r.photo_id,
    name:          r.name          || null,
    eventGroup:    r.event_group   || null,
    relativePath:  r.relative_path || null,
    sourcePath:    r.source_path   || null,
    sourceUrl:     r.source_url    || null,
    displayUrl:    r.display_url   || null,
    addedAt:       r.added_at      || 0,
    capturedAt:    typeof r.captured_at === 'number' ? r.captured_at : null,
    processedAt:   r.processed_at  || null,
    status:        r.status        || 'queued',
    error:         r.error         || null,
    width:         r.width         || null,
    height:        r.height        || null,
    displayWidth:  r.display_width  || null,
    displayHeight: r.display_height || null,
    heroCandidate: Boolean(r.hero_candidate),
  }));
}

module.exports = {
  DB_PATH,
  initDb,
  listUsersFromDb,
  getUserByUsername,
  insertUser,
  deleteUserByUsername,
  getSettingJson,
  setSettingJson,
  upsertPhotoMetadata,
  setHeroCandidate,
  deletePhotoMetadata,
  loadPhotoOverrides,
  loadAllPhotoMetadata,
  clearAllPhotoMetadata,
};
