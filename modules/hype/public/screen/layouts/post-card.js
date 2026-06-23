import { el, photoUrl } from '/shared/utils.js';
import { applySmartFit } from '/screen/fit.js';
import { startKenBurns } from '/screen/transitions.js';
import {
  getChannel,
  getGeneralAccount,
  getPhotoChannel,
  getPhotoLikes,
  getRecentComments,
} from '../state-client.js';
import { fmtCount } from '../format.js';
import { icon } from '../icons.js';

export const layout = {
  id:        'hype:post-card',
  name:      'hype:post-card',
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
  const root = el('div', { cls: 'layout layout-hype-post-card' });
  if (!photo) return { el: root, visibleIds: [], startMotion: () => {} };

  const channelId = getPhotoChannel(photo.id);
  const actor = (channelId && getChannel(channelId)) || getGeneralAccount();
  const likes = getPhotoLikes(photo.id);
  const comments = getRecentComments(photo.id, 1);
  root.style.setProperty('--ch-color', actor.color || '#00b2ff');

  const card = el('article', { cls: 'hype-post-card' });
  const img = el('img', { src: photoUrl(photo), alt: photo.name || '' });
  img.dataset.photoId = photo.id;
  applySmartFit(img, photo, false);

  card.appendChild(el('header', { cls: 'hype-post-head' },
    _avatar(actor),
    el('div', { cls: 'hype-post-meta' },
      el('strong', { text: actor.name || 'Scouting Ridder Fulco' }),
      el('span', { text: `${actor.handle || '@scoutingridderfulco'} · live van het kamp` }),
    ),
    el('span', { cls: 'hype-post-live', text: 'live' }),
  ));

  card.appendChild(el('div', { cls: 'hype-post-photo' }, img, _sticker(channelId)));

  card.appendChild(el('p', { cls: 'hype-post-caption', text: _caption(channelId) }));
  card.appendChild(el('footer', { cls: 'hype-post-reactions' },
    _reaction('heartFill', fmtCount(likes), 'vindt dit hype'),
    _reaction('comment', fmtCount(Math.max(comments.length, Math.round(likes / 15))), 'reacties'),
    _reaction('flame', fmtCount(Math.max(1, Math.round(likes / 5))), 'hype'),
    _reaction('send', 'deel', ''),
  ));

  if (comments[0]) {
    card.appendChild(el('div', { cls: 'hype-post-bubble' },
      el('strong', { text: comments[0].author || 'De Hype' }),
      el('span', { text: comments[0].text || '' }),
    ));
  }

  root.appendChild(el('div', { cls: 'hype-post-brand' },
    el('img', { src: '/themes/hype/assets/logo.svg', alt: 'de HYPE!' }),
  ));
  root.appendChild(card);
  root.appendChild(el('div', { cls: 'hype-post-tape hype-post-tape-yellow', text: 'live. deel. hype.' }));
  root.appendChild(el('div', { cls: 'hype-post-tape hype-post-tape-pink', text: 'top post' }));

  return {
    el: root,
    visibleIds: [photo.id],
    startMotion: (durationMs) => startKenBurns(img, durationMs),
  };
}

function _avatar(actor) {
  const avatar = el('div', { cls: 'hype-post-avatar', text: _initial(actor.name || actor.handle) });
  if (actor.avatarUrl || actor.avatar_url) {
    avatar.textContent = '';
    avatar.appendChild(el('img', { src: actor.avatarUrl || actor.avatar_url, alt: '' }));
  } else {
    const iconName = _channelIcon(actor.id);
    avatar.textContent = '';
    avatar.innerHTML = icon[iconName] ? icon[iconName](34) : icon.compass(34);
  }
  return avatar;
}

function _initial(value) {
  return String(value || '?').trim().charAt(0).toUpperCase() || '?';
}

function _channelIcon(channelId) {
  if (channelId === 'chnl_natuur') return 'paw';
  if (channelId === 'chnl_kook') return 'chefHat';
  if (channelId === 'chnl_game') return 'gamepad';
  if (channelId === 'chnl_beauty') return 'sparkles';
  if (channelId === 'chnl_fit') return 'dumbbell';
  return 'compass';
}

function _reaction(iconName, value, label) {
  const node = el('div', { cls: `hype-post-reaction ${iconName}` });
  node.innerHTML = icon[iconName] ? icon[iconName](28) : '';
  node.appendChild(el('div', {},
    el('strong', { text: value }),
    label ? el('span', { text: label }) : null,
  ));
  return node;
}

function _caption(channelId) {
  if (channelId) return 'Nieuwe creator post vanaf het kamp.';
  return 'Jouw kamp. Jouw momenten. Altijd hype.';
}

function _sticker(channelId) {
  const text = channelId ? 'top post' : 'scouting 24/7';
  return el('div', { cls: 'hype-post-sticker', text });
}
