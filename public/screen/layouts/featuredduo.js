// Featured-duo layout: large hero (2/3 width) beside a supporting photo (1/3)
// Similar to side-by-side but unequal — the hero gets much more real estate,
// the supporting photo still breathes on its own rather than being buried in a grid.

import { applySmartFit } from '../fit.js';
import { startKenBurns } from '../transitions.js';

/**
 * @param {Object[]} photos - Expects at least 2 photos; [0] = hero, [1] = support
 * @returns {{ el, visibleIds, startMotion }}
 */
export function buildFeaturedDuo(photos) {
  const el = document.createElement('div');
  el.className = 'layout layout-featuredduo';
  // 2/3 + 1/3 split with a small gap
  el.style.cssText = 'position:absolute;inset:0;' +
    'padding-top:var(--screen-padding-top,var(--screen-padding,0px));' +
    'padding-right:var(--screen-padding-right,var(--screen-padding,0px));' +
    'padding-bottom:var(--screen-padding-bottom,var(--screen-padding,0px));' +
    'padding-left:var(--screen-padding-left,var(--screen-padding,0px));' +
    'display:grid;grid-template-columns:2fr 1fr;gap:var(--tile-gap,2px);background:var(--screen-bg,#111);';

  const visibleIds = [];
  const imgs       = [];

  const defs = [
    { portrait: false },  // hero slot — landscape-biased, large
    { portrait: true  },  // support slot — portrait-biased, tall narrow
  ];

  for (let i = 0; i < 2; i++) {
    const photo   = photos[i];
    const def     = defs[i];
    const slot    = document.createElement('div');
    slot.style.cssText = 'overflow:hidden;position:relative;border-radius:var(--tile-radius,0px);box-shadow:var(--tile-shadow,none);border:var(--tile-border,none);';

    if (photo) {
      const img = document.createElement('img');
      img.src   = photo.displayUrl || photo.url;
      img.alt   = photo.name;
      img.style.cssText = 'width:100%;height:100%;display:block;object-fit:cover;';
      applySmartFit(img, photo, def.portrait);
      slot.appendChild(img);
      slot.dataset.photoId = photo.id;
      slot.dataset.isHero  = i === 0 ? '1' : '0';
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
    startMotion: (durationMs) => {
      for (const img of imgs) startKenBurns(img, durationMs);
    },
  };
}
