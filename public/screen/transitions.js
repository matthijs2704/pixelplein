// Layout transition animations: fade, slide, zoom
// All transitions share the same easing — fast attack, long smooth tail.
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

import { applySmartFit } from './fit.js';

/**
 * Transition between outgoing and incoming layout containers.
 *
 * @param {HTMLElement} outEl - The element currently on screen (may be null)
 * @param {HTMLElement} inEl  - The new element to show
 * @param {'fade'|'slide'|'zoom'} type
 * @param {number} durationMs
 * @returns {Promise<void>} Resolves when the transition completes
 */
export function runTransition(outEl, inEl, type, durationMs) {
  return new Promise(resolve => {
    const ms = durationMs || 800;

    if (!outEl) {
      // Nothing to transition out — just show inEl immediately
      inEl.style.opacity = '1';
      inEl.style.transform = '';
      resolve();
      return;
    }

    if (type === 'fade') {
      inEl.style.opacity  = '0';
      inEl.style.transition = `opacity ${ms}ms ${EASE}`;
      requestAnimationFrame(() => {
        inEl.style.opacity = '1';
        outEl.style.transition = `opacity ${ms}ms ${EASE}`;
        outEl.style.opacity = '0';
        setTimeout(() => {
          outEl.remove();
          resolve();
        }, ms);
      });
      return;
    }

    if (type === 'slide') {
      inEl.style.transform   = 'translateX(100%)';
      inEl.style.opacity     = '1';
      inEl.style.transition  = `transform ${ms}ms ${EASE}`;
      outEl.style.transition = `transform ${ms}ms ${EASE}`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inEl.style.transform  = 'translateX(0)';
          outEl.style.transform = 'translateX(-100%)';
          setTimeout(() => {
            outEl.remove();
            resolve();
          }, ms);
        });
      });
      return;
    }

    if (type === 'zoom') {
      inEl.style.opacity    = '0';
      inEl.style.transform  = 'scale(1.04)';
      inEl.style.transition = `opacity ${ms}ms ${EASE}, transform ${ms}ms ${EASE}`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inEl.style.opacity   = '1';
          inEl.style.transform = 'scale(1)';
          outEl.style.transition = `opacity ${ms}ms ${EASE}`;
          outEl.style.opacity  = '0';
          setTimeout(() => {
            outEl.remove();
            resolve();
          }, ms);
        });
      });
      return;
    }

    // Fallback
    if (outEl) outEl.remove();
    resolve();
  });
}

/**
 * Cross-fade a single img element to a new src.
 * Used for mosaic tile swaps.
 *
 * @param {HTMLElement} slot
 * @param {Object} photo
 * @param {number} durationMs
 */
export function crossFadeSlot(slot, photo, durationMs) {
  const ms  = durationMs || 600;
  const img = slot.querySelector('img');
  if (!img) return;

  const slotIsPortrait = slot.dataset.portrait === '1';

  const next = new Image();
  next.src   = photo.displayUrl || photo.url;
  next.alt   = photo.name;
  // Base styles — fit will be applied once photo dimensions are known
  next.style.cssText  = 'display:block;width:100%;height:100%;position:absolute;inset:0;';
  next.style.opacity    = '0';
  next.style.transition = `opacity ${ms}ms ${EASE}`;

  slot.style.position = 'relative';
  slot.appendChild(next);

  next.onload = () => {
    applySmartFit(next, photo, slotIsPortrait);
    requestAnimationFrame(() => {
      next.style.opacity = '1';
      img.style.transition = `opacity ${ms}ms ${EASE}`;
      img.style.opacity  = '0';
      setTimeout(() => {
        img.remove();
        next.style.position = '';
        next.style.inset    = '';
      }, ms);
    });
  };

  // Dataset update for heartbeat tracking
  slot.dataset.photoId = photo.id;
}

/**
 * Ken Burns effect: slow pan + zoom on a fullscreen or hero image.
 *
 * Uses only scale + transform-origin to avoid percentage-of-element translate
 * math, which caused visible jumps when the translate percentages were applied
 * after scaling. Each preset defines a start and end [scale, originX%, originY%]
 * — the browser handles the smooth interpolation between anchor points.
 *
 * The animation is deferred one rAF so the image's initial state is fully
 * painted before the CSS transition begins, preventing the snap-to-start jump.
 *
 * @param {HTMLImageElement} img
 * @param {number} durationMs - should equal layoutDuration
 */
export function startKenBurns(img, durationMs) {
  const dur = Math.max(durationMs || 8000, 4000);

  // Each preset: [fromScale, fromOriginX%, fromOriginY%] → [toScale, toOriginX%, toOriginY%]
  // Scale range 1.00–1.06 — subtle enough to feel cinematic without being distracting.
  // Origins drift only 10–15 percentage points so the motion is gentle.
  const presets = [
    [[1.05, 50, 50],  [1.00, 55, 45]],  // zoom out, drift top-right
    [[1.00, 45, 55],  [1.05, 50, 50]],  // zoom in from bottom-left
    [[1.04, 55, 50],  [1.00, 45, 50]],  // zoom out, pan left
    [[1.00, 50, 45],  [1.04, 50, 55]],  // zoom in, drift down
    [[1.05, 45, 45],  [1.00, 55, 55]],  // zoom out, drift bottom-right
    [[1.00, 55, 55],  [1.05, 45, 45]],  // zoom in from bottom-right
  ];
  const [[fs, fox, foy], [ts, tox, toy]] = presets[Math.floor(Math.random() * presets.length)];

  // Set start state with no transition so it takes effect immediately
  img.style.transition      = 'none';
  img.style.transformOrigin = `${fox}% ${foy}%`;
  img.style.transform       = `scale(${fs})`;

  // Defer the animated state by one rAF to guarantee the start state is
  // committed to the compositor before the transition begins — this eliminates
  // the snap/jump that occurred when transition and initial state were set
  // in the same frame.
  requestAnimationFrame(() => {
    img.style.transition      = `transform ${dur}ms linear, transform-origin 0ms`;
    img.style.transformOrigin = `${tox}% ${toy}%`;
    img.style.transform       = `scale(${ts})`;
  });
}
