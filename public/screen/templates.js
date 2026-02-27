// Mosaic template definitions and weighted selection logic

export const TEMPLATE_DEFS = {
  'hero-left-9': {
    kind: 'cinematic',
    slots: [
      { area: '1 / 1 / 3 / 3', hero: true  },
      { area: '1 / 3 / 2 / 4' },
      { area: '2 / 3 / 3 / 4' },
      { area: '3 / 1 / 4 / 2' },
      { area: '3 / 2 / 4 / 3' },
      { area: '3 / 3 / 4 / 4' },
    ],
    cols: 3, rows: 3,
  },
  'hero-right-9': {
    kind: 'cinematic',
    slots: [
      { area: '1 / 1 / 2 / 2' },
      { area: '2 / 1 / 3 / 2' },
      { area: '1 / 2 / 3 / 4', hero: true  },
      { area: '3 / 1 / 4 / 2' },
      { area: '3 / 2 / 4 / 3' },
      { area: '3 / 3 / 4 / 4' },
    ],
    cols: 3, rows: 3,
  },
  'hero-top-9': {
    kind: 'cinematic',
    slots: [
      { area: '1 / 1 / 3 / 4', hero: true  },
      { area: '3 / 1 / 4 / 2' },
      { area: '3 / 2 / 4 / 3' },
      { area: '3 / 3 / 4 / 4' },
    ],
    cols: 3, rows: 3,
  },
  'split-story-6': {
    kind: 'cinematic',
    slots: [
      { area: '1 / 1 / 3 / 2', hero: true, portrait: true },
      { area: '1 / 2 / 2 / 3' },
      { area: '2 / 2 / 3 / 3' },
      { area: '1 / 3 / 2 / 4' },
      { area: '2 / 3 / 3 / 4' },
    ],
    cols: 3, rows: 2,
  },
  'uniform-9': {
    kind: 'dynamic',
    slots: Array.from({ length: 9 }, (_, i) => ({
      area: `${Math.floor(i / 3) + 1} / ${(i % 3) + 1} / ${Math.floor(i / 3) + 2} / ${(i % 3) + 2}`,
    })),
    cols: 3, rows: 3,
  },
  'uniform-4': {
    kind: 'dynamic',
    slots: Array.from({ length: 4 }, (_, i) => ({
      area: `${Math.floor(i / 2) + 1} / ${(i % 2) + 1} / ${Math.floor(i / 2) + 2} / ${(i % 2) + 2}`,
    })),
    cols: 2, rows: 2,
  },
  'uniform-6': {
    kind: 'dynamic',
    slots: Array.from({ length: 6 }, (_, i) => ({
      area: `${Math.floor(i / 3) + 1} / ${(i % 3) + 1} / ${Math.floor(i / 3) + 2} / ${(i % 3) + 2}`,
    })),
    cols: 3, rows: 2,
  },
  'recent-strip-9': {
    kind: 'dynamic',
    slots: [
      { area: '1 / 1 / 3 / 3', hero: true  },
      { area: '1 / 3 / 2 / 4' },
      { area: '2 / 3 / 3 / 4' },
      { area: '3 / 1 / 4 / 2', recent: true },
      { area: '3 / 2 / 4 / 3', recent: true },
      { area: '3 / 3 / 4 / 4', recent: true },
    ],
    cols: 3, rows: 3,
  },
  'portrait-bias-9': {
    kind: 'neutral',
    slots: [
      { area: '1 / 1 / 3 / 2', portrait: true },
      { area: '1 / 2 / 2 / 3' },
      { area: '2 / 2 / 3 / 3' },
      { area: '1 / 3 / 3 / 4', portrait: true, hero: true },
      { area: '3 / 1 / 4 / 2' },
      { area: '3 / 2 / 4 / 3' },
      { area: '3 / 3 / 4 / 4' },
    ],
    cols: 3, rows: 3,
  },
};

/**
 * Pick a template name using weighted random selection.
 *
 * @param {Object}   cfg          - Screen config
 * @param {string[]} recentNames  - Last 2 template names (avoid repeating)
 * @param {string}   [heroSide]   - 'left'|'right'|'auto'
 * @returns {string} Template name
 */
export function pickTemplate(cfg, recentNames, heroSide) {
  const enabled = (cfg.templateEnabled || Object.keys(TEMPLATE_DEFS))
    .filter(id => TEMPLATE_DEFS[id]);

  if (enabled.length === 0) return 'hero-left-9';

  // Kind weights from config
  const cinematicW = cfg.cinematicWeight ?? 65;
  const dynamicW   = cfg.dynamicWeight   ?? 25;
  const neutralW   = cfg.neutralWeight   ?? 10;

  const total = cinematicW + dynamicW + neutralW || 1;
  const weights = { cinematic: cinematicW / total, dynamic: dynamicW / total, neutral: neutralW / total };

  // Build candidate pool with scores
  const candidates = enabled
    .filter(id => !recentNames.slice(-2).includes(id)) // no-repeat-last-2
    .map(id => {
      const tpl  = TEMPLATE_DEFS[id];
      let score  = weights[tpl.kind] || 0.1;

      // Hero side bias
      if (heroSide === 'left'  && id.includes('left'))  score *= 1.5;
      if (heroSide === 'right' && id.includes('right')) score *= 1.5;

      return { id, score };
    });

  // Fall back to all enabled if all were recently used
  const pool = candidates.length ? candidates : enabled.map(id => ({ id, score: 1 }));

  // Weighted random pick
  const totalScore = pool.reduce((s, c) => s + c.score, 0);
  let r = Math.random() * totalScore;
  for (const c of pool) {
    r -= c.score;
    if (r <= 0) return c.id;
  }
  return pool[pool.length - 1].id;
}
