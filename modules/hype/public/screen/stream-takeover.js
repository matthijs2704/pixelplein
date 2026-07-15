// hype:stream — fullscreen stream overlay. Active whenever stream.enabled
// is true, independent of dashboard mode.

import { el } from '/shared/utils.js';
import { emitScreenEvent } from '/screen/module-registry.js';
import {
  getSettings,
  getStreamChat,
  getVideos,
  onHypeChange,
} from './state-client.js';
import { fmtCount } from './format.js';
import { icon } from './icons.js';

(function _loadStreamStyle() {
  if (document.getElementById('hype-stream-style')) return;
  const link = document.createElement('link');
  link.id = 'hype-stream-style';
  link.rel = 'stylesheet';
  link.href = '/modules/hype/screen/stream.css';
  document.head.appendChild(link);
}());

let _streamStartedAt   = 0;
let _streamUptimeTimer = null;
let _reactionTimer     = null;
let _cameraDeviceChangeHandler = null;

const _VIEWER_COLORS = [
  '#2bc1ff','#f5d904','#ff7a45','#a78bfa',
  '#34d399','#fb7185','#60a5fa','#c084fc','#fbbf24',
];

const _REACTION_EMOJIS = ['❤️','🔥','😍','👏','🙌','💯','✨','😂','🎉','💪','🤩','💀'];

function _authorColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return _VIEWER_COLORS[h % _VIEWER_COLORS.length];
}

function _authorInitial(name) {
  return String(name || '?').replace(/^[@\s]+/, '')[0]?.toUpperCase() || '?';
}

function _fmtUptime() {
  const s = Math.floor((Date.now() - _streamStartedAt) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

function _svg(name, size = 18) {
  const wrap = document.createElement('span');
  wrap.innerHTML = icon[name] ? icon[name](size) : '';
  return wrap.firstElementChild || document.createTextNode('');
}

function _streamSourceKey(stream) {
  return `${stream?.sourceType}:${stream?.videoId || ''}:${stream?.url || ''}:${stream?.deviceId || ''}`;
}

function _streamTitle(settings) {
  // Sidecar-titel (live gegenereerd) wint van de statisch geconfigureerde.
  return settings.streamStats?.title
    || settings.stream?.title
    || settings.stream?.subtitle
    || 'live vanaf het kamp';
}

function _viewerCount(settings) {
  return (settings.streamStats && settings.streamStats.viewers) || 0;
}

function _streamStandby(title, subtitle) {
  return el('div', { cls: 'hype-stream-standby' },
    el('img', { cls: 'hype-stream-standby-logo', src: '/themes/hype/assets/logo.svg', alt: 'De Hype' }),
    el('div', {},
      el('strong', { text: title }),
      el('span', { text: subtitle }),
    ),
  );
}

async function _startCamera(video, deviceId) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('camera unavailable');
  const videoConstraints = {
    width:     { ideal: 1920 },
    height:    { ideal: 1080 },
    frameRate: { ideal: 30 },
  };
  if (deviceId) videoConstraints.deviceId = { exact: deviceId };
  const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
  video.srcObject = stream;
  await video.play();
  return stream;
}

function _stopCameraStage(stage) {
  if (!stage) return;
  if (stage._cameraRetryTimer) {
    clearTimeout(stage._cameraRetryTimer);
    stage._cameraRetryTimer = null;
  }
  const video = stage.querySelector('video');
  const stream = video?.srcObject;
  if (stream && typeof stream.getTracks === 'function') {
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch {}
    }
  }
  if (video) video.srcObject = null;
}

function _cameraHint() {
  return (location.protocol !== 'https:' && location.hostname !== 'localhost')
    ? 'camera vereist HTTPS of localhost'
    : 'controleer toestemming of device-id';
}

function _setCameraStandby(stage, media, title, subtitle) {
  stage.classList.add('stream-error');
  media.querySelector('.hype-stream-standby')?.remove();
  media.appendChild(_streamStandby(title, subtitle));
}

