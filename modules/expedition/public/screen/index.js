// Expedition module — screen entry point.
// Registers: 1 layout + WS handler.

import { registerLayout, registerWsHandler, emitScreenEvent } from '/screen/module-registry.js';
import { layout as zoneLoopLayout, refreshLive } from './expedition-layout.js';
import { hydrate, handleWsMessage }              from './state-client.js';

function _loadStyle() {
  if (document.getElementById('expedition-style')) return;
  const link = document.createElement('link');
  link.id   = 'expedition-style';
  link.rel  = 'stylesheet';
  link.href = '/modules/expedition/screen/style.css?v=motion-12';
  document.head.appendChild(link);
}

export async function register() {
  _loadStyle();
  await hydrate();
  registerLayout(zoneLoopLayout);
  registerWsHandler('expedition', (msg) => {
    handleWsMessage(msg);
    if (msg.type === 'expedition:state') {
      refreshLive();
      emitScreenEvent('layout:request-cycle', { source: 'expedition' });
    }
  });
}
