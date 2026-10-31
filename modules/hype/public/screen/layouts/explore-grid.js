// hype:explore-grid — Instagram-explore style grid: one 2×2 featured tile
// plus six small tiles. The chrome overlay adds live channel badges and
// like counters on every img[data-photo-id].

import { el, photoUrl } from '/shared/utils.js';
import { applySmartFit } from '/screen/fit.js';
import { startKenBurns } from '/screen/transitions.js';

export const layout = {
  id:        'hype:explore-grid',
  name:      'hype:explore-grid',
  module:    'hype',
  minPhotos: 7,

  pick(cfg, helpers) {
    const featured = helpers.pickAndClaimHero(cfg, {});
    const rest = helpers.pickPhotos(featured ? 6 : 7, cfg, featured ? [featured.id] : [], true);
    const photos = featured ? [featured, ...rest] : rest;
    return { photos };
  },

  build(picked) {
    const root = el('div', { cls: 'layout layout-hype-explore' });
    const photos = picked.photos || [];
    if (photos.length < 2) return { el: root, visibleIds: [], startMotion: () => {} };

    const imgs = [];
    photos.forEach((photo, i) => {
      const cell = el('div', { cls: `hype-explore-cell${i === 0 ? ' featured' : ''}` });
      const img = el('img', { src: photoUrl(photo), alt: photo.name || '' });
      img.dataset.photoId = photo.id;
      applySmartFit(img, photo, true);
      imgs.push(img);
      cell.appendChild(img);
      root.appendChild(cell);
    });

    return {
      el: root,
      visibleIds: photos.map(p => p.id),
      startMotion: (durationMs) => imgs.forEach(img => startKenBurns(img, durationMs)),
    };
  },
};
