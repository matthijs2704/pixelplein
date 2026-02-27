/**
 * Slide renderer: article
 *
 * Combines a headline, body text and an image in one of three layouts:
 *
 *   image-left   — photo fills left half; text block sits on the right
 *   image-top    — photo fills the top ~45 % of the screen; text below
 *   image-bg     — photo fills the whole screen with a dark scrim; text overlaid
 *
 * imageSource:
 *   'upload'  — slide.imageFilename, served from /slide-assets/images/
 *   'pool'    — no imageFilename; the renderer requests a random ready photo
 *               from the server and uses its cached display URL
 *
 * All colours/fonts honour CSS custom property overrides (theme system).
 */

// ---------------------------------------------------------------------------
// Layout builders
// ---------------------------------------------------------------------------

/**
 * image-left: two columns via CSS grid.
 * Left = photo (object-fit cover), right = text.
 */
function _buildImageLeft(imgEl, textEl) {
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:absolute;inset:0;',
    'display:grid;grid-template-columns:1fr 1fr;',
    'background:var(--textcard-bg,#09090f);',
  ].join('');

  const imgWrap = document.createElement('div');
  imgWrap.style.cssText = 'overflow:hidden;position:relative;';
  imgWrap.appendChild(imgEl);

  const textWrap = document.createElement('div');
  textWrap.style.cssText = [
    'display:flex;flex-direction:column;justify-content:center;',
    'padding:6vw 7vw 6vw 6vw;',
    'overflow:hidden;',
  ].join('');
  textWrap.appendChild(textEl);

  wrap.appendChild(imgWrap);
  wrap.appendChild(textWrap);
  return wrap;
}

/**
 * image-top: photo fills top 45 %, text sits in the bottom 55 %.
 */
function _buildImageTop(imgEl, textEl) {
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:absolute;inset:0;',
    'display:grid;grid-template-rows:45fr 55fr;',
    'background:var(--textcard-bg,#09090f);',
  ].join('');

  const imgWrap = document.createElement('div');
  imgWrap.style.cssText = 'overflow:hidden;position:relative;';
  imgWrap.appendChild(imgEl);

  // Thin accent stripe between image and text
  const stripe = document.createElement('div');
  stripe.style.cssText = [
    'position:absolute;left:0;right:0;',
    'height:4px;',
    'background:var(--textcard-accent,#6c63ff);',
    'z-index:2;',
  ].join('');
  imgWrap.appendChild(stripe);
  stripe.style.bottom = '0';

  const textWrap = document.createElement('div');
  textWrap.style.cssText = [
    'display:flex;flex-direction:column;justify-content:center;',
    'padding:4vh 8vw;',
    'overflow:hidden;',
  ].join('');
  textWrap.appendChild(textEl);

  wrap.appendChild(imgWrap);
  wrap.appendChild(textWrap);
  return wrap;
}

/**
 * image-bg: photo is full-bleed background; dark gradient scrim + text on top.
 */
function _buildImageBg(imgEl, textEl) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;';

  imgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
  wrap.appendChild(imgEl);

  // Dark gradient scrim — bottom-heavy so text is legible
  const scrim = document.createElement('div');
  scrim.style.cssText = [
    'position:absolute;inset:0;',
    'background:linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.15) 100%);',
  ].join('');
  wrap.appendChild(scrim);

  const textWrap = document.createElement('div');
  textWrap.style.cssText = [
    'position:absolute;bottom:0;left:0;right:0;',
    'display:flex;flex-direction:column;justify-content:flex-end;',
    'padding:6vh 8vw;',
  ].join('');
  textWrap.appendChild(textEl);
  wrap.appendChild(textWrap);

  return wrap;
}

// ---------------------------------------------------------------------------
// Text block (shared by all layouts)
// ---------------------------------------------------------------------------

function _buildTextBlock(slide, forBg = false) {
  const color = forBg ? '#fff' : `var(--textcard-color,#f0f0f8)`;
  const block = document.createElement('div');
  block.style.cssText = [
    `color:${color};`,
    `font-family:var(--textcard-font,'Segoe UI',system-ui,sans-serif);`,
  ].join('');

  if (slide.title) {
    const h = document.createElement('div');
    h.style.cssText = [
      'font-size:var(--textcard-title-size,clamp(20px,3vw,54px));',
      'font-weight:800;',
      'line-height:1.1;',
      'letter-spacing:-0.02em;',
      'margin-bottom:0.5em;',
    ].join('');
    h.textContent = slide.title;
    block.appendChild(h);

    if (slide.body) {
      const rule = document.createElement('div');
      rule.style.cssText = [
        'width:clamp(28px,2.5vw,44px);height:3px;border-radius:2px;',
        'background:var(--textcard-accent,#6c63ff);',
        'margin-bottom:0.7em;opacity:0.85;',
      ].join('');
      block.appendChild(rule);
    }
  }

  if (slide.body) {
    const p = document.createElement('div');
    p.style.cssText = [
      'font-size:var(--textcard-body-size,clamp(12px,1.55vw,28px));',
      'font-weight:400;',
      'line-height:1.65;',
      'opacity:0.85;',
      'white-space:pre-wrap;',
    ].join('');
    p.textContent = slide.body;
    block.appendChild(p);
  }

  return block;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {object} slide
 * @returns {Promise<{ el: HTMLElement, play: () => Promise<void> }>}
 */
export async function buildArticleSlide(slide) {
  const layout = slide.layout || 'image-left';
  const forBg  = layout === 'image-bg';

  // ── Image element ─────────────────────────────────────────────────────────
  const img = document.createElement('img');
  img.alt   = slide.title || '';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';

  if (slide.imageSource === 'pool' || !slide.imageFilename) {
    // Pick a random ready photo from the server's photo list
    try {
      const res   = await fetch('/api/photos?status=ready&limit=1&random=1');
      const data  = await res.json();
      const photo = Array.isArray(data) ? data[0] : (data.photos?.[0]);
      if (photo?.displayUrl || photo?.url) {
        img.src = photo.displayUrl || photo.url;
      }
    } catch { /* img stays blank — graceful degradation */ }
  } else {
    img.src = `/slide-assets/images/${encodeURIComponent(slide.imageFilename)}`;
  }

  // ── Text block ────────────────────────────────────────────────────────────
  const textBlock = _buildTextBlock(slide, forBg);

  // ── Assemble layout ───────────────────────────────────────────────────────
  let el;
  if (layout === 'image-top')  el = _buildImageTop(img, textBlock);
  else if (layout === 'image-bg') el = _buildImageBg(img, textBlock);
  else                          el = _buildImageLeft(img, textBlock);  // default

  const durationMs = (slide.durationSec || 12) * 1000;

  return {
    el,
    play: () => new Promise(resolve => setTimeout(resolve, durationMs)),
  };
}
