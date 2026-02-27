// Slide renderer: image
// Shows a static image fullscreen with configurable fit mode and optional
// Ken Burns motion. Duration is controlled by durationSec.

/**
 * @param {object} slide
 *   slide.filename  - filename inside slide-assets/images/
 *   slide.fit       - 'contain' | 'cover' | 'kenburns'  (default: 'contain')
 *   slide.durationSec - how long to show (default: 10)
 * @returns {{ el: HTMLElement, play: () => Promise<void> }}
 */
export function buildImageSlide(slide) {
  const fit         = slide.fit || 'contain';
  const durationMs  = (slide.durationSec || 10) * 1000;
  const src         = `/slide-assets/images/${encodeURIComponent(slide.filename || '')}`;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;background:#000;overflow:hidden;';

  const img = document.createElement('img');
  img.src = src;
  img.alt = slide.label || '';

  if (fit === 'kenburns') {
    // Cover the screen, Ken Burns applied via CSS animation
    img.style.cssText = [
      'position:absolute;',
      'width:110%;height:110%;',   // slightly oversized so motion doesn't expose edges
      'top:-5%;left:-5%;',
      'object-fit:cover;',
      'transform-origin:center center;',
      'animation:kb-slide var(--kb-dur) ease-in-out forwards;',
    ].join('');
    img.style.setProperty('--kb-dur', `${durationMs}ms`);

    // Inject keyframes once
    if (!document.getElementById('kb-slide-style')) {
      const style = document.createElement('style');
      style.id = 'kb-slide-style';
      // Random direction per keyframe definition would require JS — instead we
      // define a fixed slow pan that looks good on any image.
      style.textContent = `
        @keyframes kb-slide {
          0%   { transform: scale(1.0) translate(0%,    0%); }
          100% { transform: scale(1.08) translate(2%,   2%); }
        }
      `;
      document.head.appendChild(style);
    }
  } else {
    // contain or cover
    img.style.cssText = [
      'position:absolute;inset:0;',
      'width:100%;height:100%;',
      `object-fit:${fit === 'cover' ? 'cover' : 'contain'};`,
    ].join('');
  }

  wrap.appendChild(img);

  function play() {
    return new Promise(resolve => {
      // If the image fails to load, still advance after duration
      img.addEventListener('error', () => setTimeout(resolve, 1000), { once: true });
      setTimeout(resolve, durationMs);
    });
  }

  return { el: wrap, play };
}
