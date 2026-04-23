// Dynamic Split layout: starts fullscreen then wipes to 50/50 side-by-side.
// The split fires at splitDelayPct % of layoutDuration — same proportional
// timing used by mosaic tile swaps.

import { applySmartFit }  from '../fit.js';
import { startKenBurns }  from '../transitions.js';
import { el, photoUrl }   from '../../shared/utils.js';

export const layout = {
  name: 'dynamicsplit',
  minPhotos: 2,

  pick(cfg, helpers) {
    const hero      = helpers.pickAndClaimHero(cfg, { orientation: 'landscape' }, true);
    const excludeIds = hero ? [hero.id] : [];
    const others    = helpers.pickPhotos(1, cfg, excludeIds, false, {
      orientation: 'any',
      allowRecentFallback: true,
    });
    return { photos: [hero, others[0] || null].filter(Boolean) };
  },

  build(picked) {
    const [photoA, photoB] = picked.photos;
    const rootEl = el('div', { cls: 'layout layout-dynamicsplit' });

    const slotA = el('div', { cls: 'ds-slot-a' });
    const slotB = el('div', { cls: 'ds-slot-b' });

    const visibleIds = [];
    let imgA = null;

    if (photoA) {
      imgA = el('img', { src: photoUrl(photoA), alt: photoA.name });
      applySmartFit(imgA, photoA, false);
      slotA.appendChild(imgA);
      slotA.dataset.photoId = photoA.id;
      visibleIds.push(photoA.id);
    }

    if (photoB) {
      const imgB = el('img', { src: photoUrl(photoB), alt: photoB.name });
      applySmartFit(imgB, photoB, false);
      slotB.appendChild(imgB);
      slotB.dataset.photoId = photoB.id;
      visibleIds.push(photoB.id);
    }

    // slotB sits behind slotA (z-index 1 vs 2) — hidden until clip-path reveals it
    rootEl.appendChild(slotB);
    rootEl.appendChild(slotA);

    return {
      el: rootEl,
      visibleIds,
      slotEls: [slotA, slotB],
      startMotion: (durationMs) => {
        if (imgA) startKenBurns(imgA, durationMs);
      },
    };
  },

  async postMount({ slotEls, cfg, signal }) {
    const [slotA, slotB] = slotEls;
    const imgB       = slotB?.querySelector('img');
    const layoutDur  = cfg.layoutDuration || 8000;
    const splitDelayMs = Math.round(layoutDur * ((cfg.splitDelayPct ?? 35) / 100));

    const ok = await _delay(splitDelayMs, signal);
    if (!ok) return null;

    slotA.classList.add('ds-split');

    if (cfg.kenBurnsEnabled !== false && imgB) {
      startKenBurns(imgB, layoutDur - splitDelayMs);
    }

    return null;
  },
};

function _delay(ms, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(false); return; }
    const timer = setTimeout(done, Math.max(0, ms));
    function done()   { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(true);  }
    function onAbort() { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(false); }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}
