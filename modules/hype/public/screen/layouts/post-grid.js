// hype:post-grid — 3×3 Instagram profile-page grid. Top row shows a
// "profile" header for one channel; remaining 9 cells are photos.

import { el, photoUrl } from '/shared/utils.js';
import { getChannels, getAllFollowers, getChannel } from '../state-client.js';

export const layout = {
  id:        'hype:post-grid',
  name:      'hype:post-grid',
  module:    'hype',
  minPhotos: 6,

  pick(cfg, helpers) {
    const photos = helpers.pickPhotos(9, cfg, [], false);
    return { photos };
  },

  build(picked) {
    const photos = picked.photos || [];
    return _build(photos);
  },
};

function _build(photos) {
  const root = el('div', { cls: 'layout layout-hype-post-grid' });

  // Pick a channel for the profile header — rotate by date so it varies.
  const channels = getChannels();
  const ch = channels[Math.floor(Date.now() / 30_000) % Math.max(1, channels.length)];
  const followers = getAllFollowers()[ch?.id] | 0;

  const header = el('div', { cls: 'hype-pg-header' });
  if (ch) {
    header.style.setProperty('--ch-color', ch.color || '#7c5cff');
    const avatar = el('div', { cls: 'hype-pg-avatar', text: String(ch.name || ch.handle || '?').charAt(0).toUpperCase() });
    if (ch.avatar_url) {
      avatar.textContent = '';
      avatar.appendChild(el('img', { src: ch.avatar_url, alt: '' }));
    }
    header.appendChild(avatar);
    header.appendChild(el('div', { cls: 'hype-pg-meta' },
      el('div', { cls: 'hype-pg-handle', text: ch.handle }),
      el('div', { cls: 'hype-pg-name',   text: ch.name }),
      el('div', { cls: 'hype-pg-stats' },
        el('span', { cls: 'hype-pg-stat-num', text: photos.length.toString() }),
        el('span', { cls: 'hype-pg-stat-lbl', text: ' posts' }),
        el('span', { cls: 'hype-pg-stat-num', text: ' · ' + followers.toLocaleString('nl-NL') }),
        el('span', { cls: 'hype-pg-stat-lbl', text: ' volgers' }),
      ),
    ));
  }
  root.appendChild(header);

  const grid = el('div', { cls: 'hype-pg-grid' });
  const visibleIds = [];
  for (let i = 0; i < 9; i++) {
    const p = photos[i];
    const cell = el('div', { cls: 'hype-pg-cell' });
    if (p) {
      visibleIds.push(p.id);
      const img = el('img', { src: photoUrl(p), alt: '' });
      img.dataset.photoId = p.id;
      cell.appendChild(img);
    }
    grid.appendChild(cell);
  }
  root.appendChild(grid);

  return {
    el: root,
    visibleIds,
    startMotion: () => {},
  };
}
