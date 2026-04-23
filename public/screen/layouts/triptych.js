// Triptych layout: three equal panels that wipe in from different directions,
// then independently swap photos using the same proportional postMount timing
// as mosaic tile swaps.

import { applySmartFit }             from '../fit.js';
import { startKenBurns, crossFadeSlot } from '../transitions.js';
import { el, photoUrl, shuffle }     from '../../shared/utils.js';

export const layout = {
  name: 'triptych',
  minPhotos: 3,

  pick(cfg, helpers) {
    const photos = helpers.pickPhotos(3, cfg, [], false, {
      orientation: 'any',
      allowRecentFallback: true,
    });
    return { photos };
  },

  build(picked) {
    const rootEl  = el('div', { cls: 'layout layout-triptych' });
    const slotEls = [];
    const visibleIds = [];
    const imgs    = [];

    const entranceClasses = ['tri-from-left', 'tri-from-top', 'tri-from-right'];
    const staggerDelays   = [0, 160, 320];

    for (let i = 0; i < 3; i++) {
      const photo = picked.photos[i];
      const slot  = el('div', { cls: `tri-panel ${entranceClasses[i]}` });

      // Stagger the entrance animation via inline delay
      if (staggerDelays[i] > 0) slot.style.animationDelay = `${staggerDelays[i]}ms`;

      slot.dataset.portrait    = '0';
      slot.dataset.preferThumb = '0';

      if (photo) {
        const img = el('img', { src: photoUrl(photo), alt: photo.name });
        applySmartFit(img, photo, false);
        slot.appendChild(img);
        slot.dataset.photoId = photo.id;
        visibleIds.push(photo.id);
        imgs.push(img);
      }

      rootEl.appendChild(slot);
      slotEls.push(slot);
    }

    return {
      el: rootEl,
      visibleIds,
      slotEls,
      startMotion: (durationMs) => {
        for (const img of imgs) startKenBurns(img, durationMs);
      },
    };
  },

  async postMount({ slotEls, cfg, signal, pickMorePhotos }) {
    const layoutDur  = cfg.layoutDuration || 8000;
    const fadeDur    = Math.min(Math.round((cfg.transitionTime || 800) * 0.65), 600);
    const visibleAt  = Date.now();
    // Fire swaps at 50%, 65%, 80% of the layout window in shuffled slot order
    const swapPcts   = [0.50, 0.65, 0.80];
    const targets    = shuffle([...slotEls]);
    const reservedIds = new Set(slotEls.map(s => s.dataset.photoId).filter(Boolean));
    const newIds     = [];

    for (let i = 0; i < targets.length; i++) {
      const targetMs = Math.round(layoutDur * swapPcts[i]);
      const waitMs   = Math.max(0, targetMs - (Date.now() - visibleAt));
      const ok       = await _delay(waitMs, signal);
      if (!ok) break;

      const photo = pickMorePhotos(1, { orientation: 'any', excludeIds: [...reservedIds] })[0];
      if (!photo) continue;
      reservedIds.add(photo.id);

      crossFadeSlot(targets[i], photo, fadeDur);
      newIds.push(photo.id);
    }

    return newIds;
  },
};

function _delay(ms, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(false); return; }
    const timer = setTimeout(done, Math.max(0, ms));
    function done()    { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(true);  }
    function onAbort() { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(false); }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}