function _scheduleCameraReconnect(stage, media, video, deviceId, reason) {
  if (!stage.isConnected) return;
  if (stage._cameraRetryTimer) return;

  const attempts = Number(stage.dataset.cameraAttempts || 0) + 1;
  stage.dataset.cameraAttempts = String(attempts);
  const delay = Math.min(15000, 1500 * attempts);

  _setCameraStandby(stage, media, 'camera opnieuw verbinden', reason || _cameraHint());
  stage._cameraRetryTimer = setTimeout(() => {
    stage._cameraRetryTimer = null;
    _connectCamera(stage, media, video, deviceId);
  }, delay);
}

async function _connectCamera(stage, media, video, deviceId) {
  try {
    _stopCameraStage(stage);
    const stream = await _startCamera(video, deviceId);
    stage.classList.remove('stream-error');
    stage.dataset.cameraAttempts = '0';
    media.querySelector('.hype-stream-standby')?.remove();

    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        _scheduleCameraReconnect(stage, media, video, deviceId, 'camera losgekoppeld');
      }, { once: true });
      track.addEventListener('mute', () => {
        _scheduleCameraReconnect(stage, media, video, deviceId, 'camera tijdelijk niet beschikbaar');
      }, { once: true });
    }
  } catch (err) {
    _scheduleCameraReconnect(stage, media, video, deviceId, err?.message || _cameraHint());
  }
}

function _buildStreamStage(settings) {
  if (!_streamStartedAt) _streamStartedAt = Date.now();
  const videos = getVideos();
  const stream  = settings.stream || {};
  const streamVideo = videos.find(v => v.id === stream.videoId)
    || videos.find(v => v.active && v.placement === 'stream')
    || null;

  const stage = el('section', { cls: 'hype-stream-live' });
  stage.dataset.sourceKey = _streamSourceKey(stream);

  // Media background
  const media = el('div', { cls: 'hype-stream-media' });
  if (stream.sourceType === 'camera') {
    const video = el('video', { attrs: { autoplay: '', muted: '', playsinline: '' } });
    video.muted = true; video.defaultMuted = true; video.playsInline = true;
    media.appendChild(video);
    _connectCamera(stage, media, video, stream.deviceId);
  } else if (stream.sourceType === 'url' && stream.url) {
    const video = el('video', { attrs: { autoplay: '', muted: '', playsinline: '', preload: 'auto' } });
    video.muted = true; video.defaultMuted = true; video.playsInline = true;
    video.src = stream.url;
    media.appendChild(video);
    setTimeout(() => video.play().catch(() => {}), 0);
  } else if (streamVideo && streamVideo.filename) {
    const video = el('video', { attrs: { autoplay: '', muted: '', playsinline: '', loop: '', preload: 'auto' } });
    video.muted = true; video.defaultMuted = true; video.playsInline = true; video.loop = true;
    video.src = `/slide-assets/videos/${encodeURIComponent(streamVideo.filename)}`;
    media.appendChild(video);
    setTimeout(() => video.play().catch(() => {}), 0);
  } else {
    stage.classList.add('stream-standby');
    media.appendChild(_streamStandby('stream standby', 'zet een video, stream-url of camera aan'));
  }
  stage.appendChild(media);

  // Vignette
  stage.appendChild(el('div', { cls: 'hype-stream-vignette' }));

  // Top bar: logo | LIVE badge | viewers | uptime | title
  stage.appendChild(el('div', { cls: 'hype-stream-top' },
    el('div', { cls: 'hype-stream-platform' },
      el('img', { cls: 'hype-stream-platform-logo', src: '/themes/hype/assets/logo.svg', alt: 'De Hype' }),
    ),
    el('div', { cls: 'hype-stream-live-badge' },
      el('span', { cls: 'hype-stream-live-dot' }),
      el('span', { text: 'LIVE' }),
    ),
    el('div', { cls: 'hype-stream-viewers', data: { stat: 'viewers' } },
      el('span', { cls: 'hype-stream-viewer-icon' }, _svg('eye', 14)),
      el('span', { text: fmtCount(_viewerCount(settings)) }),
    ),
    el('div', { cls: 'hype-stream-uptime-pill', text: _fmtUptime() }),
    el('div', { cls: 'hype-stream-title-pill' },
      el('span', { data: { streamTitle: '' }, text: _streamTitle(settings) }),
    ),
  ));

  // Chat sidebar
  stage.appendChild(_streamChatOverlay(settings));

  // Floating reactions column
  stage.appendChild(el('div', { cls: 'hype-stream-reactions' }));

  // Toast notifications
  stage.appendChild(el('div', { cls: 'hype-stream-toasts' }));

  return stage;
}

