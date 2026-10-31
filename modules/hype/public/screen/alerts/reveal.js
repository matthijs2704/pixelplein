// Alert renderer: hype-reveal
// The Thursday-night finale. Two modes, driven by payload:
//
// Standby (payload.standby): infinite holding screen while everyone gathers —
//   "DE GROTE ONTHULLING", ambient, calm.
//
// Cutscene (payload.countdownSec): the reveal that never lands:
//   countdown → "winnaar berekenen…" stalls → glitch burst. Mid-burst the
//   server fires powerOff (non-instant): the hype-offline shutdown animation
//   mounts UNDERNEATH us while this alert glitch-fades away (ov-dismissing),
//   so the chaos clears straight into Harry's already-typing terminal —
//   who then crashes the platform BY ACCIDENT. No black gap, one scene.

import { getChannels } from '../state-client.js';

export function renderRevealAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-reveal';
  root.dataset.alertId = alert.id;

  root.innerHTML = `
    <div class="hrv-bg" aria-hidden="true">
      <div class="hrv-grid"></div>
      <div class="hrv-beams"><span class="b1"></span><span class="b2"></span><span class="b3"></span></div>
      <div class="hrv-dust">${'<i></i>'.repeat(14)}</div>
      <div class="hrv-vignette"></div>
    </div>
    <div class="hrv-stage"></div>
  `;

  const stage = root.querySelector('.hrv-stage');
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  // Body-shake cleanup is NOT tied to root removal: the shake must outlive
  // this alert to bridge into the offline terminal (its own 3s timeout in
  // _phaseGlitchBurst always clears it).
  _onRemoved(root, () => timers.forEach(clearTimeout));

  if (alert.payload?.standby) {
    _renderStandby(root, stage);
    return root;
  }

  const countdownSec = Math.max(3, Number(alert.payload?.countdownSec) || 10);

  // ── Timeline: countdown → compute (3s) → glitch burst (starts +3).
  // At countdown+4 the server fires powerOff; our dismiss animation and the
  // lingering body-shake bridge into the offline terminal. One master audio
  // track (reveal.wav) covers this window; missing file → WebAudio ticks.
  const haveTrack = _playTrack(root, '/modules/hype/audio/reveal.wav', 0.9);
  _phaseCountdown(stage, countdownSec, later, haveTrack);
  later(() => _phaseCompute(stage), countdownSec * 1000);
  later(() => _phaseGlitchBurst(root), (countdownSec + 3) * 1000);

  return root;
}

/* ── Shared: the "nominees" — competing channels, no numbers (spannend) ── */

function _raceChannels() {
  return getChannels().filter(ch => ch.race_participant !== false);
}

function _lineupHtml() {
  const cards = _raceChannels().map((ch, i) => `
    <div class="hrv-nom" style="--ch-color:${_esc(ch.color || '#7c5cff')};--i:${i}">
      <span class="hrv-nom-dot"></span>
      <strong>${_esc(ch.name)}</strong>
      <span class="hrv-nom-handle">${_esc(ch.handle || '')}</span>
    </div>
  `).join('');
  return `<div class="hrv-lineup">${cards}</div>`;
}

/* ── Standby: award-show holding screen while the crowd gathers ──────── */

function _renderStandby(root, stage) {
  root.classList.add('hrv-standby');
  stage.innerHTML = `
    <div class="hrv-ambient" aria-hidden="true">
      <span class="hrv-sweep s1"></span>
      <span class="hrv-sweep s2"></span>
    </div>
    <img class="hrv-logo" src="/themes/hype/assets/logo.svg" alt="de HYPE!" />
    <h1 class="hrv-title hrv-title-shine">De grote onthulling</h1>
    <p class="hrv-sub">wie heeft de meeste volgers van heel DeHype?</p>
    ${_lineupHtml()}
    <p class="hrv-hint">we beginnen zo…</p>
  `;
  _loopAudio(root, '/modules/hype/audio/prelaunch.wav', 0.55);
}

/* ── Phase 1: countdown — big number in a pulsing ring, beams speed up ── */

