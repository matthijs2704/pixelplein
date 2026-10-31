// "hype-viral" slide — "GAAT NU VIRAL": the hottest posts on the platform,
// big and cinematic. Ranked by viral flag first, then live like count (the
// engine juices both in the background). Re-renders on hype state changes
// so counts keep climbing while the slide is on screen.

import { el, photoUrl, slideDurationMs, slideDelay } from '/shared/utils.js';
import { photoRegistry } from '/screen/photos.js';
import {
  getChannel,
  getGeneralAccount,
  getPhotoChannel,
  getPhotoLikes,
  getPhotoViral,
  getRecentComments,
  onHypeChange,
} from '../state-client.js';
import { fmtCount } from '../format.js';
import { icon } from '../icons.js';

const MAX_CARDS = 3;

function _hotPhotos() {
  return Array.from(photoRegistry.values())
    .filter(p => p && p.status === 'ready')
    .map(p => ({ p, likes: getPhotoLikes(p.id), viral: getPhotoViral(p.id) }))
    .filter(x => x.viral || x.likes > 0)
    .sort((a, b) => (b.viral - a.viral) || (b.likes - a.likes))
    .slice(0, MAX_CARDS);
}

function _card({ p, likes, viral }, index) {
  const ch = getChannel(getPhotoChannel(p.id)) || getGeneralAccount();
  const card = el('article', { cls: `hype-viral-card rank-${index + 1}` });
  card.style.setProperty('--ch-color', (ch && ch.color) || '#00b2ff');

  const img = el('img', { src: photoUrl(p), alt: p.name || '' });
  img.dataset.photoId = p.id;
  img.dataset.hypeChromeSkip = '1'; // the card carries its own chrome
  card.appendChild(el('div', { cls: 'hype-viral-media' }, img));

  if (viral) {
    const flame = el('span', { cls: 'hype-viral-flame' });
    flame.innerHTML = `${icon.flame(18)}<i>viral</i>`;
    card.appendChild(flame);
  }

  const comment = getRecentComments(p.id, 1)[0] || null;
  card.appendChild(el('div', { cls: 'hype-viral-meta' },
    el('div', { cls: 'hype-viral-who' },
      el('strong', { text: (ch && ch.handle) || '@kamplive' }),
      comment ? el('span', { cls: 'hype-viral-comment', text: `${comment.author}: ${comment.text}` }) : null,
    ),
    el('div', { cls: 'hype-viral-likes' },
      el('strong', { text: fmtCount(likes) }),
      el('span', { text: 'vind-ik-hypes' }),
    ),
  ));
  return card;
}

export function buildViralSlide(slide) {
  const root = el('div', { cls: 'hype-slide hype-slide-viral' });
  root.appendChild(el('div', { cls: 'hype-slide-header' },
    el('div', { cls: 'hype-slide-title', text: slide.title || 'Gaat nu viral' }),
    el('div', { cls: 'hype-slide-subtitle', text: slide.subtitle || 'de heetste posts van dit moment 🔥' }),
  ));

  const grid = el('div', { cls: 'hype-viral-grid' });
  root.appendChild(grid);

  function render() {
    const hot = _hotPhotos();
    grid.innerHTML = '';
    if (!hot.length) {
      grid.appendChild(el('div', { cls: 'hype-viral-empty', text: 'nog niets viral — post iets!' }));
      return;
    }
    hot.forEach((x, i) => grid.appendChild(_card(x, i)));
  }

  render();

  // Live counts keep climbing while on screen; only re-render the grid when
  // the ranking itself changes so cards don't flicker.
  let key = _hotPhotos().map(x => x.p.id).join(',');
  const off = onHypeChange(() => {
    const next = _hotPhotos();
    const nextKey = next.map(x => x.p.id).join(',');
    if (nextKey !== key) { key = nextKey; render(); return; }
    // Same photos → update like counters in place.
    next.forEach((x, i) => {
      const numEl = grid.querySelectorAll('.hype-viral-likes strong')[i];
      if (numEl) numEl.textContent = fmtCount(x.likes);
    });
  });

  // Slide contract: play() holds the slide on screen for its duration.
  const durationMs = slideDurationMs(slide, 16);
  return {
    el: root,
    play: async (signal) => {
      try { await slideDelay(durationMs, signal); }
      finally { off(); }
    },
  };
}
