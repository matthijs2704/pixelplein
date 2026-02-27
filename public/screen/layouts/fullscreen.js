// Fullscreen layout: one photo fills the entire screen

import { applySmartFit }  from '../fit.js';
import { startKenBurns }  from '../transitions.js';

/**
 * Build a fullscreen layout element.
 *
 * @param {Object} photo
 * @returns {{ el: HTMLElement, visibleIds: string[], startMotion: Function }}
 */
export function buildFullscreen(photo) {
  const el = document.createElement('div');
  el.className = 'layout layout-fullscreen';
  el.style.cssText = 'position:absolute;inset:0;background:var(--screen-bg,#000);';

  if (!photo) {
    return { el, visibleIds: [], startMotion: () => {} };
  }

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;' +
    'top:var(--screen-padding-top,var(--screen-padding,0px));' +
    'right:var(--screen-padding-right,var(--screen-padding,0px));' +
    'bottom:var(--screen-padding-bottom,var(--screen-padding,0px));' +
    'left:var(--screen-padding-left,var(--screen-padding,0px));' +
    'overflow:hidden;border-radius:var(--tile-radius,0px);';

  const img = document.createElement('img');
  img.src   = photo.displayUrl || photo.url;
  img.alt   = photo.name;
  img.style.cssText = 'width:100%;height:100%;display:block;';
  applySmartFit(img, photo, false); // fullscreen slot is always landscape
  wrap.appendChild(img);
  el.appendChild(wrap);

  return {
    el,
    visibleIds: [photo.id],
    /** Call after the layout transition completes, passing layoutDuration. */
    startMotion: (durationMs) => startKenBurns(img, durationMs),
  };
}
