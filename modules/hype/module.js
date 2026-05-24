'use strict';

// Hype module entry point. Wired into the loader at boot when 'hype' is in
// config.enabledModules. Idempotent.

const hypeDb = require('./db');
const state  = require('./state');
const engine = require('./engine');
const { createRouter } = require('./routes');

module.exports = {
  name: 'hype',

  async migrate(db) {
    await hypeDb.migrate(db);
  },

  async register(ctx) {
    await state.load(ctx.db);

    const router = createRouter(ctx, engine);
    ctx.app.use('/api/modules/hype', ctx.requireAuth, router);

    engine.start(ctx);

    console.log(`[hype] module ready — ${state.getChannels().length} channels loaded`);
  },
};