function _phaseCountdown(stage, seconds, later, haveTrack) {
  stage.closest('.hype-alert-reveal')?.classList.add('hrv-live');
  stage.innerHTML = `
    <h1 class="hrv-title">Wie heeft de meeste volgers?</h1>
    <div class="hrv-count-ring">
      <span class="hrv-ring" aria-hidden="true"></span>
      <div class="hrv-count" aria-live="polite"></div>
    </div>
    ${_lineupHtml()}
  `;
  const el = stage.querySelector('.hrv-count');
  const ring = stage.querySelector('.hrv-count-ring');
  const beep = _tickSound();
  const tick = (accent) => { if (haveTrack.failed) beep(accent); };
  let n = seconds;
  const show = () => {
    el.textContent = n;
    el.classList.remove('hrv-count-pop');
    ring.classList.remove('hrv-ring-pulse');
    void el.offsetWidth; // restart pop animation
    el.classList.add('hrv-count-pop');
    ring.classList.add('hrv-ring-pulse');
    if (n <= 3) ring.classList.add('hrv-ring-hot');
    tick(n <= 3);
    // Random nominee card flares up each tick — the tension builds.
    const noms = stage.querySelectorAll('.hrv-nom');
    if (noms.length) {
      noms.forEach(x => x.classList.remove('flash'));
      noms[Math.floor(Math.random() * noms.length)].classList.add('flash');
    }
  };
  show();
  for (let i = 1; i < seconds; i++) later(() => { n--; show(); }, i * 1000);
}

/* ── Phase 2: fake winner computation — raffle-drum name cycler ───────── */

function _phaseCompute(stage) {
  stage.innerHTML = `
    <h1 class="hrv-title">Stemmen tellen…</h1>
    <div class="hrv-drum" aria-hidden="true"></div>
    <div class="hrv-progress"><span class="hrv-progress-fill"></span></div>
    <p class="hrv-sub hrv-pct">0%</p>
  `;
  const pct = stage.querySelector('.hrv-pct');
  // Climb fast, then stall — something is wrong.
  const steps = [12, 34, 61, 78, 87, 91, 93, 93, 94, 94];
  steps.forEach((v, i) => setTimeout(() => { pct.textContent = `${v}%`; }, i * 280));

  // Raffle drum: channel names whip past ever faster, then jam.
  const drum = stage.querySelector('.hrv-drum');
  const names = _raceChannels().map(ch => ch.handle || ch.name);
  if (drum && names.length) {
    let i = 0, delay = 220;
    const spin = () => {
      drum.textContent = names[i++ % names.length];
      drum.style.color = _raceChannels()[(i - 1) % names.length]?.color || '#fff';
      delay = Math.max(70, delay - 14);
      if (i < 26) setTimeout(spin, delay);
      else drum.classList.add('hrv-drum-jam'); // stuck — something is wrong
    };
    spin();
  }
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ── Phase 3: glitch burst (reuses the glitch overlay CSS) ───────────── */

function _phaseGlitchBurst(root) {
  const g = document.createElement('div');
  g.className = 'hype-alert-glitch level-3 hrv-burst';
  g.innerHTML = `
    <div class="hype-glitch-noise"   aria-hidden="true"></div>
    <div class="hype-glitch-scan"    aria-hidden="true"></div>
    <div class="hype-glitch-tears"   aria-hidden="true">
      <span></span><span></span><span></span><span></span>
      <span></span><span></span><span></span><span></span>
    </div>
    <div class="hype-glitch-rgb"     aria-hidden="true"></div>
    <div class="hype-glitch-flash"   aria-hidden="true"></div>
    <div class="hype-glitch-blackout" aria-hidden="true"></div>
  `;
  root.appendChild(g);
  // Shake runs ~3s: it deliberately outlives this alert (dismissed at +4s by
  // powerOff) so the offline terminal appears while the screen still shakes.
  document.body.classList.add('hype-glitching', 'hype-glitching-3');
  setTimeout(() => {
    document.body.classList.remove('hype-glitching', 'hype-glitching-3');
  }, 3000);
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

// ponytail: WebAudio beeps instead of an audio asset — swap for a real
// countdown track if one gets produced.
function _tickSound() {
  let ctx = null;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return () => {}; }
  return (accent) => {
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = accent ? 1180 : 780;
      g.gain.setValueAtTime(0.22, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.2);
    } catch { }
  };
}

// Play a one-shot track; returns a state object whose .failed flips true
// when the file is missing, so callers can fall back to synthesized sound.
function _playTrack(root, src, volume) {
  const state = { failed: false };
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.volume = volume;
  audio.addEventListener('error', () => { state.failed = true; });
  const play = audio.play();
  if (play && typeof play.catch === 'function') play.catch(() => { state.failed = true; });
  _onRemoved(root, () => { try { audio.pause(); audio.src = ''; } catch { } });
  return state;
}

function _loopAudio(root, src, volume) {
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.loop = true;
  audio.volume = volume;
  const play = audio.play();
  if (play && typeof play.catch === 'function') play.catch(() => { });
  _onRemoved(root, () => { try { audio.pause(); audio.src = ''; } catch { } });
}

function _onRemoved(root, fn) {
  const observer = new MutationObserver(() => {
    if (!root.isConnected) { observer.disconnect(); fn(); }
  });
  queueMicrotask(() => {
    if (root.parentNode) observer.observe(root.parentNode, { childList: true });
  });
}
