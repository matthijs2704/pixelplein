// Cascade layout: asymmetric grid (tall left zone + two right zones) with a
// staggered zone reveal and independent per-zone swap timers.

import { applySmartFit }             from '../fit.js';
import { startKenBurns, crossFadeSlot } from '../transitions.js';
import { el, photoUrl }              from '../../shared/utils.js';

export const layout = {
  name: 'cascade',
  minPhotos: 3,

  pick(cfg, helpers) {
    const photos = helpers.pickPhotos(3, cfg, [], false, {
      orientation: 'any',
      allowRecentFallback: true,
    });
    return { photos };
  },

  build(picked) {
    const rootEl  = el('div', { cls: 'layout layout-cascade' });
    const slotEls = [];
    const visibleIds = [];
    const imgs    = [];

    // Stagger the entrance fade-in: zone 0 appears first, 1 and 2 follow
    const staggerDelays = [0, 350, 700];

    for (let i = 0; i < 3; i++) {
      const photo = picked.photos[i];
      const zone  = el('div', { cls: i === 0 ? 'cas-zone cas-tall cas-enter' : 'cas-zone cas-enter' });

      if (staggerDelays[i] > 0) zone.style.animationDelay = `${staggerDelays[i]}ms`;

      zone.dataset.portrait    = '0';
      zone.dataset.preferThumb = '0';

      if (photo) {
        const img = el('img', { src: photoUrl(photo), alt: photo.name });
        applySmartFit(img, photo, false);
        zone.appendChild(img);
        zone.dataset.photoId = photo.id;
        visibleIds.push(photo.id);
        imgs.push(img);
      }

      rootEl.appendChild(zone);
      slotEls.push(zone);
    }

    return {
      el: rootEl,
      visibleIds,
      slotEls,
      // Ken Burns on the large left zone only
      startMotion: (durationMs) => {
        if (imgs[0]) startKenBurns(imgs[0], durationMs);
      },
    };
  },

  async postMount({ slotEls, cfg, signal, pickMorePhotos }) {
    const [zA, zB, zC] = slotEls;
    const layoutDur   = cfg.layoutDuration || 8000;
    const fadeDur     = Math.min(Math.round((cfg.transitionTime || 800) * 0.65), 600);
    const visibleAt   = Date.now();

    // Swap schedule: small zone first, then hero, then the other small zone.
    // Percentages chosen so the last swap completes well before the cycle ends.
    const swapSchedule = [
      { zone: zB, pct: 0.35 },
      { zone: zA, pct: 0.55 },
      { zone: zC, pct: 0.75 },
    ];

    const reservedIds = new Set(slotEls.map(s => s.dataset.photoId).filter(Boolean));
    const newIds      = [];

    for (const { zone, pct } of swapSchedule) {
      const targetMs = Math.round(layoutDur * pct);
      const waitMs   = Math.max(0, targetMs - (Date.now() - visibleAt));
      const ok       = await _delay(waitMs, signal);
      if (!ok) break;

      const photo = pickMorePhotos(1, { orientation: 'any', excludeIds: [...reservedIds] })[0];
      if (!photo) continue;
      reservedIds.add(photo.id);

      crossFadeSlot(zone, photo, fadeDur);
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
