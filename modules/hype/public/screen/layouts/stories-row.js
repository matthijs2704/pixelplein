// hype:stories-row — three 9:16 story frames side by side, each with its
// own progress bar + channel handle. The natural widescreen home for
// portrait photos.

import { el, photoUrl } from '/shared/utils.js';
import { applySmartFit } from '/screen/fit.js';
import { startKenBurns } from '/screen/transitions.js';
import { getPhotoChannel, getChannel, getGeneralAccount } from '../state-client.js';
import { icon } from '../icons.js';

export const layout = {
  id:        'hype:stories-row',
  name:      'hype:stories-row',
  module:    'hype',
  minPhotos: 3,

  pick(cfg, helpers) {
    const photos = helpers.pickPhotos(3, cfg, [], false, { orientation: 'portrait' });
    return { photos };
  },

  build(picked) {
    const root = el('div', { cls: 'layout layout-hype-storyrow' });
    const photos = picked.photos || [];
    if (!photos.length) return { el: root, visibleIds: [], startMotion: () => {} };

    const imgs = [];
    const fills = [];
    const row = el('div', { cls: 'hype-storyrow' });

    photos.forEach((photo, i) => {
      const chId = getPhotoChannel(photo.id);
      const ch = (chId && getChannel(chId)) || getGeneralAccount();

      const frame = el('div', { cls: 'hype-storyrow-frame' });
      frame.style.setProperty('--ch-color', ch.color || '#00b2ff');

      const fill = el('div', { cls: 'hype-storyrow-progress-fill' });
      fills.push(fill);
      frame.appendChild(el('div', { cls: 'hype-storyrow-progress' }, fill));

      const head = el('div', { cls: 'hype-storyrow-head' });
      head.innerHTML = `<span>${ch.handle}</span><span class="hype-storyrow-verified">${icon.verified(13)}</span>`;
      frame.appendChild(head);

      const img = el('img', { src: photoUrl(photo), alt: photo.name || '' });
      img.dataset.photoId = photo.id;
      img.dataset.hypeChromeSkip = '1'; // frame head already shows the handle
      applySmartFit(img, photo, false);
      imgs.push(img);
      frame.appendChild(el('div', { cls: 'hype-storyrow-media' }, img));
      frame.appendChild(el('div', { cls: 'hype-storyrow-scrim' }));
      row.appendChild(frame);
    });

    root.appendChild(row);

    return {
      el: root,
      visibleIds: photos.map(p => p.id),
      startMotion: (durationMs) => {
        imgs.forEach(img => startKenBurns(img, durationMs));
        for (const fill of fills) {
          fill.style.transition = `transform ${durationMs}ms linear`;
          requestAnimationFrame(() => { fill.style.transform = 'scaleX(1)'; });
        }
      },
    };
  },
};
