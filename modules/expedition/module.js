'use strict';

const { createPublicRouter, createAdminRouter } = require('./routes');

module.exports = {
  name: 'expedition',

  // Declares screen layouts to the server so they appear in display settings.
  screenLayouts: [
    { id: 'expedition:zone-loop', label: 'Expeditie: Van Maarn naar de wereld' },
  ],

  async register(ctx) {
    ctx.moduleApiPublic.use('/expedition', createPublicRouter());
    ctx.moduleApiAuth.use('/expedition',   createAdminRouter(ctx.broadcast));
    console.log('[expedition] module ready');
  },
};
