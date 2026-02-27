'use strict';

const fs   = require('fs');
const path = require('path');

const THEMES_DIR = path.join(__dirname, '..', '..', '..', 'themes');

/**
 * Scan the themes/ directory and return an array of theme manifests.
 * Each entry is the parsed theme.json augmented with an `id` property
 * (the folder name).  Folders without a theme.json are silently skipped.
 *
 * @returns {Array<{id:string, name:string, description:string}>}
 */
function listThemes() {
  if (!fs.existsSync(THEMES_DIR)) return [];

  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(THEMES_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(THEMES_DIR, entry.name, 'theme.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      results.push({
        id:          entry.name,
        name:        manifest.name        || entry.name,
        description: manifest.description || '',
      });
    } catch {
      // Malformed theme.json — skip silently
    }
  }

  return results;
}

/**
 * Returns a Set of valid theme folder names.
 * Used by sanitizeGlobalConfig to validate the incoming theme value.
 * Returns null if the themes directory does not exist (accept any value).
 *
 * @returns {Set<string>|null}
 */
function getValidThemeIds() {
  if (!fs.existsSync(THEMES_DIR)) return null;
  const themes = listThemes();
  return themes.length ? new Set(themes.map(t => t.id)) : new Set();
}

module.exports = { listThemes, getValidThemeIds, THEMES_DIR };
