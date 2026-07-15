// hype:duo-post — two post cards side by side, preferring photos from
// two different channels (a "feed" on a widescreen monitor).

import { el } from '/shared/utils.js';
import { startKenBurns } from '/screen/transitions.js';
import { getPhotoChannel } from '../state-client.js';
import { buildCard } from './post-card.js';

export const layout = {
  id:        'hype:duo-post',
  name:      'hype:duo-post',
  module:    'hype',
  minPhotos: 2,

  pick(cfg, helpers) {
    // Overpick, then prefer a pair from two different channels.
    const pool = helpers.pickPhotos(5, cfg, [], false);
    if (pool.length < 2) return { photos: pool };
    const first = pool[0];
    const firstCh = getPhotoChannel(first.id);
    const other = pool.slice(1).find(p => getPhotoChannel(p.id) !== firstCh) || pool[1];
    return { photos: [first, other] };
  },

  build(picked) {
    const root = el('div', { cls: 'layout layout-hype-duo-post' });
    const photos = picked.photos || [];
    if (photos.length < 2) return { el: root, visibleIds: [], startMotion: () => {} };

    const imgs = [];
    const row = el('div', { cls: 'hype-duo-row' });
    for (const photo of photos) {
      const { card, img } = buildCard(photo);
      imgs.push(img);
      row.appendChild(card);
    }
    root.appendChild(row);

    return {
      el: root,
      visibleIds: photos.map(p => p.id),
      startMotion: (durationMs) => imgs.forEach(img => startKenBurns(img, durationMs)),
    };
  },
};
