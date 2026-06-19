// Alert renderer: hype-restart
// Theatrical reboot from the infinite power-off state. ~16s total. Mirrors
// the power-down CRT collapse with a CRT *re-open*, then boot panel with
// goofy Dutch steps, then a big climax. Welpen-friendly.
//
// Beats:
//   0.0s  pitch black + faint static
//   1.0s  single white dot grows
//   2.0s  CRT horizontal line re-opens (mirror of power-down collapse)
//   3.0s  sparks arc as the line expands to full screen
//   3.8s  boot panel slides in
//   ~4.5s steps tick one by one (~1.2s each)
//  11.0s  panel fades, finale takes over
//  11.4s  strobe + giant logo bloom + confetti burst
//  12.5s  channel chips snap in + cheer line
//  ~16s   fade out

import { getChannels } from '../state-client.js';

const DEFAULT_STEPS = [
  'Influencers worden wakker gemaakt…',
  'Likes worden teruggezet…',
  'Kanalen worden opnieuw verbonden…',
  'Comments worden opgehaald…',
  'Confetti wordt geladen…',
];

export function renderRestartAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-restart';
  root.dataset.alertId = alert.id;

  const steps = Array.isArray(alert.payload?.steps) && alert.payload.steps.length
    ? alert.payload.steps.slice(0, 6)
    : DEFAULT_STEPS;
  const cheer = String(alert.payload?.cheer || 'Het kamp heeft DeHype gered!');
  const channels = Array.isArray(alert.payload?.channels) && alert.payload.channels.length
    ? alert.payload.channels
    : getChannels();

  root.innerHTML = `
    <div class="hr-static" aria-hidden="true"></div>

    <div class="hr-crt" aria-hidden="true">
      <div class="hr-crt-dot"></div>
      <div class="hr-crt-line"></div>
      <div class="hr-sparks">
        <span></span><span></span><span></span><span></span><span></span><span></span>
      </div>
    </div>

    <div class="hr-boot">
      <div class="hr-boot-head">Bezig met opstarten</div>
      <ul class="hr-boot-list">
        ${steps.map((s) => `
          <li>
            <span class="hr-spinner"></span>
            <span class="hr-check">✓</span>
            <span class="hr-label">${escape(s)}</span>
          </li>
        `).join('')}
      </ul>
    </div>

    <div class="hr-finale">
      <canvas class="hr-confetti"></canvas>
      <div class="hr-strobe"></div>
      <div class="hr-logo">DeHype</div>
      <div class="hr-cheer">${escape(cheer)}</div>
      <div class="hr-channels">
        ${channels.map((c) => `
          <div class="hr-chip" style="--ch-color:${escape(c.color || '#7c5cff')}">
            <span class="hr-chip-dot"></span>
            <span class="hr-chip-handle">${escape(c.handle || '@?')}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Boot step ticker — each <li> flips to .done on a fixed cadence.
  const items = root.querySelectorAll('.hr-boot-list li');
  const STEP_DELAY = 1200;
  const STEP_START = 4600;
  items.forEach((li, i) => {
    setTimeout(() => li.classList.add('done'), STEP_START + i * STEP_DELAY);
  });

  // Climax at ~11.4s.
  const finaleAt = STEP_START + items.length * STEP_DELAY + 200;
  setTimeout(() => {
    root.classList.add('finale');
    const canvas = root.querySelector('.hr-confetti');
    if (canvas) _confettiBurst(canvas, 2600);
  }, finaleAt);

  return root;
}

function _confettiBurst(canvas, durationMs) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width  = canvas.clientWidth  * dpr;
  canvas.height = canvas.clientHeight * dpr;

  const colors = ['#ffc24a', '#ff2d87', '#a23bff', '#2bc1ff', '#4ec9b0', '#ffffff'];
  const N = 220;
  const cx = canvas.width / 2;
  const cy = canvas.height * 0.55;
  const parts = [];
  for (let i = 0; i < N; i++) {
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 1.6;
    const speed = (6 + Math.random() * 13) * dpr;
    parts.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 5 * dpr,
      g: 0.2 * dpr,
      size: (3 + Math.random() * 5) * dpr,
      color: colors[i % colors.length],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
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
      ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
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
