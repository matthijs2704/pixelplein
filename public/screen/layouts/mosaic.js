// Mosaic layout: grid of slots defined by a template, with live tile swaps

import { TEMPLATE_DEFS } from '../templates.js';
import { applySmartFit }  from '../fit.js';
import { crossFadeSlot, startKenBurns }  from '../transitions.js';
import { pickPhotos, pickNewestPhotos, arrangePhotosForSlots } from '../photos.js';

/**
 * Build a mosaic layout element from a named template.
 *
 * @param {string}   templateName
 * @param {Object}   heroPhoto      - Pre-selected hero photo (may be null)
 * @param {Object[]} otherPhotos    - Pool of non-hero photos
 * @param {number}   minTilePx      - Minimum tile dimension in px (from config)
 * @returns {{ el, visibleIds, slotEls, templateName, startMotion }}
 */
export function buildMosaic(templateName, heroPhoto, otherPhotos, minTilePx, cfg) {
  const tpl = TEMPLATE_DEFS[templateName] || TEMPLATE_DEFS['hero-left-9'];

  const el = document.createElement('div');
  el.className = 'layout layout-mosaic';
  el.style.cssText = [
    'position:absolute;inset:0;',
    'padding-top:var(--screen-padding-top,var(--screen-padding,0px));',
    'padding-right:var(--screen-padding-right,var(--screen-padding,0px));',
    'padding-bottom:var(--screen-padding-bottom,var(--screen-padding,0px));',
    'padding-left:var(--screen-padding-left,var(--screen-padding,0px));',
    `display:grid;`,
    `grid-template-columns:repeat(${tpl.cols},1fr);`,
    `grid-template-rows:repeat(${tpl.rows},1fr);`,
    'gap:var(--tile-gap,2px);background:var(--screen-bg,#111);',
  ].join('');

  // Separate slots by type: hero, recent, normal
  const normalSlots = tpl.slots.filter(s => !s.hero && !s.recent);
  const recentSlots = tpl.slots.filter(s => s.recent);

  const arranged     = arrangePhotosForSlots(normalSlots, otherPhotos);
  // Fill recent slots with the newest photos (distinct from hero + normal)
  const usedIds      = [heroPhoto?.id, ...arranged.map(p => p?.id)].filter(Boolean);
  const recentPhotos = recentSlots.length
    ? pickNewestPhotos(recentSlots.length, cfg || {}, usedIds)
    : [];

  const slotEls    = [];
  const visibleIds = [];
  let normalIdx    = 0;
  let recentIdx    = 0;
  let heroImg      = null;  // kept for Ken Burns

  tpl.slots.forEach((slotDef) => {
    const slot = document.createElement('div');
    slot.style.cssText = `grid-area:${slotDef.area};overflow:hidden;position:relative;border-radius:var(--tile-radius,0px);box-shadow:var(--tile-shadow,none);border:var(--tile-border,none);`;

    let photo;
    if (slotDef.hero)   photo = heroPhoto;
    else if (slotDef.recent) photo = recentPhotos[recentIdx++];
    else                photo = arranged[normalIdx++];

    if (photo) {
      const img = document.createElement('img');
      img.src   = photo.displayUrl || photo.url;
      img.alt   = photo.name;
      img.style.cssText = 'width:100%;height:100%;display:block;object-fit:cover;';
      applySmartFit(img, photo, Boolean(slotDef.portrait));
      slot.appendChild(img);
      slot.dataset.photoId  = photo.id;
      slot.dataset.isHero   = slotDef.hero     ? '1' : '0';
      slot.dataset.isRecent = slotDef.recent   ? '1' : '0';
      slot.dataset.portrait = slotDef.portrait ? '1' : '0';
      visibleIds.push(photo.id);
      if (slotDef.hero) heroImg = img;
    } else {
      slot.style.background = '#1a1a1a';
    }

    el.appendChild(slot);
    slotEls.push(slot);
  });

  return {
    el,
    visibleIds,
    slotEls,
    templateName,
    /** Call after the layout transition completes, passing layoutDuration. */
    startMotion: (durationMs) => { if (heroImg) startKenBurns(heroImg, durationMs); },
  };
}

/**
 * Run mosaic tile swaps: cross-fade N non-hero slots to new photos.
 * Timing is anchored to cycleStart so swaps never overlap the layout transition.
 *
 * @param {HTMLElement[]} slotEls
 * @param {Object}        cfg
 * @param {number}        cycleStart   - Date.now() at the start of this layout cycle
 * @param {Function}      pickMorePhotos - (count) => Object[] fresh photos
 * @returns {Promise<string[]>} New visible IDs after swaps
 */
export async function runMosaicTransitions(slotEls, cfg, cycleStart, pickMorePhotos) {
  const rounds       = cfg.mosaicSwapRounds ?? 1;
  const swapCount    = cfg.mosaicSwapCount  ?? 2;
  const layoutDur    = cfg.layoutDuration   || 8000;
  const transitionMs = cfg.transitionTime   || 800;
  const staggerMs    = cfg.swapStaggerMs    ?? 140;

  // Tile fade duration: 70% of layout transition, capped at 700ms
  const fadeDuration = Math.min(Math.round(transitionMs * 0.70), 700);

  // Settle window: wait for layout transition to fully complete + small breathing room
  const settleMs = transitionMs + 200;

  // Space rounds evenly across the usable window (after settle, before next cycle)
  // Reserve the last 1.5 s before next cycle as quiet time so no swap is mid-fade
  // when the next layout transition fires.
  const usableWindow = layoutDur - settleMs - 1500;
  const roundInterval = rounds > 1 ? Math.floor(usableWindow / rounds) : usableWindow;

  const newIds = [];

  for (let round = 0; round < rounds; round++) {
    // When should this round fire, measured from cycleStart?
    const targetMs = settleMs + round * roundInterval;
    const elapsed  = Date.now() - cycleStart;
    const waitMs   = Math.max(0, targetMs - elapsed);

    await new Promise(r => setTimeout(r, waitMs));

    // Pick swappable slots (non-hero only, must have an image)
    const swappable = slotEls.filter(s => s.dataset.isHero !== '1' && s.querySelector('img'));
    if (!swappable.length) break;

    // Shuffle and take up to swapCount
    const targets = swappable
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(swapCount, swappable.length));

    const newPhotos = pickMorePhotos(targets.length);

    for (let i = 0; i < targets.length; i++) {
      const slot  = targets[i];
      const photo = newPhotos[i];
      if (!photo) continue;

      setTimeout(() => {
        crossFadeSlot(slot, photo, fadeDuration);
        newIds.push(photo.id);
      }, i * staggerMs);
    }

    // Wait for all fades in this round to finish before the next round
    await new Promise(r => setTimeout(r, targets.length * staggerMs + fadeDuration + 80));
  }

  return newIds;
}
