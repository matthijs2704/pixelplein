// hype:social-only — dashboard takeover. Active when mode==='dashboard'
// or mode==='social-only'. Shows follower race, spotlight, channel ribbon.

import { el } from '/shared/utils.js';
import { photoRegistry } from '/screen/photos.js';
import {
  getAllFollowers,
  getChannels,
  getFollowerCount,
  getPhotoChannel,
  getSettings,
  onHypeChange,
} from './state-client.js';
import { fmtCount } from './format.js';
import { icon } from './icons.js';

function _avatar(account, size = 44) {
  const node = el('div', { cls: 'hype-social-avatar' });
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  node.style.setProperty('--ch-color', (account && account.color) || '#2bc1ff');
  if (account && (account.avatarUrl || account.avatar_url)) {
    node.appendChild(el('img', { src: account.avatarUrl || account.avatar_url, alt: '' }));
  } else {
    const iconName = _channelIcon(account && account.id);
    if (iconName && icon[iconName]) node.innerHTML = icon[iconName](Math.round(size * 0.58));
    else node.innerHTML = icon.compass(Math.round(size * 0.58));
  }
  return node;
}

function _channelIcon(channelId) {
  if (channelId === 'chnl_manager') return 'radio';
  if (channelId === 'chnl_natuur')  return 'paw';
  if (channelId === 'chnl_kook')    return 'chefHat';
  if (channelId === 'chnl_game')    return 'gamepad';
  if (channelId === 'chnl_beauty')  return 'sparkles';
  if (channelId === 'chnl_fit')     return 'dumbbell';
  return 'compass';
}

