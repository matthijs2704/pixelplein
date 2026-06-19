// Alert renderer: hype-prelaunch
// Infinite idle teaser shown before the first Launch. Distinct from Offline
// (which signals failure) — this is anticipation. Cleared by launchPlatform
// dispatching alert_dismiss for id="hype-prelaunch-active".
//
// Vibe: dim greyscale brand wordmark, slow gradient breathing, drifting
// particles, one slow pulse dot, "binnenkort live" subtitle. No content,
// no boot lines, just calm pre-show energy.

export function renderPreLaunchAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-prelaunch';
  root.dataset.alertId = alert.id;

  const subtitle = alert.payload?.subtitle || 'binnenkort live op het kamp';

  root.innerHTML = `
    <div class="hp-bg" aria-hidden="true">
      <div class="hp-bg-gradient"></div>
      <div class="hp-particles"></div>
    </div>
    <div class="hp-stage">
      <div class="hp-wordmark">DeHype</div>
      <div class="hp-sub">${escape(subtitle)}</div>
      <div class="hp-pulse"><span></span></div>
    </div>
  `;

  // Loop the "Ticket Ink" ambient bed underneath the idle teaser.
  _playPreLaunchAudio(root);

  // Spawn ~14 slow drifting particles for some life.
  const host = root.querySelector('.hp-particles');
  if (host) {
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('span');
      p.className = 'hp-particle';
      p.style.left = `${Math.random() * 100}%`;
      p.style.animationDelay = `${Math.random() * 18}s`;
      p.style.animationDuration = `${14 + Math.random() * 12}s`;
      p.style.setProperty('--p-size', `${3 + Math.random() * 5}px`);
      p.style.setProperty('--p-hue', String(Math.floor(Math.random() * 360)));
      host.appendChild(p);
    }
  }

  return root;
}

function _playPreLaunchAudio(root) {
  const audio = new Audio('/modules/hype/audio/prelaunch.wav');
  audio.preload = 'auto';
  audio.loop = true;
  audio.volume = 0.55;
  const play = audio.play();
  if (play && typeof play.catch === 'function') play.catch(() => {});

  const stop = () => { try { audio.pause(); audio.src = ''; } catch {} };
  const observer = new MutationObserver(() => {
    if (!root.isConnected) { observer.disconnect(); stop(); }
  });
  queueMicrotask(() => {
    if (root.parentNode) observer.observe(root.parentNode, { childList: true });
  });
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