function _spawnReaction(stage) {
  const container = stage.querySelector('.hype-stream-reactions');
  if (!container) return;
  const emoji = _REACTION_EMOJIS[Math.floor(Math.random() * _REACTION_EMOJIS.length)];
  const float = el('span', { cls: 'hype-stream-float', text: emoji });
  const dur = 2.4 + Math.random() * 1.2;
  float.style.setProperty('--x', `${10 + Math.random() * 80}%`);
  float.style.setProperty('--dur', `${dur}s`);
  float.style.setProperty('--tilt', `${-15 + Math.random() * 30}deg`);
  container.appendChild(float);
  setTimeout(() => float.remove(), dur * 1000 + 100);
}

function _refreshOverlays(root) {
  const stage = root.querySelector('.hype-stream-live');
  if (!stage) return;
  const settings = getSettings();

  const titleEl = stage.querySelector('[data-stream-title]');
  if (titleEl) titleEl.textContent = _streamTitle(settings);

  const vEl = stage.querySelector('[data-stat="viewers"] span:last-child');
  if (vEl) vEl.textContent = fmtCount(_viewerCount(settings));

  const chat = stage.querySelector('.hype-stream-chat');
  if (chat) {
    _syncStreamChat(chat);
    const onlineEl = chat.querySelector('[data-chat-online]');
    if (onlineEl) onlineEl.textContent = fmtCount(_viewerCount(settings));
  }
}

function _retryVisibleCamera(root) {
  const stage = root.querySelector('.hype-stream-live[data-source-key^="camera:"]');
  if (!stage) return;
  const media = stage.querySelector('.hype-stream-media');
  const video = media?.querySelector('video');
  const stream = getSettings().stream || {};
  if (!media || !video || stream.sourceType !== 'camera') return;
  _scheduleCameraReconnect(stage, media, video, stream.deviceId, 'camera opnieuw gedetecteerd');
}

function _cleanupStreamRoot(root) {
  root.querySelectorAll('.hype-stream-live').forEach(stage => _stopCameraStage(stage));
}

function _teardownStreamRoot(root) {
  _cleanupStreamRoot(root);
  root.innerHTML = '';
  root.remove();
  document.body.classList.remove('hype-stream-mode');
}

function _render(root) {
  _cleanupStreamRoot(root);
  root.innerHTML = '';
  const settings = getSettings();
  if (!settings.stream?.enabled) {
    document.body.classList.remove('hype-stream-mode');
    return;
  }
  document.body.classList.toggle('hype-stream-mode', Boolean(settings.stream?.enabled));
  root.appendChild(_buildStreamStage(settings));
}

