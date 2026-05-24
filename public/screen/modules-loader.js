// Dynamically import each enabled module's screen entry point. Each module is
// expected to expose `/modules/<name>/screen/index.js` which registers itself
// via the APIs in module-registry.js.
//
// The list is provided by the server via window.PIXELPLEIN_MODULES (injected
// into screen.html). An empty list (default) is a no-op.

const list = Array.isArray(window.PIXELPLEIN_MODULES) ? window.PIXELPLEIN_MODULES : [];

export const moduleReady = (async () => {
  if (!list.length) return [];
  const loaded = [];
  for (const name of list) {
    if (!/^[a-z0-9_-]+$/i.test(name)) continue;
    try {
      const mod = await import(`/modules/${name}/screen/index.js`);
      if (typeof mod.register === 'function') {
        await mod.register();
      }
      loaded.push(name);
    } catch (err) {
      console.warn(`[modules] screen module "${name}" failed to load:`, err && err.message);
    }
  }
  return loaded;
})();
