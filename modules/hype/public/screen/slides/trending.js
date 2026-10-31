// "hype-trending" slide — top 3 channels by follower delta + a scrolling
// ticker of latest activity headlines.

import { el, slideDurationMs, slideDelay } from '/shared/utils.js';
import {
  getChannels,
  getAllFollowers,
  getRecentCommentsAny,
  getChannel,
  onHypeChange,
} from '../state-client.js';

function _topChannels(limit = 3) {
  const counts = getAllFollowers();
  return getChannels()
    .map(c => ({ ...c, followers: counts[c.id] | 0 }))
    .sort((a, b) => b.followers - a.followers)
    .slice(0, limit);
}

function _headlines() {
  const lines = [];
  const top = _topChannels(1)[0];
  if (top) lines.push(`${top.handle} is trending`);
  for (const c of getRecentCommentsAny(8)) {
    const ch = c.channelId ? getChannel(c.channelId) : null;
    lines.push(`${ch?.handle || '@kamp_live'} ${c.author}: ${c.text}`);
  }
  if (lines.length < 4) lines.push('De Hype is live  •  blijf posten!');
  return lines;
}

export function buildTrendingSlide(slide) {
  const root = el('div', { cls: 'hype-slide hype-slide-trending' });
  root.appendChild(el('div', { cls: 'hype-slide-header' },
    el('div', { cls: 'hype-slide-title', text: slide.title || 'Trending' }),
    el('div', { cls: 'hype-slide-subtitle', text: slide.subtitle || 'top 3 op De Hype' }),
  ));

  const podium = el('div', { cls: 'hype-trend-podium' });
  root.appendChild(podium);

  const tickerWrap = el('div', { cls: 'hype-trend-ticker' });
  const tickerRow  = el('div', { cls: 'hype-trend-ticker-row' });
  tickerWrap.appendChild(tickerRow);
  root.appendChild(tickerWrap);

  function render() {
    podium.innerHTML = '';
    const top = _topChannels(3);
    const order = [1, 0, 2]; // 2nd, 1st, 3rd (visual podium)
    for (const idx of order) {
      const ch = top[idx];
      if (!ch) continue;
      const card = el('div', { cls: `hype-trend-card rank-${idx + 1}` });
      card.style.setProperty('--ch-color', ch.color || '#7c5cff');
      card.appendChild(el('div', { cls: 'hype-trend-rank', text: `#${idx + 1}` }));
      const avatar = el('div', { cls: 'hype-trend-avatar', text: String(ch.name || ch.handle || '?').charAt(0).toUpperCase() });
      const avatarUrl = ch.avatar_url || ch.avatarUrl || '';
      if (avatarUrl) {
        avatar.textContent = '';
        avatar.appendChild(el('img', { src: avatarUrl, alt: '' }));
      }
      card.appendChild(avatar);
      card.appendChild(el('div', { cls: 'hype-trend-name',   text: ch.name }));
      card.appendChild(el('div', { cls: 'hype-trend-handle', text: ch.handle }));
      card.appendChild(el('div', { cls: 'hype-trend-foll',   text: `${ch.followers.toLocaleString('nl-NL')} volgers` }));
      podium.appendChild(card);
    }

    // Ticker: build once + duplicate for seamless scroll
    const lines = _headlines();
    tickerRow.innerHTML = '';
    const text = lines.join('     •     ');
    for (let i = 0; i < 2; i++) {
      tickerRow.appendChild(el('span', { cls: 'hype-trend-ticker-text', text }));
    }
  }

  render();
  const off = onHypeChange(() => render());

  const durationMs = slideDurationMs(slide, 14);
  return {
    el: root,
    play: async (signal) => {
      try { await slideDelay(durationMs, signal); }
      finally { off(); }
    },
  };
}
