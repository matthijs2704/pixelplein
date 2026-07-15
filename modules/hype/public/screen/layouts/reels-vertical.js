// hype:reels-vertical — 9:16 photo centered on widescreen with a
// TikTok/Reels side-rail (heart + like count + comment count + share).

import { el, photoUrl } from '/shared/utils.js';
import { getPhotoChannel, getChannel, getGeneralAccount, getPhotoLikes } from '../state-client.js';
import { icon } from '../icons.js';

function _fmt(n) {
  if (n >= 10_000) return Math.round(n / 1000) + 'K';
  if (n >= 1000)   return (n / 1000).toFixed(1) + 'K';
  return String(n | 0);
}

export const layout = {
  id:        'hype:reels-vertical',
  name:      'hype:reels-vertical',
  module:    'hype',
  minPhotos: 1,

  pick(cfg, helpers) {
    const photo = helpers.pickAndClaimHero(cfg, { orientation: 'portrait' })
               || helpers.pickPhotos(1, cfg, [], false)[0]
               || null;
    return { photo };
  },

  build(picked) {
    return _build(picked.photo);
  },
};

function _build(photo) {
  const root = el('div', { cls: 'layout layout-hype-reels' });
  if (!photo) return { el: root, visibleIds: [], startMotion: () => {} };

  const stage = el('div', { cls: 'hype-reels-stage' });
  // Blurred fill behind the portrait so the widescreen sides aren't dead black.
  const bg = el('div', { cls: 'hype-reels-bg' });
  bg.style.backgroundImage = `url("${photoUrl(photo)}")`;
  stage.appendChild(bg);
  const img   = el('img', { cls: 'hype-reels-img', src: photoUrl(photo), alt: photo.name });
  img.dataset.photoId = photo.id;
  img.dataset.hypeChromeSkip = '1'; // reel info + rail already show identity/likes
  // No applySmartFit here: it forces object-fit:cover inline, and this
  // layout must never crop — CSS keeps it contain inside the 9:16 column.
  stage.appendChild(img);

  // Channel info bottom-left
  const chId = getPhotoChannel(photo.id);
  const ch = (chId && getChannel(chId)) || getGeneralAccount();
  if (ch) {
    const info = el('div', { cls: 'hype-reels-info' });
    info.style.setProperty('--ch-color', ch.color || '#7c5cff');
    const handleEl = el('div', { cls: 'hype-reels-handle' });
    handleEl.innerHTML = `<span>${ch.handle}</span><span class="hype-reels-verified">${icon.verified(14)}</span>`;
    info.appendChild(handleEl);
    info.appendChild(el('div', {
      cls: 'hype-reels-caption',
      text: chId ? `🔥 creator update — #kamplive` : `🏕️ live vanaf het kamp — #kamplive`,
    }));
    const tickerText = `♫ Original sound — ${ch.name}`;
    const music = el('div', { cls: 'hype-reels-music' });
    music.innerHTML = `<div class="hype-reels-music-scroll"><span>${tickerText} &nbsp;&nbsp; ${tickerText}</span></div>`;
    info.appendChild(music);
    stage.appendChild(info);
  }

  // Side rail right
  const rail = el('div', { cls: 'hype-reels-rail' });
  const likes = getPhotoLikes(photo.id);
  rail.appendChild(el('div', { cls: 'hype-reels-rail-btn' },
    el('div', { cls: 'hype-reels-rail-icon', attrs: { 'aria-label': 'likes' } }),
    el('div', { cls: 'hype-reels-rail-num',  text: _fmt(likes) }),
  ));
  rail.lastChild.firstChild.innerHTML = icon.heartFill(28);
  rail.appendChild(el('div', { cls: 'hype-reels-rail-btn' },
    el('div', { cls: 'hype-reels-rail-icon', attrs: { 'aria-label': 'comments' } }),
    el('div', { cls: 'hype-reels-rail-num',  text: _fmt(Math.max(1, Math.round(likes / 12))) }),
  ));
  rail.lastChild.firstChild.innerHTML = icon.comment(28);
  rail.appendChild(el('div', { cls: 'hype-reels-rail-btn' },
    el('div', { cls: 'hype-reels-rail-icon', attrs: { 'aria-label': 'share' } }),
    el('div', { cls: 'hype-reels-rail-num',  text: 'deel' }),
  ));
  rail.lastChild.firstChild.innerHTML = icon.send(28);
  stage.appendChild(rail);

  root.appendChild(stage);

  return {
    el: root,
    visibleIds: [photo.id],
    // No Ken Burns: the photo is contain-fit and must never be clipped;
    // the music ticker provides the motion.
    startMotion: () => {},
  };
}
