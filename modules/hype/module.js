'use strict';

// Hype module entry point. Wired into the loader at boot when 'hype' is in
// config.enabledModules. Idempotent.

const hypeDb = require('./db');
const state  = require('./state');
const engine = require('./engine');
const streamChat = require('./stream-chat');
const { createPublicRouter, createAdminRouter } = require('./routes');

module.exports = {
  name: 'hype',

  screenLayouts: [
    { id: 'hype:post-card',      label: 'Post card (Hype)' },
    { id: 'hype:story',          label: 'Story (Hype)' },
    { id: 'hype:reels-vertical', label: 'Reels vertical (Hype)' },
    { id: 'hype:polaroid',       label: 'Polaroid (Hype)' },
    { id: 'hype:stories-row',    label: 'Stories row (Hype)' },
    { id: 'hype:explore-grid',   label: 'Explore grid (Hype)' },
    { id: 'hype:duo-post',       label: 'Duo post cards (Hype)' },
  ],

  slideTypes: [
    { type: 'hype-followers', label: 'Followers counter (Hype)' },
    { type: 'hype-feed',      label: 'Activity feed (Hype)' },
    { type: 'hype-trending',  label: 'Trending (Hype)' },
    { type: 'hype-viral',     label: 'Gaat nu viral (Hype)' },
  ],

  async migrate(db) {
    await hypeDb.migrate(db);
  },

  // Called by the core "delete all photos" wipe.
  async clearPhotoData(db) {
    await db.run('DELETE FROM hype_photo_state');
    await db.run('DELETE FROM hype_comments');
    await state.load(db);
  },

  async register(ctx) {
    await state.load(ctx.db);

    ctx.moduleApiPublic.use('/hype', createPublicRouter(ctx));
    ctx.moduleApiAuth.use('/hype', createAdminRouter(ctx, engine));

    engine.start(ctx);
    streamChat.start(ctx);

    // If the platform has never been launched (or someone reset preLaunch),
    // ensure the idle teaser exists in the persisted alert store before
    // screens connect. Screens receive it via the normal WS init snapshot;
    // broadcasting again during boot can double-play the teaser on reconnect.
    if (state.getSettings().preLaunch) {
      engine.ensurePreLaunchAlert();
    }

    console.log(`[hype] module ready — ${state.getChannels().length} channels loaded`);
  },
};
