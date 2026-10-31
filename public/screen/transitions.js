// Layout transition animations: fade, slide, zoom
// All transitions share the same easing — fast attack, long smooth tail.
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

import { applySmartFit } from './fit.js';
import { photoUrl, photoThumbUrl } from '../shared/utils.js';

const IMAGE_READY_TIMEOUT_MS = 900;

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _imageReady(img) {
  if (!img || img.complete && img.naturalWidth > 0) {
    if (typeof img?.decode === 'function') {
      return img.decode().catch(() => {});
    }
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const done = () => {
      img.removeEventListener('load', done);
      img.removeEventListener('error', done);
      if (typeof img.decode === 'function' && img.naturalWidth > 0) {
        img.decode().catch(() => {}).finally(resolve);
      } else {
        resolve();
      }
    };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  });
}

async function _waitForImages(el, timeoutMs) {
  const imgs = Array.from(el?.querySelectorAll?.('img') || []);
  if (!imgs.length) return;
  await Promise.race([
    Promise.all(imgs.map(_imageReady)),
    _delay(timeoutMs || IMAGE_READY_TIMEOUT_MS),
  ]);
}

/**
 * Transition between outgoing and incoming layout containers.
 *
 * @param {HTMLElement} outEl - The element currently on screen (may be null)
 * @param {HTMLElement} inEl  - The new element to show
 * @param {'fulco-festival-2026-journey'|'fade'|'slide'|'zoom'} type
 * @param {number} durationMs
 * @returns {Promise<void>} Resolves when the transition completes
 */
