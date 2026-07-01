// Alert renderer: hype-restart
// Theatrical reboot for kids 7-11. Synced to reboot.wav (13.842s, 122 BPM).
//
// Timeline (audio-locked — do not shift step/finale times):
//   0.0s  Black static
//   0.18s CRT dot grows
//   0.9s  CRT line re-opens, sparks arc
//   2.5s  Boot terminal slams in
//   2.880s  FIRST BIG HIT — subtitle flips to "VERBINDING GEVONDEN" + beat (snap 0.961)
//   3.616s  Step 1 ✓  (snap 0.794)
//   4.107s  Step 2 ✓  (snap 0.775) + channel chips appear
//   4.416s  Step 3 ✓  (snap 1.0 — STRONGEST)
//   6.315s  Step 4 ✓  (snap 0.732)
//   7.051s  Step 5 ★ VERSTERKT — Beveiliging versterkt na lek  (snap 0.969) — gold special step
//   7.787s  Step 6 ✓ ONLINE  (snap 1.0, buildup peak) — terminal locks in
//   8.032s  Beat punch  (snap 0.714)
//   8.501s  Pre-finale — breakdown section, quiet before the storm
//   9.760s  Beat punch  (snap 0.676)
//  10.613s  Beat punch  (snap 1.0 — mega hit)
//  10.741s  Finale fires — "DE HYPE IS TERUG ONLINE!" + confetti (ending section)
//  12.949s  Second confetti burst  (snap 1.0, final hit)
//   ∞      Stays until dismissed from admin

import { getChannels } from '../state-client.js';

const DEFAULT_STEPS = [
  'Noodverbinding herstellen…',
  'Creator-kanalen opnieuw verbinden…',
  'Volgersdata synchroniseren…',
  'Beveiligingsprotocol herstellen…',
  'Beveiliging extra versterkt na lek…',  // special step — gold, resolved
  'De Hype opnieuw opstarten…',
];

// Step completions locked to audio onsets in reboot.wav (13.842s)
// Steps 1-3 fire in rapid succession (1.8s window) for dramatic effect
// Step 5 is Harry (ERR) — hits on strong snap 0.969, same moment as tablet Harry line
const STEP_TIMES_MS = [3616, 4107, 4416, 6315, 7051, 7787];

