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

    console.log(`[hype] module ready — ${state.getChannels().length} channels loaded`);
  },
};
