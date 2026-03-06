// Mosaic layout: grid of slots defined by a template, with live tile swaps

import { TEMPLATE_DEFS, pickTemplate } from '../templates.js';
import { applySmartFit }  from '../fit.js';
import { crossFadeSlot, startKenBurns }  from '../transitions.js';
import { pickNewestPhotos, arrangePhotosForSlots } from '../photos.js';
import { shuffle, photoUrl, photoThumbUrl, el } from '../../shared/utils.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _recentTemplates = [];

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

/** Layout descriptor for the dispatcher. */
export const layout = {
  name: 'mosaic',
  minPhotos: 4,

  pick(cfg, helpers) {
    const heroSide = cfg.preferHeroSide || 'auto';
    const tplName  = pickTemplate(cfg, _recentTemplates, heroSide);
    _recentTemplates = [..._recentTemplates.slice(-3), tplName];

    const tplDef     = TEMPLATE_DEFS[tplName];
    const tplHasHero = tplDef ? tplDef.slots.some(s => s.hero) : false;

    let heroPhoto = null;
    if (tplHasHero) {
      const heroSlot = tplDef.slots.find(s => s.hero) || null;
      const heroOptions = heroSlot?.portrait
        ? { orientation: 'portrait', enforceOrientation: false, orientationBoost: 1.25 }
        : { orientation: 'landscape' };
      heroPhoto = helpers.pickAndClaimHero(cfg, heroOptions, false);
    }

    // Count normal (non-hero, non-recent) slots by orientation so we request
    // the right number of landscape vs portrait photos upfront — avoids the
    // old approach of picking blindly then discarding mismatched orientations.
    const normalSlots     = tplDef ? tplDef.slots.filter(s => !s.hero && !s.recent) : [];
    const portraitCount   = normalSlots.filter(s => s.portrait).length;
    const landscapeCount  = normalSlots.length - portraitCount;

    const excludeIds = heroPhoto ? [heroPhoto.id] : [];

    // Pick landscape photos (soft preference — enforceOrientation=false so we
    // still get results when the pool has few landscape photos).
    const landscapePhotos = helpers.pickPhotos(
      Math.max(landscapeCount, 1), cfg, excludeIds,
      false, { orientation: 'landscape', enforceOrientation: false, orientationBoost: 1.5 },
    );

    // Pick portrait photos for portrait slots (if any)
    const pickedIds = [...excludeIds, ...landscapePhotos.map(p => p.id)];
    let portraitPhotos = [];
    if (portraitCount > 0) {
      portraitPhotos = helpers.pickPhotos(
        portraitCount, cfg, pickedIds,
        false, { orientation: 'portrait', enforceOrientation: false, orientationBoost: 1.5 },
      );
    }

    // Combine: landscape first, then portrait — arrangePhotosForSlots will
    // score each photo against each slot by aspect-ratio fit.
    const others = [...landscapePhotos, ...portraitPhotos];

    return { tplName, heroPhoto, others };
  },

  build(picked, cfg) {
    return buildMosaic(picked.tplName, picked.heroPhoto, picked.others, cfg.minTilePx || 170, cfg);
  },

  /**
   * Run tile swaps after mount.  Called by the dispatcher when slotEls are
   * present.
   *
   * @param {Object} ctx
   * @param {HTMLElement[]} ctx.slotEls
   * @param {Object}        ctx.cfg
   * @param {number}        ctx.cycleStart
   * @param {string[]}      ctx.visibleIds
   * @param {Function}      ctx.pickMorePhotos - (count, options) => Object[]
   * @returns {Promise<string[]|null>} new visible IDs (or null)
   */
  async postMount(ctx) {
    const newIds = await runMosaicTransitions(
      ctx.slotEls, ctx.cfg, ctx.cycleStart, ctx.pickMorePhotos,
    );
    return newIds;
  },
};

function _parseGridArea(area) {
  const parts = String(area || '').split('/').map(s => Number(s.trim()));
  if (parts.length !== 4 || parts.some(v => !Number.isFinite(v))) {
    return { rowSpan: 1, colSpan: 1 };
  }
  const [rowStart, colStart, rowEnd, colEnd] = parts;
  return {
    rowSpan: Math.max(1, rowEnd - rowStart),
    colSpan: Math.max(1, colEnd - colStart),
  };
}

