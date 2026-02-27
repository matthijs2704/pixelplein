/**
 * Slide renderer: QR code
 *
 * Layout (top → bottom, centred):
 *   [optional title]
 *   [accent divider]
 *   [QR code image]
 *   [URL caption in monospace]
 *   [optional sub-caption]
 *
 * All colours/fonts are CSS custom property references with hardcoded
 * fallbacks so themes can override them without touching this file.
 */

/**
 * @param {object} slide
 * @returns {{ el: HTMLElement, play: () => Promise<void> }}
 */
export async function buildQrSlide(slide) {

  // ── Root ──────────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:absolute;inset:0;',
    'background:var(--qr-bg,#ffffff);',
    'display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;',
    'gap:0;',
    'overflow:hidden;',
    "font-family:var(--textcard-font,'Segoe UI',system-ui,sans-serif);",
  ].join('');

  // Subtle vignette so pure-white slides don't glare on dark screens
  const vignette = document.createElement('div');
  vignette.style.cssText = [
    'position:absolute;inset:0;pointer-events:none;',
    'background:radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.06) 100%);',
  ].join('');
  wrap.appendChild(vignette);

  // ── Inner content stack ───────────────────────────────────────────────────
  const stack = document.createElement('div');
  stack.style.cssText = [
    'position:relative;',
    'display:flex;flex-direction:column;',
    'align-items:center;',
    'gap:clamp(10px,2vh,28px);',
    'max-width:70%;',
    'text-align:center;',
  ].join('');

  // Title (optional)
  if (slide.title) {
    const title = document.createElement('div');
    title.style.cssText = [
      'font-size:clamp(18px,2.6vw,46px);',
      'font-weight:700;',
      'line-height:1.15;',
      'letter-spacing:-0.01em;',
      'color:var(--qr-color,#111);',
    ].join('');
    title.textContent = slide.title;
    stack.appendChild(title);

    // Accent divider
    const rule = document.createElement('div');
    rule.style.cssText = [
      'width:clamp(28px,2.8vw,48px);',
      'height:3px;',
      'border-radius:2px;',
      'background:var(--textcard-accent,#6c63ff);',
    ].join('');
    stack.appendChild(rule);
  }

  // ── QR image ──────────────────────────────────────────────────────────────
  let imgSrc = '';
  try {
    const res  = await fetch(`/api/slides/qr?url=${encodeURIComponent(slide.url || '')}`);
    const data = await res.json();
    imgSrc = data.url || '';
  } catch { /* leave blank */ }

  if (imgSrc) {
    // White card behind the QR so it scans correctly even on coloured backgrounds
    const qrCard = document.createElement('div');
    qrCard.style.cssText = [
      'background:#fff;',
      'border-radius:clamp(8px,1vw,16px);',
      'padding:clamp(8px,1.2vw,20px);',
      'box-shadow:0 4px 24px rgba(0,0,0,0.12),0 1px 4px rgba(0,0,0,0.08);',
      'display:flex;align-items:center;justify-content:center;',
    ].join('');

    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = 'QR Code';
    img.style.cssText = 'width:min(32vh,32vw);height:auto;display:block;';
    qrCard.appendChild(img);
    stack.appendChild(qrCard);
  }

  // URL caption
  if (slide.url) {
    const url = document.createElement('div');
    url.style.cssText = [
      'font-size:clamp(10px,1.2vw,20px);',
      'color:var(--qr-muted-color,#666);',
      'font-family:ui-monospace,SFMono-Regular,"Cascadia Code",monospace;',
      'letter-spacing:0.01em;',
      'word-break:break-all;',
      'max-width:100%;',
    ].join('');
    url.textContent = slide.url;
    stack.appendChild(url);
  }

  // Caption (below URL, smaller)
  if (slide.caption) {
    const cap = document.createElement('div');
    cap.style.cssText = [
      'font-size:clamp(12px,1.5vw,26px);',
      'font-weight:600;',
      'color:var(--qr-color,#111);',
      'margin-top:clamp(2px,0.4vh,8px);',
    ].join('');
    cap.textContent = slide.caption;
    stack.appendChild(cap);
  }

  wrap.appendChild(stack);

  const durationMs = (slide.durationSec || 10) * 1000;

  return {
    el:   wrap,
    play: () => new Promise(resolve => setTimeout(resolve, durationMs)),
  };
}
