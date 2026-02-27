/**
 * Theme loader for the screen player.
 *
 * A theme is a folder under /themes/<id>/ that contains:
 *   theme.json   — manifest (name, cssFile, frameFile, fontFaces)
 *   style.css    — CSS custom property overrides applied to <html>
 *   frame.html   — optional HTML fragment injected as a fixed overlay
 *   assets/      — images, fonts, etc.
 *
 * CSS variables defined in style.css are applied on the <html> element so
 * they cascade to every layout, slide, and overlay.  All var() calls in the
 * layout/slide JS files use fallback values that match the original hardcoded
 * defaults, so removing a theme reverts appearance exactly.
 */

const LINK_ID  = 'theme-stylesheet';
const FRAME_ID = 'theme-frame';
const FONTS_ID = 'theme-fonts';

let _activeThemeId = null;

/**
 * Apply a theme by id.  Pass null / empty string to remove the current theme.
 *
 * @param {string|null} themeId
 */
export async function applyTheme(themeId) {
  // Normalise
  const id = themeId || null;

  if (id === _activeThemeId) return;   // nothing changed
  _activeThemeId = id;

  // Always remove any previously applied theme elements first
  _removeTheme();

  if (!id) return;   // "no theme" — done

  let manifest;
  try {
    const res = await fetch(`/themes/${id}/theme.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    console.warn(`[theme] Failed to load manifest for "${id}":`, err.message);
    return;
  }

  // 1. Inject @font-face declarations
  if (Array.isArray(manifest.fontFaces) && manifest.fontFaces.length) {
    _injectFonts(id, manifest.fontFaces);
  }

  // 2. Inject the theme stylesheet as a <link> and wait for it to load
  if (manifest.cssFile) {
    await new Promise((resolve) => {
      const link = document.createElement('link');
      link.id   = LINK_ID;
      link.rel  = 'stylesheet';
      link.href = `/themes/${id}/${manifest.cssFile}`;
      link.onload  = resolve;
      link.onerror = resolve; // don't block on a missing file
      document.head.appendChild(link);
    });
  }

  // 3. Inject the decorative screen frame (pointer-events:none overlay)
  if (manifest.frameFile) {
    try {
      const res = await fetch(`/themes/${id}/${manifest.frameFile}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      _injectFrame(html);
    } catch (err) {
      console.warn(`[theme] Failed to load frame for "${id}":`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _removeTheme() {
  document.getElementById(LINK_ID)?.remove();
  document.getElementById(FRAME_ID)?.remove();
  document.getElementById(FONTS_ID)?.remove();
}

function _injectFonts(themeId, fontFaces) {
  const rules = fontFaces.map(f => {
    const src = f.src.startsWith('http') ? f.src : `/themes/${themeId}/${f.src}`;
    const fmt = src.endsWith('.woff2') ? 'woff2'
              : src.endsWith('.woff')  ? 'woff'
              : src.endsWith('.ttf')   ? 'truetype'
              : 'opentype';
    return `@font-face { font-family: '${f.family}'; src: url('${src}') format('${fmt}'); font-display: swap; }`;
  }).join('\n');

  const style = document.createElement('style');
  style.id          = FONTS_ID;
  style.textContent = rules;
  document.head.appendChild(style);
}

function _injectFrame(html) {
  // Parse the HTML string into real DOM nodes via a template element
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();

  const wrapper = document.createElement('div');
  wrapper.id = FRAME_ID;
  // Ensure the frame never captures pointer events so the screen player
  // interaction model (non-existent for kiosk) is not affected, and overlays
  // such as ticker/bug still work correctly.
  wrapper.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:100;';
  wrapper.appendChild(tpl.content.cloneNode(true));

  document.body.appendChild(wrapper);
}
