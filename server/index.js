'use strict';

const express     = require('express');
const httpMod     = require('http');
const path        = require('path');
const fs          = require('fs');
const os          = require('os');
const crypto      = require('crypto');
const session     = require('express-session');
const compression = require('compression');

const { loadConfig, getConfig, saveConfig } = require('./config');
const { initDb, loadPhotoOverrides, loadAllPhotoMetadata, DB_PATH } = require('./db');
const state          = require('./state');
const { createWss }  = require('./features/ws/index');
const { startWatcher } = require('./features/ingest/watcher');
const { scanPhotos, PHOTOS_DIR } = require('./features/ingest/index');
const { CACHE_DIR, THUMB_DIR, toCacheFilePath, toThumbFilePath } = require('./features/ingest/process');
const { startAlertScheduler, stopAlertScheduler } = require('./features/alerts/scheduler');
const { initAlertStore } = require('./features/alerts/store');
const { initSubmissionStore } = require('./features/submissions/store');

const photosRouter  = require('./features/photos/routes');
const screensRouter = require('./features/screens/routes');
const { publicRouter: screenDevicesPublicRouter, adminRouter: screenDevicesAdminRouter } = require('./features/screens/device-routes');
const { slidesRouter, playlistRouter, qrRouter } = require('./features/slides/routes');
const themesRouter  = require('./features/themes/routes');
const alertsRouter  = require('./features/alerts/routes');
const { publicRouter: submissionsPublicRouter, adminRouter: submissionsAdminRouter } = require('./features/submissions/routes');
const { router: authRouter, requireAuth } = require('./features/auth/routes');
const { THEMES_DIR } = require('./features/themes/store');
const {
  SUBMISSION_ASSETS_DIR,
  SUBMISSION_ORIGINAL_DIR,
  SUBMISSION_THUMB_DIR,
} = require('./features/submissions/paths');

function getLocalIPs() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

// Ensure required directories exist
const SLIDE_ASSETS_DIR = path.join(__dirname, '..', 'slide-assets');
const VIDEOS_DIR       = path.join(SLIDE_ASSETS_DIR, 'videos');
const IMAGES_DIR       = path.join(SLIDE_ASSETS_DIR, 'images');
const QR_CACHE_DIR     = path.join(__dirname, '..', 'cache', 'qr');

fs.mkdirSync(PHOTOS_DIR,  { recursive: true });
fs.mkdirSync(CACHE_DIR,   { recursive: true });
fs.mkdirSync(THUMB_DIR,   { recursive: true });
fs.mkdirSync(VIDEOS_DIR,  { recursive: true });
fs.mkdirSync(IMAGES_DIR,  { recursive: true });
fs.mkdirSync(QR_CACHE_DIR, { recursive: true });
fs.mkdirSync(THEMES_DIR,   { recursive: true });
fs.mkdirSync(SUBMISSION_ASSETS_DIR, { recursive: true });
fs.mkdirSync(SUBMISSION_ORIGINAL_DIR, { recursive: true });
fs.mkdirSync(SUBMISSION_THUMB_DIR, { recursive: true });

// Load persisted config
loadConfig();

function _getOrCreateSessionSecret() {
  const cfg = getConfig();
  if (typeof cfg.sessionSecret === 'string' && cfg.sessionSecret) return cfg.sessionSecret;
  cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
  saveConfig();
  return cfg.sessionSecret;
}

async function _loadPhotoOverridesFromDb() {
  const entries = await loadPhotoOverrides();
  state.photoOverrides.clear();
  for (const entry of entries) {
    state.photoOverrides.set(entry.id, { heroCandidate: Boolean(entry.heroCandidate) });
  }
}

/**
 * Restore full photo state from the database so scanPhotos() can skip
 * re-running Sharp on files whose cache is still valid.
 */
async function _preloadPhotoStateFromDb() {
  const rows = await loadAllPhotoMetadata();
  let restored = 0;
  for (const row of rows) {
    if (!row.id) continue;
    // Derive cache/thumb paths the same way process.js does
    row.cachePath = toCacheFilePath(row.id);
    row.thumbPath = toThumbFilePath(row.id);
    // Apply any heroCandidate override from the separate overrides map
    const override = state.photoOverrides.get(row.id);
    if (override) row.heroCandidate = override.heroCandidate;
    state.photosById.set(row.id, row);
    restored++;
  }
  if (restored) console.log(`[db] Restored ${restored} photo records from database`);
}

// ---------------------------------------------------------------------------
// HTTP server + Express
// ---------------------------------------------------------------------------

const app    = express();
const server = httpMod.createServer(app);

app.set('trust proxy', 1);

app.use(compression());
app.use(express.json());
const sessionMiddleware = session({
  name: 'pixelplein.sid',
  secret: _getOrCreateSessionSecret(),
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
});

app.use(sessionMiddleware);

