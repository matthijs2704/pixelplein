'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { initDb, clearAllPhotoMetadata, setSettingJson } = require('./db');
const { addUser, removeUser, listUsers } = require('./features/auth/users');

const PHOTOS_DIR          = path.join(__dirname, '..', 'photos');
const SUBMISSION_ORIG_DIR = path.join(__dirname, '..', 'submission-assets', 'original');
const SUBMISSION_THUMB_DIR = path.join(__dirname, '..', 'submission-assets', 'thumb');
const CACHE_DISPLAY_DIR   = path.join(__dirname, '..', 'cache', 'display');
const CACHE_THUMB_DIR     = path.join(__dirname, '..', 'cache', 'thumb');

async function clearDir(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // directory doesn't exist
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isFile()) {
      await fsp.unlink(path.join(dir, entry.name));
      count++;
    }
  }
  return count;
}

async function main() {
  const [cmd, arg1, arg2] = process.argv.slice(2);
  await initDb();

  if (cmd === 'add-user') {
    if (!arg1 || !arg2) {
      throw new Error('Usage: node server/cli.js add-user <username> <password>');
    }
    const user = await addUser(arg1, arg2);
    console.log(`User '${user.username}' added.`);
    return;
  }

  if (cmd === 'remove-user') {
    if (!arg1) throw new Error('Usage: node server/cli.js remove-user <username>');
    const user = await removeUser(arg1);
    console.log(`User '${user.username}' removed.`);
    return;
  }

  if (cmd === 'list-users') {
    const users = await listUsers();
    if (!users.length) {
      console.log('No users configured.');
      return;
    }
    console.log('Users:');
    for (const u of users) {
      console.log(`  ${u.username} (id: ${u.id})`);
    }
    return;
  }

  if (cmd === 'clear-photos') {
    const photosCount = await clearDir(PHOTOS_DIR);
    const origCount   = await clearDir(SUBMISSION_ORIG_DIR);
    const thumbCount  = await clearDir(SUBMISSION_THUMB_DIR);
    const cacheCount  = await clearDir(CACHE_DISPLAY_DIR);
    const cacheThumb  = await clearDir(CACHE_THUMB_DIR);

    await clearAllPhotoMetadata();
    await setSettingJson('submissions', []);

    const total = photosCount + origCount + thumbCount + cacheCount + cacheThumb;
    console.log(`Cleared ${total} files:`);
    console.log(`  photos/: ${photosCount}`);
    console.log(`  submission-assets/original/: ${origCount}`);
    console.log(`  submission-assets/thumb/: ${thumbCount}`);
    console.log(`  cache/display/: ${cacheCount}`);
    console.log(`  cache/thumb/: ${cacheThumb}`);
    console.log('Photo metadata and submissions cleared from database/config.');
    return;
  }

  throw new Error('Usage: node server/cli.js <add-user|remove-user|list-users|clear-photos> ...');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
