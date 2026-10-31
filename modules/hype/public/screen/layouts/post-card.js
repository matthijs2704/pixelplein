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

// Builds one post card for a photo. Shared with hype:duo-post.
export function buildCard(photo) {
  const channelId = getPhotoChannel(photo.id);
  const actor = (channelId && getChannel(channelId)) || getGeneralAccount();
  const likes = getPhotoLikes(photo.id);
  const comments = getRecentComments(photo.id, 1);

  const card = el('article', { cls: 'hype-post-card' });
  card.style.setProperty('--ch-color', actor.color || '#00b2ff');
  const img = el('img', { src: photoUrl(photo), alt: photo.name || '' });
  img.dataset.photoId = photo.id;
  img.dataset.hypeChromeSkip = '1'; // card header + reactions already show identity
  applySmartFit(img, photo, false);

  card.appendChild(el('header', { cls: 'hype-post-head' },
    _avatar(actor),
    el('div', { cls: 'hype-post-meta' },
      el('strong', { text: actor.name }),
      el('span', { text: `${actor.handle} · live van het kamp` }),
    ),
    el('span', { cls: 'hype-post-live', text: 'live' }),
  ));

  card.appendChild(el('div', { cls: 'hype-post-photo' }, img));

  card.appendChild(el('p', { cls: 'hype-post-caption', text: _caption(channelId, photo.id) }));
  // Hype count: derived from likes plus a per-photo seeded offset, so posts
  // differ even while like counts are still low (early in the week every
  // post showed exactly "1 hype").
  const hypeSeed = _seed(photo.id) % 7;
  card.appendChild(el('footer', { cls: 'hype-post-reactions' },
    _reaction('heartFill', fmtCount(likes), 'vindt dit leuk'),
    _reaction('comment', fmtCount(Math.max(comments.length, Math.round(likes / 15))), 'reacties'),
    _reaction('flame', fmtCount(Math.max(1, Math.round(likes / 5) + hypeSeed)), 'hype'),
    _reaction('send', 'deel', ''),
  ));

  if (comments[0]) {
    card.appendChild(el('div', { cls: 'hype-post-bubble' },
      el('strong', { text: comments[0].author || 'De Hype' }),
      el('span', { text: comments[0].text || '' }),
    ));
  }

  return { card, img };
}

function _build(photo) {
  const root = el('div', { cls: 'layout layout-hype-post-card' });
  if (!photo) return { el: root, visibleIds: [], startMotion: () => {} };

  const { card, img } = buildCard(photo);
  root.style.setProperty('--ch-color', card.style.getPropertyValue('--ch-color'));
  // No brand logo or tape stickers here — the theme frame already brands the
  // screen; the card should read as a clean post.
  root.appendChild(card);

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

// Caption pools — picked per photo (seeded) so a photo keeps its caption.
const CAPTIONS_CHANNEL = [
  'Nieuwe drop 🔥 #kamplive',
  'Vandaag gedraaid op het kamp 🎬',
  'Dit moet je zien!! 👀',
  'Contentdag met de crew 📸',
  'Achter de schermen 🤫 #kamplive',
];
const CAPTIONS_GENERAL = [
  'Vandaag op kamp 🏕️ #kamplive',
  'Dit wil je niet missen! 🔥',
  'Live vanaf het kampterrein 📸',
  'Weer een topdag met z\'n allen 💛',
  'Kampleven op z\'n best 🌲',
];

function _seed(photoId) {
  let h = 0;
  const seed = String(photoId || '');
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

function _caption(channelId, photoId) {
  const pool = channelId ? CAPTIONS_CHANNEL : CAPTIONS_GENERAL;
  return pool[_seed(photoId) % pool.length];
}

