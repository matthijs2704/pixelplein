// Side-by-side layout: two photos share the screen equally

import { applySmartFit }  from '../fit.js';
import { startKenBurns }  from '../transitions.js';

/**
 * Build a side-by-side layout element.
 *
 * @param {Object[]} photos - Expects exactly 2 photos
 * @returns {{ el: HTMLElement, visibleIds: string[], startMotion: Function }}
 */
export function buildSideBySide(photos) {
  const el = document.createElement('div');
  el.className = 'layout layout-sidebyside';
  el.style.cssText = 'position:absolute;inset:0;' +
    'padding-top:var(--screen-padding-top,var(--screen-padding,0px));' +
    'padding-right:var(--screen-padding-right,var(--screen-padding,0px));' +
    'padding-bottom:var(--screen-padding-bottom,var(--screen-padding,0px));' +
    'padding-left:var(--screen-padding-left,var(--screen-padding,0px));' +
    'display:grid;grid-template-columns:1fr 1fr;gap:var(--tile-gap,2px);background:var(--screen-bg,#111);';

  const visibleIds = [];
  const imgs       = [];

  for (let i = 0; i < 2; i++) {
    const photo = photos[i];
    const slot  = document.createElement('div');
    slot.style.cssText = 'overflow:hidden;position:relative;border-radius:var(--tile-radius,0px);box-shadow:var(--tile-shadow,none);border:var(--tile-border,none);';

    if (photo) {
      const img = document.createElement('img');
      img.src   = photo.displayUrl || photo.url;
      img.alt   = photo.name;
      img.style.cssText = 'width:100%;height:100%;display:block;object-fit:cover;';
      applySmartFit(img, photo, true); // each half-slot is portrait (≈0.89 ratio)
      slot.appendChild(img);
      slot.dataset.photoId = photo.id;
      visibleIds.push(photo.id);
      imgs.push(img);
    } else {
      slot.style.background = '#000';
    }

    el.appendChild(slot);
  }

  return {
    el,
    visibleIds,
    /** Call after layout transition completes, passing layoutDuration. */
    startMotion: (durationMs) => {
      // Apply subtle Ken Burns to each panel with slightly different presets
      // so the two panels feel independent rather than mirrored.
      for (const img of imgs) startKenBurns(img, durationMs);
    },
  };
}
