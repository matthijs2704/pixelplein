'use strict';

const fsp = require('fs').promises;

const { loadConfig } = require('./config');
const { initDb, loadPhotoOverrides } = require('./db');
const state = require('./state');
const { scanPhotos } = require('./features/ingest/index');
const { CACHE_DIR, THUMB_DIR } = require('./features/ingest/process');

async function clearDir(dirPath) {
  await fsp.rm(dirPath, { recursive: true, force: true });
  await fsp.mkdir(dirPath, { recursive: true });
}

async function waitForQueueToDrain() {
  while (state.queue.length > 0 || state.activeWorkers > 0) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

async function loadOverridesFromDb() {
  const entries = await loadPhotoOverrides();
  state.photoOverrides.clear();
  for (const entry of entries) {
    state.photoOverrides.set(entry.id, { heroCandidate: Boolean(entry.heroCandidate) });
  }
}

async function main() {
  loadConfig();
  await initDb();
  await loadOverridesFromDb();

  state.photosById.clear();
  state.queue.length = 0;
  state.queuedSet.clear();
  state.activeWorkers = 0;

  console.log('Clearing display and thumbnail cache...');
  await clearDir(CACHE_DIR);
  await clearDir(THUMB_DIR);

  console.log('Reprocessing photos...');
  await scanPhotos(false);
  await waitForQueueToDrain();

  const all = Array.from(state.photosById.values());
  const ready = all.filter(p => p.status === 'ready').length;
  const failed = all.filter(p => p.status === 'failed').length;

  console.log(`Done. Ready: ${ready}, Failed: ${failed}`);
}

main().catch(err => {
  console.error('Reprocess failed:', err.message);
  process.exit(1);
});
