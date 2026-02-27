// Maps between the simple Quick-tab sliders and the underlying screen config fields

import { lerp, norm } from '/shared/utils.js';

/**
 * Derive simple model values from a screen config object.
 * Each value is 0–100.
 */
export function simpleModelFromConfig(cfg) {
  const c = cfg || {};
  return {
    // Pace: slow (low) ↔ fast (high). Driven by layoutDuration (18000=slow, 5000=fast).
    pace:        Math.round(norm(c.layoutDuration ?? 9000, 18000, 5000) * 100),
    // Story focus: mixed (0) ↔ focused (100). Driven by groupMixPct (60=mixed, 0=focused).
    storyFocus:  Math.round(100 - norm(c.groupMixPct ?? 20, 0, 60) * 100),
    // Screen energy: calm (0) ↔ active (100). Driven by mosaicSwapRounds.
    energy:      Math.round(norm(c.mosaicSwapRounds ?? 1, 0, 4) * 100),
  };
}

/**
 * Apply a simple control change to a screen config object (mutates in-place).
 *
 * @param {Object} screen - the screen config to mutate
 * @param {string} key    - 'pace' | 'storyFocus' | 'energy'
 * @param {number} value  - 0..100
 */
export function applySimpleControl(screen, key, value) {
  const t = value / 100;

  if (key === 'pace') {
    screen.layoutDuration  = Math.round(lerp(18000, 5000,  t));
    screen.transitionTime  = Math.round(lerp(1400,  450,   t));
    screen.mosaicSwapDelay = Math.round(lerp(4200,  1200,  t));
    screen.swapStaggerMs   = Math.round(lerp(260,   90,    t));
    return;
  }

  if (key === 'storyFocus') {
    // t=0 → mixed (groupMixPct=60), t=1 → focused (groupMixPct=0)
    // Must match the inverse in simpleModelFromConfig: norm(groupMixPct, 0, 60)
    screen.groupMixPct = Math.round(lerp(60, 0, t));
    // Do NOT touch groupMode here — the group selector manages that separately
    return;
  }

  if (key === 'energy') {
    screen.mosaicSwapRounds = Math.round(lerp(0, 4, t));
    screen.mosaicSwapCount  = Math.max(1, Math.round(lerp(1, 6, t)));
    return;
  }
}

/**
 * Build linked screen config from screen 1 by applying automatic offsets.
 */
export function deriveLinkedScreenConfig(screen1, screenId) {
  const id = Number(screenId) || 2;
  const offset = 900 * Math.max(1, id - 1);
  return {
    ...screen1,
    preferHeroSide: screen1.preferHeroSide === 'left'  ? 'right'
                  : screen1.preferHeroSide === 'right' ? 'left'
                  : 'left',
    cyclePhaseMs: offset,
  };
}
