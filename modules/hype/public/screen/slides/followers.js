// "hype-followers" slide — animated follower counter for all channels.
// Reads live counts from state-client; subscribes to changes so the digits
// roll while on screen.

import { el, slideDurationMs, slideDelay } from '/shared/utils.js';
import { getChannels, getAllFollowers, onHypeChange } from '../state-client.js';

function _fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 10_000)    return Math.round(n / 1000) + 'K';
  if (n >= 1000)      return (n / 1000).toFixed(1) + 'K';
  return String(n | 0);
}

function _rollTo(node, target) {
  const start = Number(node._cur || 0);
  const delta = target - start;
  if (!delta) { node.textContent = _fmt(target); return; }
  const dur = 800;
  const t0  = performance.now();
  function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    const cur = Math.round(start + delta * eased);
    node.textContent = _fmt(cur);
    node._cur = cur;
    if (k < 1) requestAnimationFrame(step);
    else      node._cur = target;
  }
  requestAnimationFrame(step);
}

export function buildFollowersSlide(slide) {
  const root = el('div', { cls: 'hype-slide hype-slide-followers' });

  const header = el('div', { cls: 'hype-slide-header' },
    el('div', { cls: 'hype-slide-title', text: slide.title || 'Volgers' }),
    el('div', { cls: 'hype-slide-subtitle', text: slide.subtitle || 'Live op De Hype' }),
  );
  root.appendChild(header);

  const grid = el('div', { cls: 'hype-followers-grid' });
  root.appendChild(grid);

  const cards = new Map(); // channelId -> { card, count }

  function render() {
    const channels = getChannels().filter(ch => ch.race_participant !== false);
    const counts = getAllFollowers();

    // Add cards for new channels
    for (const ch of channels) {
      if (cards.has(ch.id)) continue;
      const card = el('div', { cls: 'hype-foll-card' });
      card.style.setProperty('--ch-color', ch.color || '#7c5cff');
      const avatar = el('div', { cls: 'hype-foll-avatar', text: String(ch.name || ch.handle || '?').charAt(0).toUpperCase() });
      const avatarUrl = ch.avatar_url || ch.avatarUrl || '';
      if (avatarUrl) {
        avatar.textContent = '';
        avatar.appendChild(el('img', { src: avatarUrl, alt: '' }));
      }
      const top = el('div', { cls: 'hype-foll-top' },
        avatar,
        el('div', { cls: 'hype-foll-meta' },
          el('div', { cls: 'hype-foll-name',   text: ch.name }),
          el('div', { cls: 'hype-foll-handle', text: ch.handle }),
        ),
      );
      const count = el('div', { cls: 'hype-foll-count', text: '0' });
      const label = el('div', { cls: 'hype-foll-label', text: 'volgers' });
      card.appendChild(top);
      card.appendChild(count);
      card.appendChild(label);
      grid.appendChild(card);
      cards.set(ch.id, { card, count });
    }

    // Update counts
    for (const ch of channels) {
      const entry = cards.get(ch.id);
      if (entry) _rollTo(entry.count, counts[ch.id] | 0);
    }
  }

  render();
  const off = onHypeChange((detail) => {
    if (detail.kind === 'followers' || detail.kind === 'channels' || detail.kind === 'hydrate') {
      render();
    }
  });

  const durationMs = slideDurationMs(slide, 12);

  return {
    el: root,
    play: async (signal) => {
      try { await slideDelay(durationMs, signal); }
      finally { off(); }
    },
  };
}
