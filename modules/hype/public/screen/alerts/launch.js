// Alert renderer: hype-launch
// Cinematic Day-1 takeover. 21.96s, synced to "Launch Parade" audio.
// BPM 123, first downbeat at 0.766s. Onsets confirmed via librosa.
//
// Visual beats → audio anchors:
//   0.00s   heartbeat starts (intro)
//   1.77s   shockwave (first strong onset)
//   3.51s   bg gradient + boot lines (kick enters)
//   6.62s   SVG brand mark draws (bar 4 downbeat)
//  10.52s   mark glides aside (bar 6 downbeat)
//  11.42s   "DeHype" wordmark slams letter by letter (strong hit)
//  12.66s   tagline fades in
//  14.14s   channel chips rocket in (strong hit)
//  16.14s   CLIMAX — strobe + bloom + small confetti (RMS peak)
//  17.6s    quiet break (visuals settle)
//  18.11s   DROP — LIVE slam + big confetti burst
//  19.85s   final crescendo (sustained until 20.4s)
//  20.4s    fade out

import { getChannels } from '../state-client.js';

export function renderLaunchAlert(alert) {
  const account = alert.payload?.account || {};
  const handle = account.handle || '@kamp_live';
  const channels = getChannels();

  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-launch hype-launch-v2';
  root.dataset.alertId = alert.id;

  root.innerHTML = `
    <div class="hl-bg" aria-hidden="true">
      <div class="hl-bg-gradient"></div>
      <div class="hl-bg-grid"></div>
      <div class="hl-vignette"></div>
      <div class="hl-scanlines"></div>
      <div class="hl-particles"></div>
    </div>

    <div class="hl-heartbeat" aria-hidden="true"><span></span></div>
    <div class="hl-shockwave" aria-hidden="true"><span></span><span></span><span></span></div>

    <div class="hl-beams" aria-hidden="true">
      <span style="--beam-rot:0deg"></span>
      <span style="--beam-rot:60deg"></span>
      <span style="--beam-rot:120deg"></span>
      <span style="--beam-rot:180deg"></span>
      <span style="--beam-rot:240deg"></span>
      <span style="--beam-rot:300deg"></span>
    </div>

    <div class="hl-pulse-rings" aria-hidden="true">
      <span style="--pr-delay:6.619s"></span>
      <span style="--pr-delay:8.570s"></span>
      <span style="--pr-delay:10.521s"></span>
      <span style="--pr-delay:12.472s"></span>
      <span style="--pr-delay:14.423s"></span>
      <span style="--pr-delay:16.374s"></span>
    </div>

    <div class="hl-countdown" aria-hidden="true">
      <span style="--cd-delay:4.668s">5</span>
      <span style="--cd-delay:5.156s">4</span>
      <span style="--cd-delay:5.644s">3</span>
      <span style="--cd-delay:6.131s">2</span>
      <span style="--cd-delay:6.619s" class="hl-cd-go">LAUNCH</span>
    </div>

    <div class="hl-boot" aria-hidden="true">
      <div class="hl-boot-line"><span class="hl-boot-tick">›</span> verbinding maken<span class="hl-boot-ok">✓</span></div>
      <div class="hl-boot-line"><span class="hl-boot-tick">›</span> ${channels.length} kanalen gevonden<span class="hl-boot-ok">✓</span></div>
      <div class="hl-boot-line"><span class="hl-boot-tick">›</span> feed openen<span class="hl-boot-ok">✓</span></div>
      <div class="hl-boot-line"><span class="hl-boot-tick">›</span> ${escape(handle)} aan het opstarten<span class="hl-boot-ok">✓</span></div>
    </div>

    <div class="hl-mark-wrap" aria-hidden="true">
      <svg class="hl-mark" viewBox="0 0 120 120">
        <defs>
          <linearGradient id="hl2-grad" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
            <stop offset="0%"  stop-color="#ffc24a"/>
            <stop offset="35%" stop-color="#ff2d87"/>
            <stop offset="70%" stop-color="#a23bff"/>
            <stop offset="100%" stop-color="#2bc1ff"/>
          </linearGradient>
        </defs>
        <rect class="hl-mark-rect" x="14" y="14" width="92" height="92" rx="22"
              fill="none" stroke="url(#hl2-grad)" stroke-width="4"
              pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
        <rect class="hl-mark-fill" x="14" y="14" width="92" height="92" rx="22"
              fill="url(#hl2-grad)" opacity="0"/>
        <circle class="hl-mark-ring" cx="60" cy="60" r="22"
                fill="none" stroke="#fff" stroke-width="6"
                pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
        <circle class="hl-mark-dot" cx="84" cy="34" r="6" fill="#fff" opacity="0"/>
      </svg>
    </div>

    <div class="hl-wordmark-wrap">
      <h1 class="hl-wordmark"><span>D</span><span>e</span><span>H</span><span>y</span><span>p</span><span>e</span></h1>
      <div class="hl-tagline">het sociale platform van het kamp</div>
    </div>

    <div class="hl-channels" aria-hidden="true">
      ${channels.map((c, i) => `
        <div class="hl-ch" data-i="${i}" style="--ch-color:${escape(c.color || '#7c5cff')}">
          <div class="hl-ch-ring">
            <div class="hl-ch-avatar">${escape(String(c.name || '?').charAt(0).toUpperCase())}</div>
            <div class="hl-ch-online"></div>
          </div>
          <div class="hl-ch-handle">${escape(c.handle || '@?')}</div>
        </div>
      `).join('')}
    </div>

    <div class="hl-climax" aria-hidden="true">
      <canvas class="hl-confetti"></canvas>
      <div class="hl-strobe"></div>
      <svg class="hl-lightning" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true">
        <path class="hl-bolt hl-bolt-1" d="M960 0 L900 360 L1020 360 L860 720 L1000 720 L820 1080" fill="none" stroke="#fff" stroke-width="6"/>
        <path class="hl-bolt hl-bolt-2" d="M520 0 L470 280 L590 280 L420 620 L560 620 L380 1080" fill="none" stroke="#a23bff" stroke-width="4"/>
        <path class="hl-bolt hl-bolt-3" d="M1420 0 L1360 320 L1480 320 L1320 700 L1460 700 L1280 1080" fill="none" stroke="#2bc1ff" stroke-width="4"/>
      </svg>
      <div class="hl-door hl-door-l"></div>
      <div class="hl-door hl-door-r"></div>
      <div class="hl-bloom">DeHype</div>
      <div class="hl-live-slam">
        <span class="hl-live-dot"></span>
        <span class="hl-live-text">LIVE</span>
        <span class="hl-live-sub">${escape(handle)} is online</span>
      </div>
    </div>
  `;

  // Stagger channel chip animations from edges.
  const chips = root.querySelectorAll('.hl-ch');
  chips.forEach((el, i) => {
    el.style.setProperty('--from-x', i % 2 === 0 ? '-110vw' : '110vw');
    el.style.setProperty('--from-y', `${(i - chips.length / 2) * 8}vh`);
    el.style.animationDelay = `${14.14 + i * 0.244}s`;
  });

  // Soundtrack — "Launch Parade" instrumental. Synced visuals (heartbeat,
  // shockwave, boot, draw, climax) were timed to this file.
  _playLaunchAudio(root);

  // Drift particles — light decorative dots that float across the screen.
  const particleHost = root.querySelector('.hl-particles');
  if (particleHost) _spawnParticles(particleHost, 22);

  // Camera shake at each major impact. Class auto-clears after the keyframe.
  const _shake = (delayMs, level = 'shake') => setTimeout(() => {
    root.classList.add(`hl-${level}`);
    setTimeout(() => root.classList.remove(`hl-${level}`), 700);
  }, delayMs);
  _shake(1765, 'shake-s');     // first shockwave
  _shake(6619, 'shake-s');     // LAUNCH word lands / mark draws
  _shake(11420, 'shake');      // wordmark slam
  _shake(14140, 'shake-s');    // channels rocket in
  _shake(16140, 'shake-l');    // climax
  _shake(18110, 'shake-l');    // drop

  // Climax at 16.14s — RMS peak of the track. Strobe + bloom + lightning + small puff.
  setTimeout(() => {
    root.classList.add('hl-climaxing');
    const canvas = root.querySelector('.hl-confetti');
    if (canvas) _confettiBurst(canvas, 1500);
  }, 16140);

  // The track goes near-silent ~17.6–18.0s, then SLAMS back at 18.11s.
  // Doors split apart, LIVE slams in, big confetti + ribbon burst.
  setTimeout(() => {
    root.classList.add('hl-dropped');
    const canvas = root.querySelector('.hl-confetti');
    if (canvas) _confettiBurst(canvas, 2800);
  }, 18110);

  return root;
}

