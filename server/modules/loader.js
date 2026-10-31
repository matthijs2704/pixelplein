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

// Returns all screen layout IDs declared by loaded modules (id -> label).
function getModuleScreenLayouts() {
  const out = new Map();
  for (const mod of _loaded.values()) {
    if (!Array.isArray(mod.screenLayouts)) continue;
    for (const { id, label } of mod.screenLayouts) {
      if (id) out.set(String(id), String(label || id));
    }
  }
  return out;
}

// Returns all slide types declared by loaded modules (type -> { label, module }).
function getModuleSlideTypes() {
  const out = new Map();
  for (const [name, mod] of _loaded.entries()) {
    if (!Array.isArray(mod.slideTypes)) continue;
    for (const { type, label } of mod.slideTypes) {
      if (type) out.set(String(type), { label: String(label || type), module: name });
    }
  }
  return out;
}

// Lets each loaded module drop its own photo-linked data (e.g. on a full wipe).
async function clearModulePhotoData(db) {
  for (const [name, mod] of _loaded.entries()) {
    if (typeof mod.clearPhotoData !== 'function') continue;
    try { await mod.clearPhotoData(db); }
    catch (err) { console.warn(`[modules] ${name} clearPhotoData failed:`, err.message); }
  }
}

module.exports = {
  MODULES_ROOT,
  clearModulePhotoData,
  loadEnabledModules,
  listLoadedModuleNames,
  getModule,
  getModuleScreenLayouts,
  getModuleSlideTypes,
};
