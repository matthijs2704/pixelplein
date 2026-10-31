// Dynamically import each enabled module's admin entry point at
// /modules/<name>/admin/index.js. Each module's register() may call
// registerAdminTab() and registerAdminWsHandler().

function _sanitizeList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(
    list
      .map(name => String(name || '').trim())
      .filter(name => /^[a-z0-9_-]+$/i.test(name)),
  )];
}

async function _loadModuleList() {
  const injected = _sanitizeList(window.PIXELPLEIN_MODULES);
  if (injected.length) return injected;

  try {
    const res = await fetch('/api/modules/enabled', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return injected;
    const data = await res.json();
    return _sanitizeList(data?.modules);
  } catch (err) {
    console.warn('[modules] failed to fetch enabled modules:', err && err.message);
    return injected;
  }
}

export const adminModuleReady = (async () => {
  const list = await _loadModuleList();
  if (!list.length) return [];
  const loaded = [];
  for (const name of list) {
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
