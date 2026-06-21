// Fulco Festival 2026 module — screen entry point.
// Registers: 1 layout + WS handler.

import { registerLayout, registerWsHandler, emitScreenEvent } from '/screen/module-registry.js';
import { layout as zoneLoopLayout, refreshLive } from './festival-layout.js';
import { hydrate, handleWsMessage }              from './state-client.js';

function _loadStyle() {
  if (document.getElementById('fulco-festival-2026-style')) return;
  const link = document.createElement('link');
  link.id   = 'fulco-festival-2026-style';
  link.rel  = 'stylesheet';
  link.href = '/modules/fulco-festival-2026/screen/style.css?v=motion-12';
  document.head.appendChild(link);
}

export async function register() {
  _loadStyle();
  await hydrate();
  registerLayout(zoneLoopLayout);
  registerWsHandler('fulco-festival-2026', (msg) => {
    handleWsMessage(msg);
    if (msg.type === 'fulco-festival-2026:state') {
      refreshLive();
      emitScreenEvent('layout:request-cycle', { source: 'fulco-festival-2026' });
    }
  });
}
