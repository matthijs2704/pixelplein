// "hype-feed" slide — IG-style "Activity" feed driven by the live
// engine. Each card shows: channel handle, recent comment text,
// current like count for the photo. No image fetch (screens lack admin
// auth for /api/photos); the visual photos live in the photo wall +
// chrome overlay. This slide is the "look at all this engagement" view.

import { el, slideDurationMs, slideDelay } from '/shared/utils.js';
import {
  getChannel,
  getChannels,
  getPhotoLikes,
  getPhotoChannel,
  getRecentCommentsAny,
  onHypeChange,
} from '../state-client.js';
import { icon } from '../icons.js';

const MAX_CARDS = 16;

function _fmtLikes(n) {
  if (n >= 10_000) return Math.round(n / 1000) + 'K';
  if (n >= 1000)   return (n / 1000).toFixed(1) + 'K';
  return String(n | 0);
}

function _placeholderCards(scope) {
  // When no engine activity yet, show static intro cards from channels.
  const channels = getChannels().slice(0, 4);
  return channels.map(ch => ({
    channelId: ch.id,
    author:    ch.handle,
    text:      `${ch.name} is live op De Hype`,
    photoId:   '',
    ts:        Date.now(),
  }));
}

export function buildFeedSlide(slide) {
  const root = el('div', { cls: 'hype-slide hype-slide-feed' });
  const header = el('div', { cls: 'hype-slide-header' },
    el('div', { cls: 'hype-slide-title', text: slide.title || 'Op De Hype' }),
    el('div', { cls: 'hype-slide-subtitle', text: slide.subtitle || 'live activiteit' }),
  );
  root.appendChild(header);

  const scroller = el('div', { cls: 'hype-feed-scroller' });
  const track    = el('div', { cls: 'hype-feed-track' });
  scroller.appendChild(track);
  root.appendChild(scroller);

  function render() {
    const recents = getRecentCommentsAny(MAX_CARDS);
    const items = recents.length ? recents : _placeholderCards();

    track.innerHTML = '';
    for (const c of items) {
      const channelId = c.channelId || getPhotoChannel(c.photoId);
      const ch = channelId ? getChannel(channelId) : null;
      const likes = c.photoId ? getPhotoLikes(c.photoId) : 0;

      const card = el('div', { cls: 'hype-feed-card' });
      card.style.setProperty('--ch-color', ch?.color || '#7c5cff');

      const head = el('div', { cls: 'hype-feed-head' },
        el('div', { cls: 'hype-feed-meta' },
          el('div', { cls: 'hype-feed-handle', text: ch?.handle || '@hype' }),
          el('div', { cls: 'hype-feed-name',   text: ch?.name || 'De Hype' }),
        ),
        likes
          ? el('div', { cls: 'hype-feed-likes' },
              el('span', { cls: 'hype-feed-heart' }),
              el('span', { text: _fmtLikes(likes) }),
            )
          : null,
      );

      const body = el('div', { cls: 'hype-feed-comment' },
        el('span', { cls: 'hype-feed-author', text: c.author + ' ' }),
        el('span', { cls: 'hype-feed-text',   text: c.text }),
      );

      card.appendChild(head);
      const heart = card.querySelector('.hype-feed-heart');
      if (heart) heart.innerHTML = icon.heartFill(16);
      card.appendChild(body);
      track.appendChild(card);
    }
  }

  render();
  let scrollTimer = null;
  const off = onHypeChange(() => render());

  function _startAutoScroll() {
    let y = 0;
    const speed = 0.35;
    function tick() {
      const max = track.scrollHeight - scroller.clientHeight;
      if (max > 0) {
        y += speed;
        if (y > max + 60) y = -60;
        track.style.transform = `translateY(${-y}px)`;
      }
      scrollTimer = requestAnimationFrame(tick);
    }
    scrollTimer = requestAnimationFrame(tick);
  }

  const durationMs = slideDurationMs(slide, 18);

  return {
    el: root,
    play: async (signal) => {
      _startAutoScroll();
      try { await slideDelay(durationMs, signal); }
      finally {
        if (scrollTimer) cancelAnimationFrame(scrollTimer);
        off();
      }
    },
  };
}
