// Alert renderer: hype-launch
// Day-1 De Hype launch takeover synced to the 21.96s launch.wav.
//
// Updated timing from /private/tmp/audioanalysis/launch.analysis.json:
//   0.000→4.736  intro buildup: platform standby wakes up
//   4.736→7.616  main: official account + logo reveal around 6.2s
//   7.616→9.472  release: creator network loads in
//   9.472→11.573 buildup: creator cards accelerate onto screen
//  11.573→13.611 climax: all channels lock and follower counters race
//  13.611→16.587 release: dashboard preview becomes credible
//  16.587→19.029 quiet release: calm live state, less motion
//  19.029→21.960 ending: final "let's get started" hit around 20s
//  21.960→30.000 tail: hold the live state before fading to dashboard

import { getChannels } from '../state-client.js';
import { icon } from '../icons.js';

const LAUNCH_SYNC = {
  systemSnap: 747,
  stepConnect: 1259,
  stepAccount: 2251,
  stepSecurity: 3243,
  appOpen: 4736,
  logoPrep: 5216,
  pinkLine: 5717,
  logoReveal: 6219,
  logoSettle: 7445,
  creatorsWake: 8192,
  creatorsRun: 9472,
  creatorHitA: 10048,
  creatorHitB: 10656,
  creatorHitC: 11157,
  climax: 11573,
  climaxHit: 11648,
  dashboardOpen: 13611,
  quietSettle: 15000,
  emphasis: 16091,
  finalBuild: 19029,
  finalHit: 20000,
  tailHold: 21960,
  handoff: 28000,
};

const CREATOR_BEATS = [8.192, 8.683, 9.184, 9.675, 10.165, 10.656];
const TAIL_REACTIONS = ['start op 0', 'post als eerste', 'pak volgers', 'word trending'];

export function renderLaunchAlert(alert) {
  const channels = getChannels();
  const manager = channels.find(ch => ch.id === 'chnl_manager' || ch.race_participant === false) || null;
  const raceChannels = channels.filter(_isRaceChannel);
  const introChannels = manager
    ? [manager, ...raceChannels].slice(0, 6)
    : channels.slice(0, 6);
  const creatorCount = raceChannels.length || 5;

  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-launch hype-launch-platform';
  root.dataset.alertId = alert.id;

  root.innerHTML = `
    <canvas class="hlp-confetti" aria-hidden="true"></canvas>
    <div class="hlp-flash" aria-hidden="true"></div>
    <div class="hlp-color-flashes" aria-hidden="true">
      <span style="--flash-color:#F5D904"></span>
      <span style="--flash-color:#F52368"></span>
      <span style="--flash-color:#32d74b"></span>
      <span style="--flash-color:#7c4dff"></span>
      <span style="--flash-color:#27d6c6"></span>
      <span style="--flash-color:#00b2ff"></span>
    </div>

    <div class="hlp-bg" aria-hidden="true">
      <div class="hlp-grid"></div>
      <div class="hlp-scan"></div>
      <div class="hlp-vignette"></div>
      <div class="hlp-paint hlp-paint-yellow"></div>
      <div class="hlp-paint hlp-paint-pink"></div>
    </div>

    <div class="hlp-doodles" aria-hidden="true">
      ${_doodle('radio', 'd1')}
      ${_doodle('sparkles', 'd2')}
      ${_doodle('heartFill', 'd3')}
      ${_doodle('trendingUp', 'd4')}
    </div>

    <header class="hlp-topbar" aria-hidden="true">
      <span class="hlp-network">dehype.live</span>
      <strong><i></i>live</strong>
    </header>

    <main class="hlp-stage">
      <section class="hlp-boot-panel" aria-label="platform start">
        <div class="hlp-boot-kicker">lancering gestart</div>
        <div class="hlp-boot-title">De Hype gaat live</div>
        <div class="hlp-boot-meter"><span></span></div>
        <div class="hlp-boot-steps">
          ${_bootStep('netwerk verbonden', 'connect')}
          ${_bootStep('accounts worden aangemaakt', 'account')}
          ${_bootStep('reactions actief', 'security')}
          ${_bootStep('dashboard open', 'feed')}
        </div>
      </section>

      <section class="hlp-hero" aria-label="De Hype">
        <div class="hlp-logo-frame">
          <img class="hlp-logo" src="/themes/hype/assets/logo.svg" alt="de HYPE!" />
        </div>
        <div class="hlp-logo-rule" aria-hidden="true"></div>
      </section>

      <section class="hlp-creator-wall" aria-label="creator kanalen">
        <div class="hlp-creator-header" aria-hidden="true">De Deelnemers</div>
        ${introChannels.map((c, i) => _channelCard(c, i)).join('')}
      </section>

      <section class="hlp-dashboard-preview" aria-label="live dashboard">
        <div class="hlp-preview-card hlp-preview-race">
          <span>startpositie</span>
          ${raceChannels.slice(0, 4).map((c, i) => _raceRow(c, i)).join('')}
        </div>
        <div class="hlp-preview-card hlp-preview-feed">
          <span>strijd begint nu</span>
          ${_feedLine('Eerste post pakt de aandacht', 'posts')}
          ${_feedLine('Volgers gaan naar de beste content', 'hype')}
          ${_feedLine('Alle kanalen op startpositie', 'live')}
        </div>
        <div class="hlp-preview-card hlp-preview-spark">
          <span>vandaag op De Hype</span>
          <strong>${creatorCount} creators live</strong>
          <em>ga posten. ga winnen.</em>
        </div>
      </section>

      <section class="hlp-title-build" aria-hidden="true">
        <div class="hlp-tb-word hlp-tb-w1">DE</div>
        <div class="hlp-tb-word hlp-tb-w2">STRIJD</div>
        <div class="hlp-tb-word hlp-tb-w3">BEGINT</div>
        <div class="hlp-tb-word hlp-tb-w4">NU</div>
      </section>

      <section class="hlp-final-card" aria-label="start">
        <img src="/themes/hype/assets/logo.svg" alt="de HYPE!" />
        <strong>De Hype is live</strong>
        <span>Laat de strijd om de volgers beginnen!</span>
        <div class="hlp-tail-reactions">
          ${TAIL_REACTIONS.map(text => `<b>${escape(text)}</b>`).join('')}
        </div>
      </section>
    </main>
  `;

  root.querySelectorAll('.hlp-channel-card').forEach((el, i) => {
    el.style.setProperty('--launch-delay', `${CREATOR_BEATS[Math.min(i, CREATOR_BEATS.length - 1)]}s`);
  });

  _playLaunchAudio(root);
  _runLaunchTimeline(root);

  return root;
}

