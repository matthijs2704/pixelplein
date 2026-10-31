// hype:social-only — dashboard takeover. Active when mode==='dashboard'
// or mode==='social-only'. Shows follower race, spotlight, channel ribbon.

import { el, photoUrl } from '/shared/utils.js';
import { photoRegistry } from '/screen/photos.js';
import {
  getAllFollowers,
  getChannel,
  getChannels,
  getFollowerBaselines,
  getPhotoChannel,
  getPhotoLikes,
  getPhotoViral,
  getSettings,
  onHypeChange,
} from './state-client.js';
import { fmtCount } from './format.js';
import { icon } from './icons.js';

function _avatar(account, size = 44) {
  const node = el('div', { cls: 'hype-social-avatar' });
  // Size in vh (px-equivalent at 1080p) so avatars scale on 1440p/4K.
  node.style.width = `${(size / 10.8).toFixed(2)}vh`;
  node.style.height = `${(size / 10.8).toFixed(2)}vh`;
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

// Kid-facing highlights. Deliberately NOT the spotlight/featured channels —
// that would spoil the mechanic (those channels "happen" to surge tomorrow).
function _highlightsPanel(ranked, followers) {
  const baselines = getFollowerBaselines();
  const climber = ranked.slice().sort((a, b) => {
    const da = (followers[a.id] | 0) - (baselines[a.id] ?? followers[a.id] | 0);
    const db = (followers[b.id] | 0) - (baselines[b.id] ?? followers[b.id] | 0);
    return db - da;
  })[0] || null;
  const climberDelta = climber
    ? (followers[climber.id] | 0) - (baselines[climber.id] ?? followers[climber.id] | 0)
    : 0;
  const total = ranked.reduce((sum, ch) => sum + (followers[ch.id] | 0), 0);
  const gap = ranked.length > 1 ? (followers[ranked[0].id] | 0) - (followers[ranked[1].id] | 0) : 0;

  const panel = el('section', { cls: 'hype-dash-spotlight' }, _sectionLabel('vandaag'));

  if (climber && climberDelta > 0) {
    const card = el('article', { cls: 'hype-dash-spot-card' });
    card.style.setProperty('--ch-color', climber.color || '#00b2ff');
    card.appendChild(_avatar(climber, 86));
    card.appendChild(el('div', { cls: 'hype-dash-spot-copy' },
      el('strong', { text: climber.name }),
      el('span', { text: climber.handle }),
    ));
    card.appendChild(el('div', { cls: 'hype-dash-spot-count' },
      el('strong', { text: `+${fmtCount(climberDelta)}` }),
      el('span', { text: 'volgers erbij' }),
    ));
    card.appendChild(el('div', { cls: 'hype-dash-spot-sticker', text: 'stijger van de dag' }));
    panel.appendChild(card);
  }

  panel.appendChild(el('div', { cls: 'hype-dash-stats' },
    el('div', { cls: 'hype-dash-stat' },
      el('strong', { text: fmtCount(total) }),
      el('span', { text: 'volgers totaal' }),
    ),
    el('div', { cls: 'hype-dash-stat' },
      el('strong', { text: ranked.length > 1 ? fmtCount(Math.max(0, gap)) : '—' }),
      el('span', { text: 'voorsprong #1' }),
    ),
  ));
  return panel;
}

// Hottest posts right now. The engine juices likes/viral automatically in
// the background, so this column moves on its own during the day.
function _viralPanel() {
  const hot = _photoList()
    .map(p => ({ p, likes: getPhotoLikes(p.id), viral: getPhotoViral(p.id) }))
    .filter(x => x.viral || x.likes > 0)
    .sort((a, b) => (b.viral - a.viral) || (b.likes - a.likes))
    .slice(0, 3);

  const panel = el('section', { cls: 'hype-dash-viral' }, _sectionLabel('viral vandaag'));
  if (!hot.length) {
    panel.appendChild(el('div', { cls: 'hype-dash-viral-empty', text: 'nog geen virals — post iets!' }));
    return panel;
  }
  for (const { p, likes, viral } of hot) {
    const ch = getChannel(getPhotoChannel(p.id));
    const card = el('article', { cls: 'hype-dash-viral-card' });
    card.style.setProperty('--ch-color', (ch && ch.color) || '#00b2ff');
    card.appendChild(el('img', { src: photoUrl(p), alt: '' }));
    if (viral) card.appendChild(el('span', { cls: 'hype-dash-viral-badge', text: 'viral' }));
    card.appendChild(el('div', { cls: 'hype-dash-viral-meta' },
      el('strong', { text: `♥ ${fmtCount(likes)}` }),
      el('span', { text: (ch && ch.handle) || '@kamplive' }),
    ));
    panel.appendChild(card);
  }
  return panel;
}

function _racePanel(ranked, followers) {
  const max = Math.max(1, ...ranked.map(ch => followers[ch.id] | 0));
  const baselines = getFollowerBaselines();
  // Yesterday's ranking (by baseline counts) → rank-move arrows.
  const yesterdayRank = new Map(
    ranked.slice()
      .sort((a, b) => (baselines[b.id] ?? followers[b.id] | 0) - (baselines[a.id] ?? followers[a.id] | 0))
      .map((ch, i) => [ch.id, i]),
  );

  const panel = el('section', { cls: 'hype-dash-race' }, _sectionLabel('follower race'));
  ranked.forEach((ch, index) => {
    const count = followers[ch.id] | 0;
    const delta = count - (baselines[ch.id] ?? count);
    const move = (yesterdayRank.get(ch.id) ?? index) - index; // >0 = climbed
    const row = el('div', { cls: `hype-dash-race-row rank-${index + 1}` });
    row.style.setProperty('--ch-color', ch.color || '#00b2ff');
    row.style.setProperty('--pct', `${Math.max(8, Math.round(count / max * 100))}%`);
    row.append(
      el('span', { cls: 'hype-dash-rank', text: String(index + 1) }),
      el('span', {
        cls: `hype-dash-move ${move > 0 ? 'up' : move < 0 ? 'down' : 'flat'}`,
        text: move > 0 ? '▲' : move < 0 ? '▼' : '·',
      }),
      _avatar(ch, 48),
      el('div', { cls: 'hype-dash-race-name' },
        el('strong', { text: ch.name }),
        el('span', { text: ch.handle }),
      ),
      el('div', { cls: 'hype-dash-race-bar' }, el('span', {})),
      el('div', { cls: 'hype-dash-race-nums' },
        el('strong', { cls: 'hype-dash-race-count', text: fmtCount(count) }),
        el('span', { cls: `hype-dash-race-delta ${delta > 0 ? 'up' : ''}`, text: delta > 0 ? `+${fmtCount(delta)} vandaag` : 'nog geen vandaag' }),
      ),
    );
    panel.appendChild(row);
  });
  return panel;
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
  const top = ranked[0] || null;
  const raceStarted = ranked.some(ch => (followers[ch.id] | 0) > 0);

  const stage = el('section', { cls: 'hype-dash-stage' });
  stage.appendChild(_dashDoodles());
  stage.appendChild(el('header', { cls: 'hype-dash-hero' },
    el('div', { cls: 'hype-dash-logo-wrap' },
      el('img', { cls: 'hype-dash-logo', src: '/themes/hype/assets/logo.svg', alt: 'de HYPE!' }),
    ),
    el('div', { cls: 'hype-dash-now' },
      _paintLabel('tussenstand', 'yellow'),
      el('strong', { text: raceStarted && top ? `${top.name} staat bovenaan` : 'de race gaat beginnen!' }),
      el('span', { text: raceStarted ? 'wie pakt de meeste volgers?' : 'iedereen start op 0 volgers' }),
    ),
  ));

  const body = el('div', { cls: 'hype-dash-body' });
  body.appendChild(_highlightsPanel(ranked, followers));
  body.appendChild(_racePanel(ranked, followers));
  body.appendChild(_viralPanel());
  stage.appendChild(body);
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
