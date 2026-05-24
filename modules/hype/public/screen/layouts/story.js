// hype:story — single full-bleed photo with Instagram-Stories chrome:
// progress bar at top, channel handle, soft vignette. The chrome overlay
// adds live likes/comments on top of this layout naturally.

import { el, photoUrl } from '/shared/utils.js';
import { applySmartFit } from '/screen/fit.js';
import { startKenBurns } from '/screen/transitions.js';
import { getChannels, getPhotoChannel, getChannel } from '../state-client.js';

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

  const channels = getChannels();
  const chId = getPhotoChannel(photo.id);
  const ch = (chId && getChannel(chId)) || channels[0] || null;

  // Progress bar (decorative — animates with layout duration via CSS var)
  const progressBar = el('div', { cls: 'hype-story-progress' });
  const progressFill = el('div', { cls: 'hype-story-progress-fill' });
  progressBar.appendChild(progressFill);
  root.appendChild(progressBar);

  // Header
  if (ch) {
    const header = el('div', { cls: 'hype-story-header' });
    header.style.setProperty('--ch-color', ch.color || '#7c5cff');
    header.appendChild(el('div', { cls: 'hype-story-avatar', text: ch.emoji || '✨' }));
    header.appendChild(el('div', { cls: 'hype-story-meta' },
      el('div', { cls: 'hype-story-handle', text: ch.handle }),
      el('div', { cls: 'hype-story-time',   text: 'nu' }),
    ));
    root.appendChild(header);
  }

  const wrap = el('div', { cls: 'hype-story-wrap' });
  const img  = el('img', { src: photoUrl(photo), alt: photo.name });
  img.dataset.photoId = photo.id;
  applySmartFit(img, photo, false);
  wrap.appendChild(img);
  root.appendChild(wrap);

  return {
    el: root,
    visibleIds: [photo.id],
    startMotion: (durationMs) => {
      // CSS handles the progress fill via inline transition
      progressFill.style.transition = `transform ${durationMs}ms linear`;
      requestAnimationFrame(() => progressFill.style.transform = 'scaleX(1)');
      startKenBurns(img, durationMs);
    },
  };
}
