'use strict';

const { createPublicRouter, createAdminRouter } = require('./routes');

module.exports = {
  name: 'fulco-festival-2026',

  // Declares screen layouts to the server so they appear in display settings.
  screenLayouts: [
    { id: 'fulco-festival-2026:zone-loop', label: 'Fulco Festival 2026: Van Maarn naar de wereld' },
  ],

  async register(ctx) {
    ctx.moduleApiPublic.use('/fulco-festival-2026', createPublicRouter());
    ctx.moduleApiAuth.use('/fulco-festival-2026',   createAdminRouter(ctx.broadcast));
    console.log('[fulco-festival-2026] module ready');
  },
};
