// Admin-side module registry. Mirrors the screen registry but for admin
// extension points: tabs and WebSocket message handlers.

const _tabs       = [];                // [{ id, label, mount(container) }]
const _wsHandlers = new Map();         // prefix -> (msg) => void

export function registerAdminTab(tab) {
  if (!tab || typeof tab !== 'object') return;
  if (!tab.id || typeof tab.mount !== 'function') return;
  _tabs.push({
    id: String(tab.id),
    label: String(tab.label || tab.id),
    icon: tab.icon || null,
    mount: tab.mount,
  });
}

export function getRegisteredAdminTabs() {
  return [..._tabs];
}

export function registerAdminWsHandler(prefix, fn) {
  if (typeof prefix !== 'string' || typeof fn !== 'function') return;
  _wsHandlers.set(prefix, fn);
}

export function dispatchAdminWsMessage(msg) {
  if (!msg || typeof msg.type !== 'string') return false;
  const idx = msg.type.indexOf(':');
  if (idx <= 0) return false;
  const prefix = msg.type.slice(0, idx);
  const handler = _wsHandlers.get(prefix);
  if (!handler) return false;
  try { handler(msg); } catch (err) {
    console.warn('[modules] admin ws handler threw:', prefix, err && err.message);
  }
  return true;
}