export function runTransition(outEl, inEl, type, durationMs) {
  return new Promise(async resolve => {
    const ms = durationMs || 800;
    const transitionType = type || 'fade';

    // The new element has already been appended by the lifecycle manager.
    // Hide/position it synchronously before waiting for images, otherwise slow
    // devices can paint its empty black background before the transition starts.
    if (outEl) {
      outEl.style.zIndex = '1';
      inEl.style.zIndex = '2';
      if (transitionType === 'fulco-festival-2026-journey') {
        inEl.style.opacity = '1';
        inEl.style.transform = '';
        outEl.style.zIndex = '3';
      } else if (transitionType === 'slide') {
        inEl.style.transform = 'translateX(100%)';
        inEl.style.opacity = '1';
      } else if (transitionType === 'zoom') {
        inEl.style.opacity = '0';
        inEl.style.transform = 'scale(1.04)';
      } else {
        inEl.style.opacity = '0';
        inEl.style.transform = '';
      }
    }

    if (transitionType === 'fulco-festival-2026-journey') {
      if (!outEl) {
        inEl.style.opacity = '1';
        inEl.style.transform = '';
        inEl.style.zIndex = '';
        resolve();
        return;
      }

      const closingEl = outEl.querySelector?.('.xp-page') || outEl;
      const x = closingEl.style.getPropertyValue('--reveal-x')
        || outEl.style.getPropertyValue('--reveal-x')
        || '50%';
      const y = closingEl.style.getPropertyValue('--reveal-y')
        || outEl.style.getPropertyValue('--reveal-y')
        || '50%';
      outEl.classList?.add('xp-closing-to-map');
      closingEl.classList?.remove('xp-page-reveal');
      outEl.style.zIndex = '4';
      closingEl.style.zIndex = '4';
      closingEl.style.opacity = '1';
      closingEl.style.visibility = 'visible';
      closingEl.style.transition = '';
      closingEl.style.animation = 'none';
      closingEl.style.clipPath = `circle(155% at ${x} ${y})`;
      closingEl.style.setProperty('--reveal-x', x);
      closingEl.style.setProperty('--reveal-y', y);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const closeMs = Math.max(ms, 1150);
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            closingEl.removeEventListener('animationend', finish);
            outEl.remove();
            inEl.style.zIndex = '';
            resolve();
          };
          closingEl.addEventListener('animationend', finish);
          closingEl.style.animation = `xp-page-close ${closeMs}ms cubic-bezier(.18,.86,.25,1) both`;
          setTimeout(finish, closeMs + 80);
        });
      });
      return;
    }

    await _waitForImages(inEl, Math.min(IMAGE_READY_TIMEOUT_MS, Math.max(250, ms)));

    if (!outEl) {
      // Nothing to transition out — just show inEl immediately
      inEl.style.opacity = '1';
      inEl.style.transform = '';
      resolve();
      return;
    }

    if (transitionType === 'fade') {
      inEl.style.transition = `opacity ${ms}ms ${EASE}`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inEl.style.opacity = '1';
          setTimeout(() => {
            outEl.remove();
            inEl.style.zIndex = '';
            resolve();
          }, ms);
        });
      });
      return;
    }

    if (transitionType === 'slide') {
      inEl.style.transition  = `transform ${ms}ms ${EASE}`;
      outEl.style.transition = `transform ${ms}ms ${EASE}`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inEl.style.transform  = 'translateX(0)';
          outEl.style.transform = 'translateX(-100%)';
          setTimeout(() => {
            outEl.remove();
            inEl.style.zIndex = '';
            resolve();
          }, ms);
        });
      });
      return;
    }

    inEl.style.transition = `opacity ${ms}ms ${EASE}, transform ${ms}ms ${EASE}`;
    if (transitionType === 'zoom') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inEl.style.opacity   = '1';
          inEl.style.transform = 'scale(1)';
          outEl.style.transition = `opacity ${ms}ms ${EASE}`;
          outEl.style.opacity  = '0';
          setTimeout(() => {
            outEl.remove();
            inEl.style.zIndex = '';
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
  const preferThumb = slot.dataset.preferThumb === '1';

  const next = new Image();
  next.src   = preferThumb ? photoThumbUrl(photo) : photoUrl(photo);
  next.alt   = photo.name;
  // Base styles — fit will be applied once photo dimensions are known
  next.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0;';
  next.style.opacity = '0';

  slot.style.position = 'relative';
  slot.appendChild(next);

  next.onload = () => {
    applySmartFit(next, photo, slotIsPortrait);
    // Double rAF: first frame commits opacity:0 + no-transition state,
    // second frame starts the transition — same pattern as slide/zoom.
    // Without the double rAF, cached images fire onload before the browser
    // has painted the initial opacity:0, causing the transition to be skipped.
    next.style.transition = 'none';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        next.style.transition = `opacity ${ms}ms ${EASE}`;
        next.style.opacity = '1';
        img.style.transition = `opacity ${ms}ms ${EASE}`;
        img.style.opacity  = '0';
        setTimeout(() => {
          img.remove();
          next.style.position = '';
          next.style.inset    = '';
        }, ms);
      });
    });
  };

  // Dataset update for heartbeat tracking
  slot.dataset.photoId = photo.id;
}

const MIN_KENBURNS_DURATION_MS = 4000;
const DEFAULT_LAYOUT_DURATION_MS = 8000;

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
  const dur = Math.max(durationMs || DEFAULT_LAYOUT_DURATION_MS, MIN_KENBURNS_DURATION_MS);

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
  const [[fromScale, fromOriginX, fromOriginY], [toScale, toOriginX, toOriginY]] = presets[Math.floor(Math.random() * presets.length)];

  // Set start state with no transition so it takes effect immediately
  img.style.transition      = 'none';
  img.style.transformOrigin = `${fromOriginX}% ${fromOriginY}%`;
  img.style.transform       = `scale(${fromScale})`;

  // Defer the animated state by one rAF to guarantee the start state is
  // committed to the compositor before the transition begins — this eliminates
  // the snap/jump that occurred when transition and initial state were set
  // in the same frame.
  requestAnimationFrame(() => {
    img.style.transition      = `transform ${dur}ms linear, transform-origin 0ms`;
    img.style.transformOrigin = `${toOriginX}% ${toOriginY}%`;
    img.style.transform       = `scale(${toScale})`;
  });
}
