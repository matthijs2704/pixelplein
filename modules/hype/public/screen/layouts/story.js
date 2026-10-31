// hype:story — single full-bleed photo with Instagram-Stories chrome:
// progress bar at top, channel handle, soft vignette. The chrome overlay
// adds live likes/comments on top of this layout naturally.

import { el, photoUrl } from '/shared/utils.js';
import { applySmartFit } from '/screen/fit.js';
import { getPhotoLikes, getPhotoChannel, getChannel, getGeneralAccount } from '../state-client.js';
import { icon, monogramAvatar } from '../icons.js';
import { fmtCount } from '../format.js';

export const layout = {
  id:        'hype:story',
  name:      'hype:story',
  module:    'hype',
  minPhotos: 1,

  pick(cfg, helpers) {
    const photo = helpers.pickAndClaimHero(cfg, {}) || helpers.pickPhotos(1, cfg, [], false)[0] || null;
    return { photo };
  },

  build(picked) {
    return _build(picked.photo);
  },
};

function _build(photo) {
  const root = el('div', { cls: 'layout layout-hype-story' });
  if (!photo) return { el: root, visibleIds: [], startMotion: () => {} };

  // Legibility scrims top + bottom
  root.appendChild(el('div', { cls: 'hype-story-scrim-top' }));
  root.appendChild(el('div', { cls: 'hype-story-scrim-bottom' }));

  // Progress bar (decorative — animates with layout duration via CSS var)
  const progressBar = el('div', { cls: 'hype-story-progress' });
  const progressFill = el('div', { cls: 'hype-story-progress-fill' });
  progressBar.appendChild(progressFill);
  root.appendChild(progressBar);

  // Header: channel avatar + handle + "nu" — like a real story viewer
  const chId = getPhotoChannel(photo.id);
  const ch = (chId && getChannel(chId)) || getGeneralAccount();
  const head = el('div', { cls: 'hype-story-header' });
  head.style.setProperty('--ch-color', ch.color || '#00b2ff');
  head.innerHTML =
    `<span class="hype-story-avatar">${monogramAvatar(ch.name, ch.color, 38, ch.avatar_url || ch.avatarUrl || '')}</span>` +
    `<span class="hype-story-handle">${ch.handle} <span class="hype-story-verified">${icon.verified(14)}</span></span>` +
    `<span class="hype-story-time">nu</span>`;
  root.appendChild(head);

  const wrap = el('div', { cls: 'hype-story-wrap' });
  const img  = el('img', { src: photoUrl(photo), alt: photo.name });
  img.dataset.photoId = photo.id;
  img.dataset.hypeChromeSkip = '1';
  applySmartFit(img, photo, false);
  wrap.appendChild(img);
  root.appendChild(wrap);

  // Footer: caption + live like count
  const foot = el('div', { cls: 'hype-story-foot' });
  foot.appendChild(el('div', {
    cls: 'hype-story-caption',
    text: chId ? `nieuwe story van ${ch.name} — live op De Hype` : 'live op De Hype — #kamplive',
  }));
  const like = el('div', { cls: 'hype-story-like' });
  like.innerHTML = icon.heartFill(22);
  like.appendChild(el('span', { text: fmtCount(getPhotoLikes(photo.id)) }));
  foot.appendChild(like);
  root.appendChild(foot);

  return {
    el: root,
    visibleIds: [photo.id],
    startMotion: (durationMs) => {
      // Progress bar only — no Ken Burns: the photo is contain-fit inside
      // the safe area and zooming would push it under the top/bottom bars.
      progressFill.style.transition = `transform ${durationMs}ms linear`;
      // Force a reflow so the scaleX(0) start state is committed first —
      // otherwise the browser may coalesce insert+transition+transform into
      // one style pass and the bar just appears full.
      void progressFill.offsetWidth;
      progressFill.style.transform = 'scaleX(1)';
    },
  };
}
