// Filmstrip layout: horizontal strip of photos with a stop-and-go pan.
// Each photo is centered on screen for its dwell window, then the strip eases
// to the next photo.  Photo count and dwell time are both derived from
// layoutDuration so the strip fills the cycle exactly.

import { applySmartFit }  from '../fit.js';
import { el, photoUrl }   from '../../shared/utils.js';

export const layout = {
  name: 'filmstrip',
  minPhotos: 4,

  pick(cfg, helpers) {
    const layoutDur = cfg.layoutDuration || 8000;
    // Each photo needs ~panMs + dwellMs ≈ 2500ms; clamp between 4 and 8 photos.
    const count  = Math.max(4, Math.min(8, Math.floor(layoutDur / 2500)));
    const photos = helpers.pickPhotos(count, cfg, [], false, {
      orientation: 'any',
      allowRecentFallback: true,
    });
    return { photos };
  },

  build(picked) {
    const rootEl  = el('div', { cls: 'layout layout-filmstrip' });
    const track   = el('div', { cls: 'fs-track' });
    const visibleIds = [];
    // slotEls[0] = track (for pan animation), rest = photo slots
    const slotEls = [track];

    for (const photo of picked.photos) {
      const slot = el('div', { cls: 'fs-photo' });
      if (photo) {
        const img = el('img', { src: photoUrl(photo), alt: photo.name });
        applySmartFit(img, photo, false);
        slot.appendChild(img);
        visibleIds.push(photo.id);
      }
      track.appendChild(slot);
      slotEls.push(slot);
    }

    rootEl.appendChild(track);

    return {
      el: rootEl,
      visibleIds,
      slotEls,
      // No startMotion — the pan is the motion
    };
  },

  async postMount({ slotEls, cfg, signal }) {
    const [track, ...photoSlots] = slotEls;
    const outer = track.parentElement;
    if (!outer || !photoSlots.length) return null;

    const outerH  = outer.offsetHeight;
    const outerW  = outer.offsetWidth;
    // Each photo: 90% of strip height, 16:9, slightly narrower than full-landscape
    // so adjacent photos are partially visible (filmstrip feel).
    const photoW  = Math.round(outerH * 0.9 * (16 / 9) * 0.82);
    const gap     = 4;

    photoSlots.forEach(s => { s.style.width = photoW + 'px'; });

    const trackW   = photoSlots.length * photoW + (photoSlots.length - 1) * gap;
    const n        = photoSlots.length;
    const panMs    = 680;
    const dwellMs  = Math.max(500, Math.floor((cfg.layoutDuration || 8000 - panMs * (n - 1)) / n));

    for (let i = 0; i < n; i++) {
      if (signal.aborted) break;

      // Center this photo on screen, clamped to strip bounds
      const photoCenter = i * (photoW + gap) + photoW / 2;
      const x = Math.max(0, Math.min(trackW - outerW, photoCenter - outerW / 2));

      if (i > 0) {
        const ok = await _panTo(track, x, panMs, signal);
        if (!ok) break;
      }

      if (signal.aborted) break;

      const ok = await _delay(dwellMs, signal);
      if (!ok) break;
    }

    return null;
  },
};

function _panTo(track, x, durationMs, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(false); return; }

    const anim = track.animate(
      [{ transform: `translateX(-${x}px)` }],
      { duration: durationMs, easing: 'ease-in-out', fill: 'forwards' },
    );

    function onAbort() { anim.cancel(); signal?.removeEventListener('abort', onAbort); resolve(false); }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    anim.onfinish = () => { signal?.removeEventListener('abort', onAbort); resolve(true);  };
    anim.oncancel = () => { signal?.removeEventListener('abort', onAbort); resolve(false); };
  });
}

function _delay(ms, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(false); return; }
    const timer = setTimeout(done, Math.max(0, ms));
    function done()    { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(true);  }
    function onAbort() { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(false); }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}
