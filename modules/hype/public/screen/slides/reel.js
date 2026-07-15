// hype video reel — intercepts type:'video' slides when hype module is active
// and wraps them in a TikTok-style layout with channel info + side rail.

import { buildVideoSlide } from '/screen/slides/video.js';
import { getChannel, getGeneralAccount } from '../state-client.js';
import { icon } from '../icons.js';
import { el } from '/shared/utils.js';

function _fmt(n) {
  if (n >= 10_000) return Math.round(n / 1000) + 'K';
  if (n >= 1000)   return (n / 1000).toFixed(1) + 'K';
  return String(n | 0);
}

function _stableInt(seed, min, max) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return min + (h % (max - min));
}

function _railBtn(svgHtml, num, extraCls) {
  const btn = el('div', { cls: `hype-reel-rail-btn${extraCls ? ' ' + extraCls : ''}` });
  const ico = el('div', { cls: 'hype-reel-rail-icon' });
  ico.innerHTML = svgHtml;
  btn.appendChild(ico);
  btn.appendChild(el('span', { cls: 'hype-reel-rail-num', text: String(num) }));
  return btn;
}

export async function buildReelSlide(slide) {
  const base = await buildVideoSlide(slide);

  const ch    = (slide.channelId && getChannel(slide.channelId)) || getGeneralAccount();
  const color = ch?.color || '#7c5cff';
  const seed  = String(slide.filename || slide.id || 'reel');
  const likes = _stableInt(seed, 2400, 11800);

  const root = el('div', { cls: 'hype-reel-wrap' });
  root.style.setProperty('--ch-color', color);

  base.el.classList.add('hype-reel-video');
  root.appendChild(base.el);
  root.appendChild(el('div', { cls: 'hype-reel-vignette' }));

  // Bottom-left: handle + caption + music ticker
  const info = el('div', { cls: 'hype-reel-info' });

  const handleEl = el('div', { cls: 'hype-reel-handle' });
  handleEl.innerHTML =
    `<span>${ch?.handle || '@kamplive'}</span>` +
    `<span class="hype-reel-verified">${icon.verified(14)}</span>`;
  info.appendChild(handleEl);

  info.appendChild(el('p', {
    cls: 'hype-reel-caption',
    text: slide.caption || 'Live vanaf het kamp 🏕️ #kamplive',
  }));

  const ticker = el('div', { cls: 'hype-reel-music' });
  const chName = ch?.name || 'Kamp Live';
  const tickerText = `♫ Original sound — ${chName}`;
  ticker.innerHTML =
    `<div class="hype-reel-music-scroll"><span>${tickerText} &nbsp;&nbsp; ${tickerText}</span></div>`;
  info.appendChild(ticker);
  root.appendChild(info);

  // Right rail: likes, comments, share
  const rail = el('div', { cls: 'hype-reel-rail' });
  rail.appendChild(_railBtn(icon.heartFill(34), _fmt(likes), 'heart'));
  rail.appendChild(_railBtn(icon.comment(34), _fmt(Math.round(likes / 11)), ''));
  rail.appendChild(_railBtn(icon.send(34), 'deel', ''));
  root.appendChild(rail);

  return { el: root, play: base.play, destroy: base.destroy };
}
