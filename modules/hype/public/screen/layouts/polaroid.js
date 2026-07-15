// hype:polaroid — branded polaroid layout. Wraps the base polaroid
// and injects channel handle + hype mark into each card footer.

import { buildPolaroid } from '/screen/layouts/polaroid.js';
import { el } from '/shared/utils.js';
import { getPhotoChannel, getChannel } from '../state-client.js';

export const layout = {
  id:        'hype:polaroid',
  name:      'hype:polaroid',
  module:    'hype',
  minPhotos: 5,

  pick(cfg, helpers) {
    const count = 5 + Math.floor(Math.random() * 6); // 5-10
    const photos = helpers.pickPhotos(Math.min(count, 10), cfg, [], false);
    return { photos };
  },

  build(picked) {
    const result = buildPolaroid(picked.photos);

    const footers = Array.from(result.el.querySelectorAll('.polaroid-footer'));
    picked.photos.forEach((photo, i) => {
      if (!footers[i]) return;
      const chId = getPhotoChannel(photo.id);
      const ch   = chId && getChannel(chId);

      const footer = footers[i];
      footer.classList.add('hype-polaroid-footer');
      if (ch) footer.style.setProperty('--ch-color', ch.color || '#00b2ff');

      if (ch) {
        footer.appendChild(el('span', { cls: 'hype-polaroid-handle', text: ch.handle }));
      }
      footer.appendChild(el('span', { cls: 'hype-polaroid-brand', text: 'de HYPE!' }));
    });

    return result;
  },
};