function _shouldPreferThumb(slotDef, tpl) {
  if (slotDef.hero) return false;

  const { rowSpan, colSpan } = _parseGridArea(slotDef.area);
  const rowShare = rowSpan / (tpl.rows || 1);
  const colShare = colSpan / (tpl.cols || 1);

  // Keep large tiles on display cache to avoid softness.
  // Thumbs are used for smaller non-hero tiles where they remain sharp.
  const isLargeTile = rowShare > 0.5 || colShare > 0.5;
  return !isLargeTile;
}

function _photoUrlForSlot(photo, slotDef, tpl) {
  if (!photo) return '';
  const preferThumb = _shouldPreferThumb(slotDef, tpl);
  return preferThumb ? photoThumbUrl(photo) : photoUrl(photo);
}

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

  const rootEl = el('div', { cls: 'layout layout-mosaic' });
  rootEl.style.gridTemplateColumns = `repeat(${tpl.cols},1fr)`;
  rootEl.style.gridTemplateRows    = `repeat(${tpl.rows},1fr)`;

  // Separate slots by type: hero, recent, normal
  const normalSlots = tpl.slots.filter(s => !s.hero && !s.recent);
  const recentSlots = tpl.slots.filter(s => s.recent);

  const arranged     = arrangePhotosForSlots(normalSlots, otherPhotos);
  // Fill recent slots with the newest photos (distinct from hero + normal)
  const usedIds      = [heroPhoto?.id, ...arranged.map(p => p?.id)].filter(Boolean);
  const recentPhotos = [];
  const recentUsedIds = [...usedIds];
  for (const slot of recentSlots) {
    const picked = pickNewestPhotos(1, cfg || {}, recentUsedIds, slot.portrait
      ? {
          orientation: 'portrait',
          enforceOrientation: false,
          orientationBonusMs: 45_000,
        }
      : {
          orientation: 'landscape',
        });

    const photo = picked[0] || null;
    recentPhotos.push(photo);
    if (photo?.id) recentUsedIds.push(photo.id);
  }

  const slotEls    = [];
  const visibleIds = [];
  let normalIdx    = 0;
  let recentIdx    = 0;
  let heroImg      = null;  // kept for Ken Burns

  tpl.slots.forEach((slotDef) => {
    const slot = el('div', { cls: 'mosaic-slot', attrs: { style: `grid-area:${slotDef.area}` } });

    let photo;
    if (slotDef.hero)   photo = heroPhoto;
    else if (slotDef.recent) photo = recentPhotos[recentIdx++];
    else                photo = arranged[normalIdx++];

    if (photo) {
      const preferThumb = _shouldPreferThumb(slotDef, tpl);
      const img = el('img', { src: _photoUrlForSlot(photo, slotDef, tpl), alt: photo.name });
      applySmartFit(img, photo, Boolean(slotDef.portrait));
      slot.appendChild(img);
      slot.dataset.photoId     = photo.id;
      slot.dataset.isHero      = slotDef.hero     ? '1' : '0';
      slot.dataset.isRecent    = slotDef.recent   ? '1' : '0';
      slot.dataset.preferThumb = preferThumb      ? '1' : '0';
      slot.dataset.portrait    = slotDef.portrait ? '1' : '0';
      visibleIds.push(photo.id);
      if (slotDef.hero) heroImg = img;
    } else {
      slot.classList.add('mosaic-slot-empty');
    }

    rootEl.appendChild(slot);
    slotEls.push(slot);
  });

  return {
    el: rootEl,
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
 * @param {Function}      pickMorePhotos - (count, options) => Object[] fresh photos
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
  const reservedIds = new Set(slotEls.map(s => s.dataset.photoId).filter(Boolean));

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
    const targets = shuffle(swappable)
      .slice(0, Math.min(swapCount, swappable.length));

    for (let i = 0; i < targets.length; i++) {
      const slot  = targets[i];
      const slotIsPortrait = slot.dataset.portrait === '1';
      const excludeIds = [...reservedIds];

      const photo = pickMorePhotos(1, slotIsPortrait
        ? {
            orientation: 'portrait',
            enforceOrientation: false,
            orientationBoost: 1.2,
            excludeIds,
          }
        : {
            orientation: 'landscape',
            excludeIds,
          })[0] || null;

      if (!photo) continue;
      reservedIds.add(photo.id);

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
