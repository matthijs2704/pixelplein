'use strict';

// Hype module entry point. Wired into the loader at boot when 'hype' is in
// config.enabledModules. Idempotent.

const hypeDb = require('./db');
const state  = require('./state');
const engine = require('./engine');
const { createPublicRouter, createAdminRouter } = require('./routes');

module.exports = {
  name: 'hype',

  async migrate(db) {
    await hypeDb.migrate(db);
  },

  async register(ctx) {
    await state.load(ctx.db);

    ctx.moduleApiPublic.use('/hype', createPublicRouter(ctx));
    ctx.moduleApiAuth.use('/hype', createAdminRouter(ctx, engine));

    engine.start(ctx);

    // If the platform has never been launched (or someone reset preLaunch),
    // arm the idle teaser so screens connecting from now on see it. Done on
    // a tiny delay so any clients still finishing their initial render get
    // the alert via the regular broadcast path.
    if (state.getSettings().preLaunch) {
      setTimeout(() => engine.firePreLaunch(), 500);
    }

    console.log(`[hype] module ready — ${state.getChannels().length} channels loaded`);
  },
};
