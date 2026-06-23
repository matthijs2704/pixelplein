import { el, photoUrl } from '/shared/utils.js';
import { photoRegistry } from '/screen/photos.js';
import {
  getActivity,
  getAllFollowers,
  getChannels,
  getFollowerCount,
  getGeneralAccount,
  getPhotoChannel,
  getPhotoLikes,
  getSettings,
  getVideos,
  onHypeChange,
} from './state-client.js';
import { fmtCount } from './format.js';
import { icon } from './icons.js';

function _initial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

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
  if (channelId === 'chnl_natuur') return 'paw';
  if (channelId === 'chnl_kook') return 'chefHat';
  if (channelId === 'chnl_game') return 'gamepad';
  if (channelId === 'chnl_beauty') return 'sparkles';
  if (channelId === 'chnl_fit') return 'dumbbell';
  return 'compass';
}

function _photoList() {
  return Array.from(photoRegistry.values())
    .filter(p => p && p.status === 'ready')
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

function _actorForPhoto(photoId) {
  const channelId = getPhotoChannel(photoId);
  const ch = channelId ? getChannels().find(c => c.id === channelId) : null;
  return ch || getGeneralAccount();
}

function _postCard(photo) {
  const actor = _actorForPhoto(photo.id);
  const channelId = getPhotoChannel(photo.id);
  const likes = getPhotoLikes(photo.id);
  const card = el('article', { cls: 'hype-social-post' });
  card.style.setProperty('--ch-color', actor.color || '#2bc1ff');

  const img = el('img', { src: photoUrl(photo), alt: '' });
  img.dataset.photoId = photo.id;

  card.appendChild(el('header', { cls: 'hype-social-post-head' },
    _avatar(actor, 42),
    el('div', { cls: 'hype-social-post-meta' },
      el('div', { cls: 'hype-social-handle', text: actor.handle || '@kamp_live' }),
      el('div', { cls: 'hype-social-name', text: channelId ? 'challenge post' : 'kamp update' }),
    ),
    el('div', { cls: 'hype-social-post-icon' }, _svg('more')),
  ));
  card.appendChild(el('div', { cls: 'hype-social-photo' }, img));
  card.appendChild(el('footer', { cls: 'hype-social-post-foot' },
    el('span', { cls: 'hype-social-foot-icon', attrs: { title: 'likes' } }, _svg('heart')),
    el('strong', { text: fmtCount(likes) }),
    el('span', { cls: 'hype-social-caption', text: channelId ? 'geholpen door de welpen' : 'live vanaf het kamp' }),
  ));
  return card;
}

function _svg(name) {
  const wrap = document.createElement('span');
  wrap.innerHTML = icon[name] ? icon[name](18) : '';
  return wrap.firstElementChild || document.createTextNode('');
}

function _rankPanel() {
  const followers = getAllFollowers();
  const channels = getChannels()
    .filter(_isRaceChannel)
    .slice()
    .sort((a, b) => (followers[b.id] | 0) - (followers[a.id] | 0));
  const panel = el('section', { cls: 'hype-social-panel hype-social-race' },
    el('div', { cls: 'hype-social-panel-title', text: 'Influencer race' }),
  );
  for (const ch of channels) {
    panel.appendChild(el('div', { cls: 'hype-social-rank-row' },
      _avatar(ch, 34),
      el('div', { cls: 'hype-social-rank-name' },
        el('strong', { text: ch.name }),
        el('span', { text: ch.handle }),
      ),
      el('div', { cls: 'hype-social-rank-count', text: fmtCount(followers[ch.id]) }),
    ));
  }
  return panel;
}

function _activityPanel() {
  const panel = el('section', { cls: 'hype-social-panel hype-social-activity' },
    el('div', { cls: 'hype-social-panel-title', text: 'Live chat' }),
  );
  const items = getActivity(16);
  for (const item of items) {
    panel.appendChild(el('div', { cls: `hype-social-activity-row ${item.actor_type || ''}` },
      el('span', { cls: 'hype-social-activity-kind', text: item.kind || 'live' }),
      el('span', { cls: 'hype-social-activity-text', text: item.text }),
    ));
  }
  return panel;
}

function _streamPanel() {
  const videos = getVideos().filter(v => v.active && v.placement === 'stream');
  const video = videos[0] || null;
  const panel = el('section', { cls: 'hype-social-panel hype-social-stream' },
    el('div', { cls: 'hype-social-panel-title', text: 'Live stream' }),
  );
  if (video && video.filename) {
    const vid = el('video', { attrs: { autoplay: '', muted: '', playsinline: '', loop: '', preload: 'metadata' } });
    vid.muted = true;
    vid.defaultMuted = true;
    vid.playsInline = true;
    vid.loop = true;
    vid.src = `/slide-assets/videos/${encodeURIComponent(video.filename)}`;
    panel.appendChild(el('div', { cls: 'hype-social-video' }, vid));
    setTimeout(() => vid.play().catch(() => {}), 0);
  } else {
    panel.appendChild(el('div', { cls: 'hype-social-stream-empty' }, _svg('reels'), el('span', { text: 'stream standby' })));
  }
  return panel;
}

function _statusBar() {
  return el('div', { cls: 'hype-social-status' },
    el('div', { cls: 'hype-social-brand', text: 'De Hype' }),
    el('div', { cls: 'hype-social-phase', text: 'live kampfeed' }),
  );
}

function _render(root) {
  const photos = _photoList();
  root.innerHTML = '';
  const settings = getSettings();
  const stream = settings.stream || {};
  _syncStreamBodyClass(Boolean(stream.enabled));
  if (stream.enabled) {
    root.appendChild(_fullscreenStream(settings));
    return;
  }
  root.appendChild(_dashboardStage(settings));
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
  body.appendChild(_buzzPanel(settings));
  stage.appendChild(body);
  stage.appendChild(_channelRibbon(channels, followers));
  return stage;
}

function _spotlightChannels(settings, channels) {
  const day = Math.max(1, Math.min(6, Number(settings.spotlightDay) || 1));
  const raceChannels = channels.filter(_isRaceChannel);
  const featured = raceChannels.filter(ch => Array.isArray(ch.featured_days) && ch.featured_days.includes(day));
  if (featured.length) return featured.slice(0, 2);
  return raceChannels.slice().sort((a, b) => (getFollowerCount(b.id) | 0) - (getFollowerCount(a.id) | 0)).slice(0, 2);
}

function _isRaceChannel(ch) {
  return ch && ch.race_participant !== false;
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

function _buzzPanel(settings) {
  const panel = el('aside', { cls: 'hype-dash-buzz' }, _sectionLabel('live buzz'));
  const activity = getActivity(8);
  const stats = settings.streamStats || {};
  panel.appendChild(el('div', { cls: 'hype-dash-stats' },
    _stat('online', fmtCount(stats.online || 247)),
    _stat('kijkt mee', fmtCount(stats.viewers || 88)),
    _stat('heat', `${Number(settings.harryHeat) || 0}/5`),
  ));
  const list = el('div', { cls: 'hype-dash-buzz-list' });
  for (const item of activity) {
    list.appendChild(el('div', { cls: `hype-dash-buzz-row ${item.actor_type || ''}` },
      el('span', { cls: 'hype-dash-buzz-kind', text: item.actor_type === 'harry' ? 'harry' : item.kind || 'live' }),
      el('span', { cls: 'hype-dash-buzz-text', text: item.text || '' }),
    ));
  }
  if (!activity.length) {
    list.appendChild(el('div', { cls: 'hype-dash-buzz-row' },
      el('span', { cls: 'hype-dash-buzz-kind', text: 'live' }),
      el('span', { cls: 'hype-dash-buzz-text', text: 'De Hype warmt op...' }),
    ));
  }
  panel.appendChild(list);
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

function _stat(label, value) {
  return el('div', { cls: 'hype-dash-stat' }, el('strong', { text: value }), el('span', { text: label }));
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

function _fullscreenStream(settings) {
  const videos = getVideos();
  const stream = settings.stream || {};
  const streamVideo = videos.find(v => v.id === stream.videoId)
    || videos.find(v => v.active && v.placement === 'stream')
    || null;
  const stage = el('section', { cls: 'hype-stream-live' });
  const media = el('div', { cls: 'hype-stream-media' });
  const sourceLabel = _streamSourceLabel(stream.sourceType);
  if (stream.sourceType === 'camera') {
    const video = el('video', { attrs: { autoplay: '', muted: '', playsinline: '' } });
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    media.appendChild(video);
    _startCamera(video, stream.deviceId).catch(() => {
      stage.classList.add('stream-error');
      stage.appendChild(_streamState('camera niet beschikbaar', 'controleer toestemming of device-id'));
    });
  } else if (stream.sourceType === 'url' && stream.url) {
    const video = el('video', { attrs: { autoplay: '', muted: '', playsinline: '', preload: 'auto' } });
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.src = stream.url;
    media.appendChild(video);
    setTimeout(() => video.play().catch(() => {}), 0);
  } else if (streamVideo && streamVideo.filename) {
    const video = el('video', { attrs: { autoplay: '', muted: '', playsinline: '', loop: '', preload: 'auto' } });
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    video.src = `/slide-assets/videos/${encodeURIComponent(streamVideo.filename)}`;
    media.appendChild(video);
    setTimeout(() => video.play().catch(() => {}), 0);
  } else {
    stage.classList.add('stream-standby');
    media.appendChild(_streamState('stream standby', 'zet een video, stream-url of camera aan'));
  }
  stage.appendChild(media);
  stage.appendChild(el('div', { cls: 'hype-stream-vignette' }));
  stage.appendChild(el('header', { cls: 'hype-stream-live-top' },
    el('div', { cls: 'hype-stream-brand' },
      el('div', { cls: 'hype-stream-brand-mark' }, _svg('radio')),
      el('div', { cls: 'hype-stream-brand-text' },
        el('strong', { text: 'De Hype' }),
        el('span', { text: 'broadcast mode' }),
      ),
    ),
    el('div', { cls: 'hype-stream-live-title' },
      el('strong', { text: stream.title || 'Keuken Live' }),
      el('span', { text: stream.subtitle || 'live vanaf het kamp' }),
    ),
    el('div', { cls: 'hype-stream-stats' },
      el('div', { cls: 'hype-stream-live-badge' }, _svg('radio'), el('span', { text: 'LIVE' })),
      el('div', { cls: 'hype-stream-stat' }, _svg('eye'), el('span', { text: fmtCount(_viewerCount(settings)) })),
      el('div', { cls: 'hype-stream-stat' }, _svg('users'), el('span', { text: fmtCount(_onlineCount(settings)) })),
    ),
  ));
  stage.appendChild(_streamLowerThird(settings, sourceLabel));
  stage.appendChild(_streamChatOverlay());
  return stage;
}

function _refreshStreamOverlays(root) {
  const stage = root.querySelector('.hype-stream-live');
  if (!stage) return;
  const chat = stage.querySelector('.hype-stream-chat');
  if (chat) _syncStreamChat(chat);
  const stats = stage.querySelector('.hype-stream-stats');
  if (stats) {
    const settings = getSettings();
    stats.innerHTML = '';
    stats.append(
      el('div', { cls: 'hype-stream-live-badge' }, _svg('radio'), el('span', { text: 'LIVE' })),
      el('div', { cls: 'hype-stream-stat' }, _svg('eye'), el('span', { text: fmtCount(_viewerCount(settings)) })),
      el('div', { cls: 'hype-stream-stat' }, _svg('users'), el('span', { text: fmtCount(_onlineCount(settings)) })),
    );
  }
}

function _syncStreamBodyClass(active) {
  document.body.classList.toggle('hype-stream-mode', Boolean(active));
}

function _streamSourceLabel(type) {
  if (type === 'camera') return 'camera feed';
  if (type === 'url') return 'external stream';
  return 'video feed';
}

function _viewerCount(settings) {
  return (settings.streamStats && settings.streamStats.viewers) || 0;
}

function _onlineCount(settings) {
  return (settings.streamStats && settings.streamStats.online) || 0;
}

function _streamState(title, subtitle) {
  return el('div', { cls: 'hype-stream-standby' },
    _svg('reels'),
    el('div', {},
      el('strong', { text: title }),
      el('span', { text: subtitle }),
    ),
  );
}

function _streamLowerThird(settings, sourceLabel) {
  const account = settings.generalAccount || getGeneralAccount();
  return el('div', { cls: 'hype-stream-lower' },
    _avatar(account, 58),
    el('div', { cls: 'hype-stream-lower-copy' },
      el('span', { cls: 'hype-stream-kicker', text: sourceLabel }),
      el('strong', { text: account.name || 'Kamp Live' }),
      el('span', { text: `${account.handle || '@kamp_live'} is live op het kamp` }),
    ),
  );
}

async function _startCamera(video, deviceId) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('camera unavailable');
  const constraints = {
    video: deviceId ? { deviceId: { exact: deviceId } } : true,
    audio: false,
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play();
}

function _streamChatOverlay() {
  const items = getActivity(18).filter(i => i.kind === 'chat' || i.kind === 'juice' || i.kind === 'platform');
  const settings = getSettings();
  const chat = el('aside', { cls: 'hype-stream-chat' },
    el('div', { cls: 'hype-stream-chat-head' },
      el('div', { cls: 'hype-stream-chat-title' },
        _svg('comment'),
        el('span', { text: 'Stream chat' }),
      ),
      el('div', { cls: 'hype-stream-chat-online' },
        el('span', { cls: 'hype-stream-chat-dot' }),
        el('span', { text: fmtCount(_onlineCount(settings)) }),
      ),
    ),
    el('div', { cls: 'hype-stream-chat-list' }),
  );
  _syncStreamChat(chat, items);
  return chat;
}

function _syncStreamChat(chat, providedItems = null) {
  const items = (providedItems || getActivity(18).filter(i => i.kind === 'chat' || i.kind === 'juice' || i.kind === 'platform'))
    .slice()
    .reverse();
  const list = chat.querySelector('.hype-stream-chat-list');
  if (!list) return;
  if (!items.length) {
    if (!list.querySelector('.hype-stream-chat-empty')) {
      list.appendChild(el('div', { cls: 'hype-stream-chat-empty', text: 'chat warmt op...' }));
    }
    return;
  }

  for (const node of Array.from(list.querySelectorAll('.hype-stream-chat-empty'))) node.remove();

  const wanted = new Set(items.map(_chatKey));
  for (const row of Array.from(list.querySelectorAll('.hype-stream-chat-row'))) {
    if (!wanted.has(row.dataset.key)) row.remove();
  }

  items.forEach((item, index) => {
    const key = _chatKey(item);
    let row = Array.from(list.querySelectorAll('.hype-stream-chat-row'))
      .find(candidate => candidate.dataset.key === key);
    if (!row) {
      row = _streamChatRow(item, key);
      row.classList.add('is-new');
      setTimeout(() => row.classList.remove('is-new'), 650);
    }
    const current = list.children[index];
    if (current !== row) list.insertBefore(row, current || null);
  });
}

function _chatKey(item) {
  return String(item.id || `${item.kind}:${item.created_at || ''}:${item.text || ''}`);
}

function _streamChatRow(item, key) {
  const parsed = _parseChatText(item.text);
  const kind = _chatKind(item);
  const row = el('div', { cls: `hype-stream-chat-row ${item.actor_type || ''} ${kind}` },
    el('span', { cls: 'hype-stream-chat-body' },
      el('span', { cls: 'hype-stream-chat-author', text: parsed.author }),
      el('span', { cls: 'hype-stream-chat-text', text: parsed.text }),
    ),
  );
  row.dataset.key = key;
  return row;
}

function _chatKind(item) {
  if (item.actor_type === 'harry') return 'harry';
  if (item.kind === 'juice') return 'juice';
  if (item.kind === 'platform') return 'system';
  if (item.actor_type === 'manual') return 'mod';
  return 'viewer';
}

function _parseChatText(text) {
  const raw = String(text || '');
  const idx = raw.indexOf(':');
  if (idx > 0 && idx < 24) {
    return { author: raw.slice(0, idx), text: raw.slice(idx + 1).trim() };
  }
  return { author: 'De Hype', text: raw };
}

function _dayIntroPanel(settings) {
  const account = settings.generalAccount || getGeneralAccount();
  return el('section', { cls: 'hype-social-panel hype-social-intro' },
    el('div', { cls: 'hype-social-panel-title', text: 'Net gelanceerd' }),
    el('div', { cls: 'hype-social-intro-account' },
      _avatar(account, 52),
      el('div', {},
        el('strong', { text: account.name || 'Kamp Live' }),
        el('span', { text: account.handle || '@kamp_live' }),
      ),
    ),
    el('p', { text: 'Het kampaccount is live. De eerste posts verschijnen op het platform.' }),
  );
}

function _awardsPanel() {
  const followers = getAllFollowers();
  const top = getChannels().slice().sort((a, b) => (followers[b.id] | 0) - (followers[a.id] | 0))[0];
  return el('section', { cls: 'hype-social-panel hype-social-awards' },
    el('div', { cls: 'hype-social-panel-title', text: 'Award show' }),
    el('div', { cls: 'hype-social-awards-title', text: top ? `${top.name} staat bovenaan` : 'finale wordt klaargezet' }),
    el('div', { cls: 'hype-social-awards-sub', text: 'de laatste kampmomenten tellen mee' }),
  );
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

export const takeover = {
  id: 'hype:social-only',
  active() {
    const mode = getSettings().mode;
    return mode === 'dashboard' || mode === 'social-only';
  },
  async build() {
    const root = el('div', { cls: 'hype-social-root' });
    const initialSettings = getSettings();
    const startsAsStream = Boolean(initialSettings.stream && initialSettings.stream.enabled);
    _render(root);
    let off = null;
    let timer = null;
    return {
      el: root,
      visibleIds: _balancedPhotos(_photoList()).slice(0, 10).map(p => p.id),
      duration: startsAsStream ? 2147480000 : 12000,
      startMotion() {
        off = onHypeChange(() => {
          const settings = getSettings();
          if (settings.stream && settings.stream.enabled && root.querySelector('.hype-stream-live')) {
            _syncStreamBodyClass(true);
            _refreshStreamOverlays(root);
          } else {
            _render(root);
          }
        });
        timer = setInterval(() => {
          const settings = getSettings();
          if (!settings.stream || !settings.stream.enabled || !root.querySelector('.hype-stream-live')) _render(root);
        }, 5000);
      },
      destroy() {
        if (off) off();
        if (timer) clearInterval(timer);
        _syncStreamBodyClass(false);
      },
    };
  },
};