function _runLaunchTimeline(root) {
  const canvas = root.querySelector('.hlp-confetti');
  const flash = () => _pulse(root.querySelector('.hlp-flash'), 'pop');
  const colorFlash = (index) => _pulse(root.querySelector(`.hlp-color-flashes span:nth-child(${index})`), 'pop');
  const add = (className) => root.classList.add(className);
  const shake = (delayMs, level = 'shake') => _at(root, delayMs, () => {
    root.classList.add(`hl-${level}`);
    setTimeout(() => root.classList.remove(`hl-${level}`), 680);
  });

  _at(root, LAUNCH_SYNC.systemSnap, () => {
    add('hlp-system-online');
    flash();
  });
  _at(root, LAUNCH_SYNC.stepConnect, () => add('hlp-step-connect'));
  _at(root, LAUNCH_SYNC.stepAccount, () => add('hlp-step-account'));
  _at(root, LAUNCH_SYNC.stepSecurity, () => add('hlp-step-security'));
  _at(root, LAUNCH_SYNC.appOpen, () => {
    add('hlp-app-open');
    colorFlash(1);
  });
  _at(root, LAUNCH_SYNC.logoPrep, () => {
    add('hlp-logo-prep');
    flash();
  });
  _at(root, LAUNCH_SYNC.pinkLine, () => add('hlp-pink-line'));
  _at(root, LAUNCH_SYNC.logoReveal, () => {
    add('hlp-logo-live');
    flash();
    if (canvas) _confettiBurst(canvas, 720, { count: 24, originY: 0.46, spread: 1.05 });
  });
  _at(root, LAUNCH_SYNC.logoSettle, () => add('hlp-logo-settle'));
  _at(root, LAUNCH_SYNC.creatorsWake, () => {
    add('hlp-creators-wake');
    colorFlash(2);
  });
  _at(root, LAUNCH_SYNC.creatorsRun, () => add('hlp-creators-run'));
  _at(root, LAUNCH_SYNC.creatorHitA, () => colorFlash(3));
  _at(root, LAUNCH_SYNC.creatorHitB, () => colorFlash(4));
  _at(root, LAUNCH_SYNC.creatorHitC, () => colorFlash(5));
  _at(root, LAUNCH_SYNC.climax, () => add('hlp-climax'));
  _at(root, LAUNCH_SYNC.climaxHit, () => {
    add('hlp-channel-lock');
    flash();
    if (canvas) _confettiBurst(canvas, 1400, { count: 140, originY: 0.54, spread: 1.75 });
  });
  _at(root, LAUNCH_SYNC.dashboardOpen, () => add('hlp-dashboard-open'));
  _at(root, LAUNCH_SYNC.quietSettle, () => add('hlp-quiet-settle'));
  _at(root, LAUNCH_SYNC.emphasis, () => {
    add('hlp-platform-live');
    flash();
  });
  _at(root, 16845, () => { colorFlash(1); add('hlp-tb-w1-in'); });
  _at(root, 17085, () => { colorFlash(5); add('hlp-tb-w2-in'); });
  _at(root, 18078, () => { colorFlash(2); flash(); add('hlp-tb-w3-in'); });
  _at(root, 18335, () => { add('hlp-tb-w4-in'); });
  _at(root, 18827, () => { colorFlash(6); flash(); });
  _at(root, LAUNCH_SYNC.finalBuild, () => add('hlp-final-build'));
  _at(root, 19083, () => flash());
  _at(root, LAUNCH_SYNC.finalHit, () => {
    add('hlp-final-live');
    flash();
    if (canvas) _confettiBurst(canvas, 1900, { count: 220, originY: 0.5, spread: 1.95 });
  });
  _at(root, LAUNCH_SYNC.tailHold, () => add('hlp-tail-hold'));
  _at(root, LAUNCH_SYNC.handoff, () => add('hlp-dashboard-handoff'));

  shake(LAUNCH_SYNC.logoReveal, 'shake-l');
  shake(LAUNCH_SYNC.logoSettle, 'shake-s');
  shake(LAUNCH_SYNC.creatorHitA, 'shake-s');
  shake(LAUNCH_SYNC.creatorHitB, 'shake');
  shake(LAUNCH_SYNC.creatorHitC, 'shake-s');
  shake(LAUNCH_SYNC.climaxHit, 'shake-l');
  shake(LAUNCH_SYNC.emphasis, 'shake');
  shake(17109, 'shake-s');
  shake(17600, 'shake-s');
  shake(18091, 'shake');
  shake(18837, 'shake-l');
  shake(LAUNCH_SYNC.finalHit, 'shake-l');
}

