'use strict';

const express = require('express');
const httpMod = require('http');
const path    = require('path');
const fs      = require('fs');

const { loadConfig } = require('./config');
const state          = require('./state');
const { createWss }  = require('./features/ws/index');
const { startWatcher } = require('./features/ingest/watcher');
const { scanPhotos, PHOTOS_DIR } = require('./features/ingest/index');
const { CACHE_DIR }  = require('./features/ingest/process');

const photosRouter  = require('./features/photos/routes');
const screensRouter = require('./features/screens/routes');
const { slidesRouter, playlistRouter } = require('./features/slides/routes');
const themesRouter  = require('./features/themes/routes');
const authRouter = require('./features/auth/routes');
const { THEMES_DIR } = require('./features/themes/store');

// Ensure required directories exist
const SLIDE_ASSETS_DIR = path.join(__dirname, '..', 'slide-assets');
const VIDEOS_DIR       = path.join(SLIDE_ASSETS_DIR, 'videos');
const IMAGES_DIR       = path.join(SLIDE_ASSETS_DIR, 'images');
const QR_CACHE_DIR     = path.join(__dirname, '..', 'cache', 'qr');

fs.mkdirSync(PHOTOS_DIR,  { recursive: true });
fs.mkdirSync(CACHE_DIR,   { recursive: true });
fs.mkdirSync(VIDEOS_DIR,  { recursive: true });
fs.mkdirSync(IMAGES_DIR,  { recursive: true });
fs.mkdirSync(QR_CACHE_DIR, { recursive: true });
fs.mkdirSync(THEMES_DIR,   { recursive: true });

// Load persisted config + photo overrides
loadConfig();

// ---------------------------------------------------------------------------
// HTTP server + Express
// ---------------------------------------------------------------------------

const app    = express();
const server = httpMod.createServer(app);

app.use(express.json());

// Static file serving — cache/display served at /photos, originals at /photos-original
app.use('/photos', (req, _res, next) => {
  state.metrics.cacheFileServed += 1;
  next();
}, express.static(CACHE_DIR));

app.use('/photos-original',  express.static(PHOTOS_DIR));
app.use('/slide-assets',     express.static(SLIDE_ASSETS_DIR));
app.use('/cache/qr',         express.static(QR_CACHE_DIR));
app.use('/themes',           express.static(THEMES_DIR));
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/photos',     photosRouter);
app.use('/api/slides',     slidesRouter);
app.use('/api/playlists',  playlistRouter);
app.use('/api/themes',     themesRouter);
app.use('/api/auth',       authRouter);
app.use('/api',            screensRouter);

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

createWss(server);

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

startWatcher();

// ---------------------------------------------------------------------------
// Initial scan
// ---------------------------------------------------------------------------

scanPhotos().catch(err => {
  console.error('Initial scan failed:', err.message);
});

// ---------------------------------------------------------------------------
// Listen
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nPixelPlein running on http://0.0.0.0:${PORT}`);
  console.log(`  Screen 1   : http://<your-ip>:${PORT}/screen.html?screen=1`);
  console.log(`  Screen 2   : http://<your-ip>:${PORT}/screen.html?screen=2`);
  console.log(`  Admin      : http://<your-ip>:${PORT}/admin.html`);
  console.log(`  Preview    : http://<your-ip>:${PORT}/preview.html`);
  console.log(`  Photos     : ${PHOTOS_DIR}`);
  console.log(`  Cache      : ${CACHE_DIR}`);
  console.log(`  Videos     : ${VIDEOS_DIR}\n`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const { saveConfig } = require('./config');
const { _getWss }    = require('./features/ws/broadcast');

let _shuttingDown = false;

function shutdown(signal) {
  if (_shuttingDown) return;   // ignore repeated signals (e.g. double ^C)
  _shuttingDown = true;

  console.log(`\n${signal} received — shutting down gracefully…`);

  // Flush pending config save
  saveConfig();

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