function _streamChatOverlay(settings) {
  const chat = el('aside', { cls: 'hype-stream-chat' });

  chat.appendChild(el('div', { cls: 'hype-stream-chat-platform' },
    el('div', { cls: 'hype-stream-chat-brand' },
      el('img', { cls: 'hype-stream-chat-brand-logo', src: '/themes/hype/assets/logo.svg', alt: 'De Hype' }),
      el('span', { cls: 'hype-stream-chat-brand-label', text: 'Live Chat' }),
    ),
    el('div', { cls: 'hype-stream-chat-follow-btn' }, el('span', { text: '+ Volg' })),
  ));

  chat.appendChild(el('div', { cls: 'hype-stream-chat-head' },
    el('div', { cls: 'hype-stream-chat-title' },
      _svg('comment', 14),
      el('span', { text: 'Stream chat' }),
    ),
    el('div', { cls: 'hype-stream-chat-meta' },
      el('span', { cls: 'hype-stream-chat-dot' }),
      el('span', { cls: 'hype-stream-chat-online-lbl', data: { chatOnline: '' },
        text: fmtCount(_viewerCount(settings)) }),
      el('span', { cls: 'hype-stream-chat-online-txt', text: 'online' }),
    ),
  ));

  chat.appendChild(el('div', { cls: 'hype-stream-chat-list' }));
  chat.appendChild(el('div', { cls: 'hype-stream-chat-inputbar' },
    el('div', { cls: 'hype-stream-chat-inputfield' },
      el('span', { cls: 'hype-stream-chat-placeholder', text: 'Stuur een bericht…' }),
    ),
    el('button', { cls: 'hype-stream-chat-sendbtn',
      attrs: { 'aria-hidden': 'true', tabindex: '-1' } },
      _svg('send', 14),
    ),
  ));

  _syncStreamChat(chat);
  return chat;
}

function _chatItems() {
  return getStreamChat(40).map(m => ({
    // deleted in de key: de rij wordt dan vervangen i.p.v. genegeerd
    key: String(m.id) + (m.deleted ? ':del' : ''),
    kind: m.deleted ? 'deleted' : m.type === 'join' ? 'join' : (m.mod ? 'mod' : 'viewer'),
    author: String(m.username || '?'),
    text: m.deleted ? '' : m.type === 'join' ? 'kijkt nu mee' : String(m.text || ''),
    color: m.color || null,
    deleted: !!m.deleted,
  }));
}

function _sidecarFresh() {
  const stats = getSettings().streamStats || {};
  return stats.source === 'sidecar' && (Date.now() - (stats.updatedAt || 0)) < 15000;
}

function _syncStreamChat(chat) {
  const items = _chatItems();
  const list = chat.querySelector('.hype-stream-chat-list');
  if (!list) return;

  if (!items.length) {
    // Sidecar actief maar nog niks → warmt op. Geen sidecar → in-universe
    // nep-storing die de "we zijn viral"-fictie versterkt i.p.v. verraadt.
    const text = _sidecarFresh()
      ? 'chat warmt op...'
      : '⚠️ chat overbelast — te veel kijkers tegelijk, opnieuw verbinden…';
    list.replaceChildren(el('div', { cls: 'hype-stream-chat-empty', text }));
    return;
  }
  for (const node of Array.from(list.querySelectorAll('.hype-stream-chat-empty'))) node.remove();

  const wanted = new Set(items.map(i => i.key));
  for (const row of Array.from(list.querySelectorAll('[data-key]'))) {
    if (!wanted.has(row.dataset.key)) row.remove();
  }

  const isInitialFill = !list.dataset.filled;
  let newChatRows = 0;

  items.forEach((item, index) => {
    let row = list.querySelector(`[data-key="${CSS.escape(item.key)}"]`);
    if (!row) {
      row = _streamChatRow(item);
      row.classList.add('is-new');
      setTimeout(() => row.classList.remove('is-new'), 600);
      if (item.kind !== 'join') newChatRows++;
    }
    const keyedRows = Array.from(list.querySelectorAll('[data-key]'));
    const current = keyedRows[index];
    if (current !== row) list.insertBefore(row, current || null);
  });

  list.dataset.filled = '1';

  if (!isInitialFill && newChatRows) {
    const stage = chat.closest('.hype-stream-live');
    if (stage) {
      const bursts = Math.min(4, newChatRows + (Math.random() < 0.4 ? 1 : 0));
      for (let i = 0; i < bursts; i++) {
        setTimeout(() => _spawnReaction(stage), Math.random() * 900);
      }
    }
  }
}

const _CHAT_BADGES = { mod: '🛡️' };