function _at(root, delayMs, fn) {
  setTimeout(() => {
    if (!root.isConnected) return;
    fn();
  }, delayMs);
}

function _pulse(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

function _bootStep(label, key) {
  return `
    <div class="hlp-boot-step" data-step="${escape(key)}">
      <i></i><span>${escape(label)}</span>
    </div>
  `;
}

function _channelCard(c, _index) {
  return `
    <article class="hlp-channel-card" style="--ch-color:${escape(c.color || '#00b2ff')}">
      <div class="hlp-channel-ring">
        ${_channelAvatar(c)}
      </div>
      <div class="hlp-channel-copy">
        <strong>${escape(c.name || 'Kanaal')}</strong>
        <span>${escape(c.handle || '@kanaal')}</span>
      </div>
      <div class="hlp-channel-count">
        <strong>0</strong>
        <span>posts live</span>
      </div>
    </article>
  `;
}

function _channelAvatar(c) {
  const avatarUrl = c.avatar_url || c.avatarUrl || '';
  if (avatarUrl) {
    return `<img class="hlp-channel-avatar" src="${escape(avatarUrl)}" alt="" />`;
  }
  const iconName = _channelIcon(c.id);
  return `<div class="hlp-channel-icon">${icon[iconName] ? icon[iconName](44) : icon.compass(44)}</div>`;
}

function _raceRow(c, index) {
  return `
    <div class="hlp-race-row" style="--ch-color:${escape(c.color || '#00b2ff')};--rank:${index + 1}">
      <i></i>
      <strong>${escape(c.name || c.handle || 'Kanaal')}</strong>
      <span>op 0</span>
    </div>
  `;
}

function _feedLine(text, tag) {
  return `
    <div class="hlp-feed-line">
      <b>${escape(tag)}</b>
      <span>${escape(text)}</span>
    </div>
  `;
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

function _isRaceChannel(ch) {
  return ch && ch.race_participant !== false;
}

function _doodle(iconName, cls) {
  return `<span class="hlp-doodle ${cls}">${icon[iconName] ? icon[iconName](86) : ''}</span>`;
}

function _playLaunchAudio(root) {
  const audio = new Audio('/modules/hype/audio/launch.wav');
  audio.preload = 'auto';
  audio.volume = 0.9;
  const play = audio.play();
  if (play && typeof play.catch === 'function') play.catch(() => { });

  const stop = () => { try { audio.pause(); audio.src = ''; } catch { } };
  const observer = new MutationObserver(() => {
    if (!root.isConnected) { observer.disconnect(); stop(); }
  });
  queueMicrotask(() => {
    if (root.parentNode) observer.observe(root.parentNode, { childList: true });
  });
}

function _confettiBurst(canvas, durationMs, opts = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  // Scale to actual resolution: a 4K TV at dpr 1 needs screen-filling confetti.
  const scale = Math.max(dpr, canvas.height / 1080);

  const colors = ['#f5d904', '#f52368', '#32d74b', '#ff8a00', '#7c4dff', '#27d6c6', '#00b2ff', '#ffffff'];
  const N = Number(opts.count) || 160;
  const spread = Number(opts.spread) || 1.6;
  const cx = canvas.width / 2;
  const cy = canvas.height * (Number(opts.originY) || 0.55);
  const parts = [];
  for (let i = 0; i < N; i++) {
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI * spread;
    const speed = (6 + Math.random() * 14) * scale;
    const ribbon = Math.random() < 0.28;
    parts.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6 * scale,
      g: ribbon ? 0.12 * scale : 0.2 * scale,
      size: (3 + Math.random() * 5) * scale,
      len: ribbon ? (22 + Math.random() * 30) * scale : 0,
      ribbon,
      color: colors[i % colors.length],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * (ribbon ? 0.18 : 0.4),
      life: 1,
    });
  }
  const start = performance.now();
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life = Math.max(0, 1 - t / durationMs);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      if (p.ribbon) {
        ctx.fillRect(-p.len / 2, -p.size * 0.25, p.len, p.size * 0.5);
      } else {
        ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
      }
      ctx.restore();
    }
    if (t < durationMs) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(frame);
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