function _photoList() {
  return Array.from(photoRegistry.values())
    .filter(p => p && p.status === 'ready')
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

function _balancedPhotos(photos) {
  const general = [];
  const influencer = [];
  for (const photo of photos) {
    if (getPhotoChannel(photo.id)) influencer.push(photo);
    else general.push(photo);
  }
  const out = [];
  while (general.length || influencer.length) {
    for (let i = 0; i < 2 && general.length; i++) out.push(general.shift());
    if (influencer.length) out.push(influencer.shift());
  }
  return out;
}

function _isRaceChannel(ch) {
  return ch && ch.race_participant !== false;
}

function _spotlightChannels(settings, channels) {
  const day = Math.max(1, Math.min(6, Number(settings.spotlightDay) || 1));
  const raceChannels = channels.filter(_isRaceChannel);
  const featured = raceChannels.filter(ch => Array.isArray(ch.featured_days) && ch.featured_days.includes(day));
  if (featured.length) return featured.slice(0, 2);
  return raceChannels.slice().sort((a, b) => (getFollowerCount(b.id) | 0) - (getFollowerCount(a.id) | 0)).slice(0, 2);
}

function _spotlightCard(ch, followers) {
  const card = el('article', { cls: 'hype-dash-spot-card' });
  card.style.setProperty('--ch-color', ch.color || '#00b2ff');
  card.appendChild(_avatar(ch, 86));
  card.appendChild(el('div', { cls: 'hype-dash-spot-copy' },
    el('strong', { text: ch.name }),
    el('span', { text: ch.handle }),
  ));
  card.appendChild(el('div', { cls: 'hype-dash-spot-count' },
    el('strong', { text: fmtCount(followers) }),
    el('span', { text: 'volgers' }),
  ));
  card.appendChild(el('div', { cls: 'hype-dash-spot-sticker', text: 'in de spotlight' }));
  return card;
}

function _racePanel(ranked, followers) {
  const max = Math.max(1, ...ranked.map(ch => followers[ch.id] | 0));
  const panel = el('section', { cls: 'hype-dash-race' }, _sectionLabel('follower race'));
  ranked.forEach((ch, index) => {
    const count = followers[ch.id] | 0;
    const row = el('div', { cls: `hype-dash-race-row rank-${index + 1}` });
    row.style.setProperty('--ch-color', ch.color || '#00b2ff');
    row.style.setProperty('--pct', `${Math.max(8, Math.round(count / max * 100))}%`);
    row.append(
      el('span', { cls: 'hype-dash-rank', text: String(index + 1) }),
      _avatar(ch, 48),
      el('div', { cls: 'hype-dash-race-name' },
        el('strong', { text: ch.name }),
        el('span', { text: ch.handle }),
      ),
      el('div', { cls: 'hype-dash-race-bar' }, el('span', {})),
      el('strong', { cls: 'hype-dash-race-count', text: fmtCount(count) }),
    );
    panel.appendChild(row);
  });
  return panel;
}

function _channelRibbon(channels, followers) {
  const ribbon = el('footer', { cls: 'hype-dash-channel-ribbon' });
  for (const ch of channels) {
    const item = el('div', { cls: 'hype-dash-channel-pill' });
    item.style.setProperty('--ch-color', ch.color || '#00b2ff');
    item.append(_avatar(ch, 42), el('div', {}, el('strong', { text: ch.name }), el('span', { text: fmtCount(followers[ch.id] | 0) })));
    ribbon.appendChild(item);
  }
  return ribbon;
}

function _sectionLabel(text) {
  return _paintLabel(text, 'yellow');
}

function _paintLabel(text, tone) {
  return el('div', { cls: `hype-dash-label ${tone || ''}`, text });
}

function _dashDoodles() {
  return el('div', { cls: 'hype-dash-doodles', attrs: { 'aria-hidden': 'true' } },
    _doodle('flame', 'b1'),
    _doodle('sparkles', 'c1'),
    _doodle('trendingUp', 'a1'),
    _doodle('heart', 's1'),
  );
}

function _doodle(iconName, cls) {
  const node = el('span', { cls: `doodle ${cls}` });
  node.innerHTML = icon[iconName] ? icon[iconName](92) : '';
  return node;
}

function _dashboardStage(settings) {
  const followers = getAllFollowers();
  const channels = getChannels();
  const ranked = channels
    .filter(_isRaceChannel)
    .slice()
    .sort((a, b) => (followers[b.id] | 0) - (followers[a.id] | 0));
  const spotlight = _spotlightChannels(settings, channels);
  const top = ranked[0] || null;
  const heat = Math.max(0, Math.min(5, Number(settings.harryHeat) || 0));

  const stage = el('section', { cls: 'hype-dash-stage' });
  stage.appendChild(_dashDoodles());
  stage.appendChild(el('header', { cls: 'hype-dash-hero' },
    el('div', { cls: 'hype-dash-logo-wrap' },
      el('img', { cls: 'hype-dash-logo', src: '/themes/hype/assets/logo.svg', alt: 'de HYPE!' }),
      el('div', { cls: 'hype-dash-tagline', text: 'jouw kamp. jouw momenten. altijd hype.' }),
    ),
    el('div', { cls: 'hype-dash-now' },
      _paintLabel('live dashboard', 'yellow'),
      el('strong', { text: top ? `${top.name} staat bovenaan` : 'kanalen warmen op' }),
      el('span', { text: `Harry heat ${heat}/5` }),
    ),
  ));

  const body = el('div', { cls: 'hype-dash-body' });
  body.appendChild(el('section', { cls: 'hype-dash-spotlight' },
    _sectionLabel('in de spotlight'),
    el('div', { cls: 'hype-dash-spotlight-grid' },
      ...spotlight.map(ch => _spotlightCard(ch, followers[ch.id] | 0)),
    ),
  ));
  body.appendChild(_racePanel(ranked, followers));
  stage.appendChild(body);
  stage.appendChild(_channelRibbon(channels, followers));
  return stage;
}

export const takeover = {
  id: 'hype:social-only',
  active() {
    const mode = getSettings().mode;
    return mode === 'dashboard' || mode === 'social-only';
  },
  async build() {
    const root = el('div', { cls: 'hype-social-root' });
    root.appendChild(_dashboardStage(getSettings()));
    let off = null;
    return {
      el: root,
      visibleIds: _balancedPhotos(_photoList()).slice(0, 10).map(p => p.id),
      duration: 12000,
      startMotion() {
        off = onHypeChange(() => {
          root.innerHTML = '';
          root.appendChild(_dashboardStage(getSettings()));
        });
      },
      destroy() {
        if (off) off();
      },
    };
  },
};