function _playLaunchAudio(root) {
  const audio = new Audio('/modules/hype/audio/launch.wav');
  audio.preload = 'auto';
  audio.volume = 0.9;
  // Browsers may block autoplay until user has interacted. The screen page is
  // typically left running so this usually works; if it rejects we silently
  // skip — the visuals still play.
  const play = audio.play();
  if (play && typeof play.catch === 'function') play.catch(() => {});

  // Stop + free the audio when the alert element is removed from the DOM.
  const stop = () => {
    try { audio.pause(); audio.src = ''; } catch {}
  };
  const observer = new MutationObserver(() => {
    if (!root.isConnected) { observer.disconnect(); stop(); }
  });
  // Observe once mounted; document.body is a safe upstream target.
  queueMicrotask(() => {
    if (root.parentNode) observer.observe(root.parentNode, { childList: true });
  });
}

function _spawnParticles(host, n) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'hl-particle';
    p.style.left = `${Math.random() * 100}%`;
    p.style.animationDelay = `${3 + Math.random() * 14}s`;
    p.style.animationDuration = `${10 + Math.random() * 10}s`;
    p.style.setProperty('--p-size', `${4 + Math.random() * 6}px`);
    p.style.setProperty('--p-hue', String(Math.floor(Math.random() * 360)));
    host.appendChild(p);
  }
}

function _confettiBurst(canvas, durationMs) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width  = canvas.clientWidth  * dpr;
  canvas.height = canvas.clientHeight * dpr;

  const colors = ['#ffc24a', '#ff2d87', '#a23bff', '#2bc1ff', '#4ec9b0', '#ffffff'];
  const N = 320;
  const cx = canvas.width / 2;
  const cy = canvas.height * 0.55;
  const parts = [];
  for (let i = 0; i < N; i++) {
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 1.6;
    const speed = (6 + Math.random() * 14) * dpr;
    const ribbon = Math.random() < 0.25;
    parts.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6 * dpr,
      g: ribbon ? 0.12 * dpr : 0.2 * dpr,
      size: (3 + Math.random() * 5) * dpr,
      len: ribbon ? (22 + Math.random() * 30) * dpr : 0,
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
