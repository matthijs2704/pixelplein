/**
 * Slide renderer: text-card
 *
 * Four visual presets. All colour/font values are expressed as CSS custom
 * property references with hardcoded fallbacks so themes can override them
 * without touching this file.
 *
 * Presets:
 *   dark-center   — dark background, centred, accent top bar
 *   light-left    — light background, left-aligned, vertical accent bar
 *   gradient      — deep gradient background, centred, no accent bar
 *   minimal       — near-black, left-aligned, subtle accent dot
 */

const PRESETS = {
  'dark-center': {
    bg:         'var(--textcard-bg, #09090f)',
    color:      'var(--textcard-color, #f0f0f8)',
    align:      'center',
    justify:    'center',
    accent:     'var(--textcard-accent, #6c63ff)',
    accentBar:  'top',          // 'top' | 'left' | 'none'
    pad:        '8vw 10vw',
  },
  'light-left': {
    bg:         'var(--textcard-bg, #f7f6f2)',
    color:      'var(--textcard-color, #111117)',
    align:      'left',
    justify:    'center',
    accent:     'var(--textcard-accent, #4f46e5)',
    accentBar:  'left',
    pad:        '8vw 9vw 8vw 11vw',
  },
  gradient: {
    bg:         'var(--textcard-bg, linear-gradient(145deg,#0f0c29 0%,#1a1a4e 50%,#0d2b55 100%))',
    color:      'var(--textcard-color, #fff)',
    align:      'center',
    justify:    'center',
    accent:     'var(--textcard-accent, #a78bfa)',
    accentBar:  'top',
    pad:        '8vw 10vw',
  },
  minimal: {
    bg:         'var(--textcard-bg, #141418)',
    color:      'var(--textcard-color, #d8d8e8)',
    align:      'left',
    justify:    'flex-end',     // text anchored toward bottom-left
    accent:     'var(--textcard-accent, #4ade80)',
    accentBar:  'none',
    pad:        '6vw 8vw',
  },
};

/**
 * @param {object} slide
 * @returns {{ el: HTMLElement, play: () => Promise<void> }}
 */
export function buildTextCardSlide(slide) {
  const preset = PRESETS[slide.template] || PRESETS['dark-center'];
  const bgVal  = slide.bgColor || preset.bg;

  // ── Root wrapper ──────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:absolute;inset:0;',
    `background:${bgVal};`,
    'display:flex;',
    `align-items:${preset.justify};`,
    `justify-content:${preset.align === 'center' ? 'center' : 'flex-start'};`,
    `padding:${preset.pad};`,
    'overflow:hidden;',
  ].join('');

  // ── Accent bar (top or left) ───────────────────────────────────────────────
  if (preset.accentBar === 'top') {
    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:absolute;top:0;left:0;right:0;',
      'height:0.5vh;min-height:3px;',
      `background:${preset.accent};`,
      'opacity:0.9;',
    ].join('');
    wrap.appendChild(bar);
  }

  if (preset.accentBar === 'left') {
    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:absolute;top:0;bottom:0;left:0;',
      'width:0.55vw;min-width:4px;',
      `background:${preset.accent};`,
    ].join('');
    wrap.appendChild(bar);
  }

  // ── Content block ─────────────────────────────────────────────────────────
  const inner = document.createElement('div');
  inner.style.cssText = [
    'position:relative;',
    'max-width:75%;',
    `text-align:${preset.align};`,
    `color:${preset.color};`,
    `font-family:var(--textcard-font, 'Segoe UI', system-ui, sans-serif);`,
  ].join('');

  // Minimal preset: small accent dot above title
  if (preset.accentBar === 'none' && slide.title) {
    const dot = document.createElement('div');
    dot.style.cssText = [
      `width:0.6vw;height:0.6vw;min-width:6px;min-height:6px;`,
      'border-radius:50%;',
      `background:${preset.accent};`,
      'margin-bottom:1.6vh;',
    ].join('');
    inner.appendChild(dot);
  }

  // Title
  if (slide.title) {
    const h = document.createElement('div');
    h.style.cssText = [
      'font-size:var(--textcard-title-size, clamp(22px,3.4vw,62px));',
      'font-weight:800;',
      'line-height:1.1;',
      'letter-spacing:-0.02em;',
      'margin-bottom:0.6em;',
    ].join('');
    h.textContent = slide.title;
    inner.appendChild(h);
  }

  // Divider between title and body
  if (slide.title && slide.body) {
    const rule = document.createElement('div');
    rule.style.cssText = [
      preset.align === 'center' ? 'width:3.5vw;margin:0 auto 1em;' : 'width:3.5vw;margin:0 0 1em;',
      'height:2px;min-width:32px;',
      `background:${preset.accent};`,
      'opacity:0.7;',
      'border-radius:2px;',
    ].join('');
    inner.appendChild(rule);
  }

  // Body
  if (slide.body) {
    const p = document.createElement('div');
    p.style.cssText = [
      'font-size:var(--textcard-body-size, clamp(13px,1.65vw,30px));',
      'font-weight:400;',
      'line-height:1.65;',
      'opacity:0.82;',
      'white-space:pre-wrap;',
    ].join('');
    p.textContent = slide.body;
    inner.appendChild(p);
  }

  wrap.appendChild(inner);

  const durationMs = (slide.durationSec || 10) * 1000;

  return {
    el:   wrap,
    play: () => new Promise(resolve => setTimeout(resolve, durationMs)),
  };
}