export function renderRestartAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-restart';
  root.dataset.alertId = alert.id;

  const steps = Array.isArray(alert.payload?.steps) && alert.payload.steps.length
    ? alert.payload.steps.slice(0, 7)
    : DEFAULT_STEPS;
  const _isSpecial = s => s.toLowerCase().includes('lek') || s.toLowerCase().includes('versterkt');
  const channels = Array.isArray(alert.payload?.channels) && alert.payload.channels.length
    ? alert.payload.channels
    : getChannels();

  const barId = `hr-bar-${_eid(alert.id)}`;

  root.innerHTML = `
    <!-- Background static -->
    <div class="hr-static"></div>

    <!-- Beat-locked brand colour flashes (launch-style energy) -->
    <div class="hr-color-flashes" aria-hidden="true">
      <span style="--fc:#f5d904"></span><span style="--fc:#f52368"></span>
      <span style="--fc:#32d74b"></span><span style="--fc:#27d6c6"></span>
      <span style="--fc:#00b2ff"></span><span style="--fc:#ff8a00"></span>
    </div>

    <!-- CRT re-open (mirrors collapse in reverse) -->
    <div class="hr-crt">
      <div class="hr-crt-dot"></div>
      <div class="hr-crt-line"></div>
      <div class="hr-sparks">
        <span></span><span></span><span></span>
        <span></span><span></span><span></span>
      </div>
    </div>

    <!-- Full-screen boot terminal (3.8s → finale) -->
    <div class="hr-boot">
      <div class="hr-boot-content">
        <div class="hr-boot-head">
          <div class="hr-boot-logo-text">HYPE-SERVER.NL</div>
          <div class="hr-boot-sub">systeem herstart gedetecteerd — verbinding herstellen…</div>
        </div>
        <div class="hr-progress-wrap">
          <div class="hr-progress-bar" id="${barId}"></div>
          <div class="hr-progress-pct" id="hr-pct-${_eid(alert.id)}">0%</div>
        </div>
        <ul class="hr-steps">
          ${steps.map((s, i) => `
            <li class="hr-step${_isSpecial(s) ? ' hr-step-special' : ''}">
              <div class="hr-step-icon">
                <span class="hr-spinner"></span>
                <span class="hr-check">✓</span>
              </div>
              <span class="hr-step-text">${_esc(s)}</span>
              <span class="hr-step-status">${i === steps.length - 1 ? 'ONLINE' : _isSpecial(s) ? 'VERSTERKT' : 'OK'}</span>
            </li>
          `).join('')}
        </ul>
        <!-- Channel chips appear during step 2 -->
        <div class="hr-channel-preview" id="hr-cprev-${_eid(alert.id)}"></div>
      </div>
    </div>

    <!-- Finale: word-by-word reveal + confetti -->
    <div class="hr-finale">
      <canvas class="hr-confetti"></canvas>
      <div class="hr-strobe"></div>
      <div class="hr-finale-bg"></div>
      <div class="hr-finale-content">
        <div class="hr-logo">
          <img src="/themes/hype/assets/logo.svg" alt="De Hype"
               onerror="this.outerHTML='<span class=hr-logo-text>De Hype</span>'">
        </div>
        <div class="hr-cheer-words">
          <span class="hr-cw1">DE HYPE</span>
          <span class="hr-cw2">IS TERUG</span>
          <span class="hr-cw3">ONLINE!</span>
        </div>
        <div class="hr-finale-channels">
          ${channels.map(c => `
            <div class="hr-chip" style="--ch-color:${_esc(c.color || '#7c5cff')}">
              <span class="hr-chip-dot"></span>
              <span class="hr-chip-handle">${_esc(c.handle || '@?')}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Wire boot steps
  const stepEls = root.querySelectorAll('.hr-step');
  const bar = root.querySelector(`#${barId}`);
  const pct = root.querySelector(`#hr-pct-${_eid(alert.id)}`);
  const cprev = root.querySelector(`#hr-cprev-${_eid(alert.id)}`);

  const hrBoot = root.querySelector('.hr-boot');
  const hrSub  = root.querySelector('.hr-boot-sub');

  const _pulse = () => {
    if (!hrBoot) return;
    hrBoot.classList.add('hr-beat');
    setTimeout(() => hrBoot.classList.remove('hr-beat'), 320);
  };

  // 2.880s: first big audio hit — subtitle flips + beat punch
  setTimeout(() => {
    if (hrSub) { hrSub.textContent = 'VERBINDING GEVONDEN — OPSTART INITIËREN'; hrSub.classList.add('hr-sub-found'); }
    _pulse();
  }, 2880);

  stepEls.forEach((li, i) => {
    setTimeout(() => {
      li.classList.add('done');
      const p = Math.round((i + 1) / stepEls.length * 100);
      if (bar) bar.style.width = p + '%';
      if (pct) pct.textContent = p + '%';

      // Step 2 (index 1): channel chips preview slides into the terminal
      if (i === 1 && cprev) {
        channels.slice(0, 6).forEach((c, ci) => {
          const chip = document.createElement('div');
          chip.className = 'hr-prev-chip';
          chip.style.cssText = `--ch-color:${c.color || '#7c5cff'};animation-delay:${ci * 0.12}s`;
          chip.innerHTML = `<span class="hr-prev-dot"></span><span>${_esc(c.handle || '@?')}</span>`;
          cprev.appendChild(chip);
        });
        cprev.classList.add('visible');
      }

      // Special security step: double pulse for emphasis
      if (li.classList.contains('hr-step-special')) { _pulse(); _pulse(); }

      // Last step: terminal locks in (progress bar brightens, header glows)
      if (i === stepEls.length - 1) hrBoot?.classList.add('ready');
    }, STEP_TIMES_MS[i] ?? (STEP_TIMES_MS[STEP_TIMES_MS.length - 1] + (i - (STEP_TIMES_MS.length - 1)) * 2000));
  });

  // Beat punches at strong onsets (7051 is now the Harry step, not a pulse)
  [8032, 9760, 10613].forEach(t => setTimeout(_pulse, t));

  // Launch-style colour-flash + screen-shake punches locked to the reboot.wav beats
  const _cflash = (i) => {
    const s = root.querySelector(`.hr-color-flashes span:nth-child(${i})`);
    if (!s) return;
    s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop');
  };
  const _shakeAt = (delay, cls) => setTimeout(() => {
    if (!root.isConnected) return;
    root.classList.add(cls);
    setTimeout(() => root.classList.remove(cls), 640);
  }, delay);
  [[2880, 5, 'rs-shake-l'], [3616, 1], [4107, 1], [4416, 6, 'rs-shake-l'], [6315, 1],
   [7051, 1, 'rs-shake'], [7787, 2, 'rs-shake-l'], [8032, 6], [9760, 2], [10613, 5, 'rs-shake-l']]
    .forEach(([t, ci, sc]) => {
      setTimeout(() => { if (root.isConnected) _cflash(ci); }, t);
      if (sc) _shakeAt(t, sc);
    });

  // Pre-finale: breakdown section — quiet before the storm (8.501s)
  setTimeout(() => hrBoot?.classList.add('pre-finale'), 8501);

  // Finale fires at ending section boundary (10.741s) — after mega snap cluster
  setTimeout(() => {
    root.classList.add('finale');
    const canvas = root.querySelector('.hr-confetti');
    if (canvas) {
      _confettiBurst(canvas, 5000);
      // Second burst at final snap 12.949s (12949 - 10741 = 2208ms offset)
      setTimeout(() => { if (root.isConnected && canvas) _confettiBurst(canvas, 6000); }, 2208);
    }
  }, 10741);

  _playRebootAudio(root);

  return root;
}

function _confettiBurst(canvas, durationMs) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;

  const colors = ['#f5d904', '#ff2d87', '#a23bff', '#2bc1ff', '#4ec9b0', '#ffffff', '#ff8c00'];
  const N = 360;
  const cx = canvas.width / 2;
  const cy = canvas.height * 0.42;

  const parts = Array.from({ length: N }, (_, i) => {
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 1.9;
    const speed = (8 + Math.random() * 18) * dpr;
    return {
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 7 * dpr,
      g: 0.24 * dpr,
      w: (3 + Math.random() * 7) * dpr,
      h: (1.5 + Math.random() * 3) * dpr,
      color: colors[i % colors.length],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.5,
    };
  });

  const start = performance.now();
  function frame(now) {
    const t = now - start;
    const life = Math.max(0, 1 - t / durationMs);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = life;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w, -p.h * 0.5, p.w * 2, p.h);
      ctx.restore();
    }
    if (t < durationMs) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(frame);
}

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function _eid(s) { return String(s).replace(/[^a-z0-9_-]/gi, '-'); }

function _playRebootAudio(root) {
  const audio = new Audio('/modules/hype/audio/reboot.wav');
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

