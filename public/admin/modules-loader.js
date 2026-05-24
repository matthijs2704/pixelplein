// Dynamically import each enabled module's admin entry point at
// /modules/<name>/admin/index.js. Each module's register() may call
// registerAdminTab() and registerAdminWsHandler().

const list = Array.isArray(window.PIXELPLEIN_MODULES) ? window.PIXELPLEIN_MODULES : [];

export const adminModuleReady = (async () => {
  if (!list.length) return [];
  const loaded = [];
  for (const name of list) {
    if (!/^[a-z0-9_-]+$/i.test(name)) continue;
    try {
      const mod = await import(`/modules/${name}/admin/index.js`);
      if (typeof mod.register === 'function') {
        await mod.register();
      }
      loaded.push(name);
    } catch (err) {
      console.warn(`[modules] admin module "${name}" failed to load:`, err && err.message);
    }
  }
  return loaded;
})();
