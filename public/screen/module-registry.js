// Module registry for the screen client.
//
// Optional modules (loaded by modules-loader.js based on
// window.PIXELPLEIN_MODULES) extend the base PixelPlein behaviour by
// registering slide builders, layouts, overlays, alert renderers, and
// WebSocket message handlers through the APIs in this file.
//
// Base subsystems (slides/, layouts/, overlays/, app.js) consult this
// registry as a fallback after their own hardcoded dispatch. When no
// modules are loaded all maps are empty and behaviour is unchanged.

const _slideBuilders   = new Map();   // type -> async (slide) => built
const _layouts         = new Map();   // id   -> layout descriptor { id, name, pick, build, postMount?, minPhotos? }
const _overlays        = new Map();   // id   -> { mount(cfg), remove(), applies(cfg) }
const _alertRenderers  = new Map();   // type -> (alert) => HTMLElement
const _wsHandlers      = new Map();   // prefix -> (msg) => void
const _eventBus        = new Map();   // event -> Set<listener>

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

export function registerSlideBuilder(type, builder) {
  if (typeof type !== 'string' || typeof builder !== 'function') return;
  _slideBuilders.set(type, builder);
}

export function getModuleSlideBuilder(type) {
  return _slideBuilders.get(type) || null;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

export function registerLayout(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return;
  const id = descriptor.id || descriptor.name;
  if (!id || typeof descriptor.pick !== 'function' || typeof descriptor.build !== 'function') return;
  _layouts.set(String(id), descriptor);
}

export function getModuleLayouts() {
  return new Map(_layouts);
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

export function registerOverlay(overlay) {
  if (!overlay || typeof overlay !== 'object' || !overlay.id) return;
  if (typeof overlay.mount !== 'function' || typeof overlay.remove !== 'function') return;
  _overlays.set(String(overlay.id), overlay);
}

export function applyModuleOverlays(cfg) {
  for (const ov of _overlays.values()) {
    let active = true;
    if (typeof ov.applies === 'function') {
      try { active = Boolean(ov.applies(cfg)); } catch { active = false; }
    }
    try {
      if (active) ov.mount(cfg); else ov.remove();
    } catch (err) {
      console.warn('[modules] overlay failed:', ov.id, err && err.message);
    }
  }
}

export function removeAllModuleOverlays() {
  for (const ov of _overlays.values()) {
    try { ov.remove(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Alert renderers
// ---------------------------------------------------------------------------

export function registerAlertRenderer(type, render) {
  if (typeof type !== 'string' || typeof render !== 'function') return;
  _alertRenderers.set(type, render);
}

export function getModuleAlertRenderer(type) {
  return _alertRenderers.get(type) || null;
}

// ---------------------------------------------------------------------------
// WebSocket namespace routing
//
// A message with type "hype:state_update" is routed to the handler registered
// under prefix "hype". Modules use a unique prefix matching their name.
// ---------------------------------------------------------------------------

export function registerWsHandler(prefix, fn) {
  if (typeof prefix !== 'string' || typeof fn !== 'function') return;
  _wsHandlers.set(prefix, fn);
}

export function dispatchModuleWsMessage(msg) {
  if (!msg || typeof msg.type !== 'string') return false;
  const idx = msg.type.indexOf(':');
  if (idx <= 0) return false;
  const prefix = msg.type.slice(0, idx);
  const handler = _wsHandlers.get(prefix);
  if (!handler) return false;
  try { handler(msg); } catch (err) {
    console.warn('[modules] ws handler threw:', prefix, err && err.message);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lightweight event bus
//
// Used so module overlays/slides can react to base lifecycle events
// (e.g. "layout:cycle" with current visibleIds + layoutType) without
// pulling internals from layouts/index.js.
// ---------------------------------------------------------------------------

export function onScreenEvent(event, listener) {
  if (typeof event !== 'string' || typeof listener !== 'function') return () => {};
  if (!_eventBus.has(event)) _eventBus.set(event, new Set());
  _eventBus.get(event).add(listener);
  return () => _eventBus.get(event)?.delete(listener);
}

export function emitScreenEvent(event, detail) {
  const listeners = _eventBus.get(event);
  if (!listeners || !listeners.size) return;
  for (const fn of listeners) {
    try { fn(detail); } catch (err) {
      console.warn('[modules] event listener threw:', event, err && err.message);
    }
  }
}