function _streamChatRow(item) {
  const { kind, author, text, color } = item;
  const isJoin = kind === 'join';
  const isDeleted = kind === 'deleted';

  const nameColor = color
    ? color
    : kind === 'mod' ? '#cba6ff'
    : _authorColor(author);

  const avatarEl = el('div', { cls: 'hype-stream-chat-avatar' });
  avatarEl.style.setProperty('--av-color', nameColor);
  if (isJoin)         { avatarEl.classList.add('system'); avatarEl.textContent = '👋'; }
  else if (isDeleted) { avatarEl.classList.add('system'); avatarEl.textContent = '⛔'; }
  else                { avatarEl.textContent = _authorInitial(author); }

  const authorEl = el('span', { cls: 'hype-stream-chat-author', text: author });
  authorEl.style.color = nameColor;

  const bodyEl = el('span', { cls: 'hype-stream-chat-body' });
  if (_CHAT_BADGES[kind]) bodyEl.appendChild(el('span', { cls: 'hype-stream-chat-badge', text: _CHAT_BADGES[kind] }));
  bodyEl.append(
    authorEl,
    el('span', { cls: 'hype-stream-chat-colon', text: (isJoin || isDeleted) ? '' : ':' }),
    el('span', { cls: 'hype-stream-chat-text', text:
      isJoin ? ' kijkt nu mee' : isDeleted ? ' — bericht verwijderd door moderatie' : text }),
  );

  const row = el('div', {
    cls: `hype-stream-chat-row ${isJoin ? 'system join' : isDeleted ? 'system deleted' : kind}`,
  }, avatarEl, bodyEl);
  row.dataset.key = item.key;
  return row;
}

export const streamTakeover = {
  id: 'hype:stream',
  active() {
    return Boolean(getSettings().stream?.enabled);
  },
  async build() {
    const root = el('div', { cls: 'hype-social-root' });
    _render(root);
    let off = null;
    return {
      el: root,
      visibleIds: [],
      duration: 2147480000,
      startMotion() {
        if (!_streamStartedAt) _streamStartedAt = Date.now();
        _streamUptimeTimer = setInterval(() => {
          const upEl = document.querySelector('.hype-stream-uptime-pill');
          if (upEl) upEl.textContent = _fmtUptime();
        }, 1000);
        _reactionTimer = setInterval(() => {
          const stage = root.querySelector('.hype-stream-live');
          if (stage) _spawnReaction(stage);
        }, 6500);
        off = onHypeChange(() => {
          const settings = getSettings();
          if (!settings.stream?.enabled) {
            _teardownStreamRoot(root);
            emitScreenEvent('layout:request-cycle', { clear: true, reason: 'stream-disabled' });
            return;
          }
          const stage = root.querySelector('.hype-stream-live');
          const sourceUnchanged = stage && stage.dataset.sourceKey === _streamSourceKey(settings.stream);
          if (sourceUnchanged) {
            document.body.classList.add('hype-stream-mode');
            _refreshOverlays(root);
          } else {
            _render(root);
          }
        });
        if (!_cameraDeviceChangeHandler && navigator.mediaDevices?.addEventListener) {
          _cameraDeviceChangeHandler = () => _retryVisibleCamera(root);
          navigator.mediaDevices.addEventListener('devicechange', _cameraDeviceChangeHandler);
        }
      },
      destroy() {
        if (off) off();
        _cleanupStreamRoot(root);
        if (_cameraDeviceChangeHandler && navigator.mediaDevices?.removeEventListener) {
          navigator.mediaDevices.removeEventListener('devicechange', _cameraDeviceChangeHandler);
          _cameraDeviceChangeHandler = null;
        }
        if (_streamUptimeTimer) { clearInterval(_streamUptimeTimer); _streamUptimeTimer = null; }
        if (_reactionTimer)     { clearInterval(_reactionTimer);     _reactionTimer = null; }
        _streamStartedAt = 0;
        document.body.classList.remove('hype-stream-mode');
      },
    };
  },
};
