'use strict';

const fs = require('fs');
const path = require('path');

const MODULES_ROOT = path.join(__dirname, '..', '..', 'modules');

const _loaded = new Map();

function _isValidName(name) {
  return typeof name === 'string' && /^[a-z0-9_-]+$/i.test(name);
}

function listLoadedModuleNames() {
  return [...new Set(_loaded.keys())];
}

function getModule(name) {
  return _loaded.get(name) || null;
}

async function loadEnabledModules(ctx) {
  const config = ctx.config || {};
  const enabled = Array.isArray(config.enabledModules) ? config.enabledModules : [];

  for (const name of enabled) {
    if (!_isValidName(name)) {
      console.warn(`[modules] Ignoring invalid module name: ${JSON.stringify(name)}`);
      continue;
    }
    if (_loaded.has(name)) continue;

    const modDir = path.join(MODULES_ROOT, name);
    const entry = path.join(modDir, 'module.js');
    if (!fs.existsSync(entry)) {
      console.warn(`[modules] Module "${name}" not found at ${entry} — skipping`);
      continue;
    }

    try {
      const mod = require(entry);
      if (!mod || typeof mod.register !== 'function') {
        console.warn(`[modules] Module "${name}" does not export register() — skipping`);
        continue;
      }
      if (typeof mod.migrate === 'function') {
        await mod.migrate(ctx.db);
      }
      await mod.register({ ...ctx, moduleName: name, moduleDir: modDir });
      _loaded.set(name, mod);
      console.log(`[modules] Loaded module: ${name}`);
    } catch (err) {
      console.error(`[modules] Failed to load module "${name}":`, err && err.stack || err);
    }
  }
}

module.exports = {
  MODULES_ROOT,
  loadEnabledModules,
  listLoadedModuleNames,
  getModule,
};