// Static file serving — cache/display served at /photos, originals at /photos-original
app.use('/photos', (req, _res, next) => {
  state.metrics.cacheFileServed += 1;
  next();
}, express.static(CACHE_DIR, {
  maxAge: '1y',
  immutable: true,
}));

app.use('/thumbs', express.static(THUMB_DIR, {
  maxAge: '1y',
  immutable: true,
}));

app.use('/photos-original',  express.static(PHOTOS_DIR));
app.use('/slide-assets',     express.static(SLIDE_ASSETS_DIR, {
  maxAge:       '7d',      // browser caches videos/images for 7 days
  etag:         true,      // conditional GET on revisit
  lastModified: true,
}));
app.use('/cache/qr',         express.static(QR_CACHE_DIR, {
  maxAge: '1y',
  immutable: true,
}));
app.use('/themes',           express.static(THEMES_DIR));
app.use('/submission-assets', express.static(SUBMISSION_ASSETS_DIR, {
  maxAge: '30d',
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Clean URLs — serve HTML files without the .html extension
const _pub = f => path.join(__dirname, '..', 'public', f);
app.get('/screen',  (_req, res) => res.sendFile(_pub('screen.html')));
app.get('/admin',   (_req, res) => res.sendFile(_pub('admin.html')));
app.get('/login',   (_req, res) => res.sendFile(_pub('login.html')));
app.get('/preview', (_req, res) => res.sendFile(_pub('preview.html')));
app.get('/submit',  (_req, res) => res.sendFile(_pub('submit.html')));

// API routes — /api/auth is public; everything else requires a session
app.use('/api/auth',       authRouter);
app.use('/api/submissions', submissionsPublicRouter);
app.use('/api/screens',    screenDevicesPublicRouter);
app.use('/api/slides',     qrRouter);
app.use('/api/photos',     requireAuth, photosRouter);
app.use('/api/slides',     requireAuth, slidesRouter);
app.use('/api/playlists',  requireAuth, playlistRouter);
app.use('/api/themes',     themesRouter);  // read-only theme listing, no PIN needed
app.use('/api/submissions', requireAuth, submissionsAdminRouter);
app.use('/api/screens',    requireAuth, screenDevicesAdminRouter);
app.use('/api',            requireAuth, alertsRouter);
app.use('/api',            requireAuth, screensRouter);

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

createWss(server, sessionMiddleware);

// ---------------------------------------------------------------------------
// Initial scan
// ---------------------------------------------------------------------------

async function boot() {
  await initDb();
  await initAlertStore();
  await initSubmissionStore();
  await _loadPhotoOverridesFromDb();
  await _preloadPhotoStateFromDb(); // restore ready-photo state before scan

  startWatcher();
  await scanPhotos(true);
  startAlertScheduler();

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    const ips      = getLocalIPs();
    const localUrl = `http://${ips[0] || 'localhost'}:${PORT}`;
    const base     = getConfig().publicBaseUrl || localUrl;
    const adminUrl = `${base}/admin`;

    console.log(`\nPixelPlein running on http://0.0.0.0:${PORT}`);
    if (ips.length > 1) console.log(`  LAN IPs    : ${ips.join(', ')}`);
    console.log(`  Screen 1   : ${base}/screen?screen=1`);
    console.log(`  Screen 2   : ${base}/screen?screen=2`);
    console.log(`  Admin      : ${adminUrl}`);
    console.log(`  Login      : ${base}/login`);
    console.log(`  Preview    : ${base}/preview`);
    console.log(`  Photos     : ${PHOTOS_DIR}`);
    console.log(`  Cache      : ${CACHE_DIR}`);
    console.log(`  Videos     : ${VIDEOS_DIR}`);
    console.log(`  Database   : ${DB_PATH}\n`);

    const QRCode = require('qrcode');
    QRCode.toString(adminUrl, { type: 'terminal', small: true }, (err, str) => {
      if (!err) process.stdout.write(str + '\n');
    });
  });
}

boot().catch(err => {
  console.error('Startup failed:', err.message);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const { _getWss }    = require('./features/ws/broadcast');

let _shuttingDown = false;

function shutdown(signal) {
  if (_shuttingDown) return;   // ignore repeated signals (e.g. double ^C)
  _shuttingDown = true;

  console.log(`\n${signal} received — shutting down gracefully…`);

  // Flush pending config save
  saveConfig();

  stopAlertScheduler();

  // Terminate all WebSocket connections immediately — open WS connections
  // keep the HTTP server alive and prevent server.close() from calling back.
  const wss = _getWss();
  if (wss) {
    wss.clients.forEach(ws => ws.terminate());
    wss.close();
  }

  // Stop accepting new HTTP connections; exit once existing ones drain
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });

  // Force exit after 5 s if something still hangs (e.g. a long Sharp job)
  setTimeout(() => {
    console.warn('Forced exit after timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
