// Alert renderer: hype-prelaunch
// Infinite idle holding screen before the launch. Calm but branded:
// dark stage, logo, LIVE / DEEL / HYPE taglines matching the camp t-shirt.
// Cleared by launchPlatform dispatching alert_dismiss id="hype-prelaunch-active".

export function renderPreLaunchAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-prelaunch';
  root.dataset.alertId = alert.id;

  root.innerHTML = `
    <div class="hp-bg" aria-hidden="true">
      <div class="hp-grid"></div>
      <div class="hp-scan"></div>
      <div class="hp-vignette"></div>
    </div>
    <div class="hp-ambient" aria-hidden="true">
      <span class="hp-ambient-sweep s1"></span>
      <span class="hp-ambient-sweep s2"></span>
      <span class="hp-ambient-pulse p1"></span>
      <span class="hp-ambient-pulse p2"></span>
    </div>
    <div class="hp-doodles" aria-hidden="true">
      ${_shirtDoodle('flame', 'd1')}
      ${_shirtDoodle('bolt', 'd2')}
      ${_shirtDoodle('heart', 'd3')}
      ${_shirtDoodle('squiggle', 'd4')}
      ${_shirtDoodle('smile', 'd5')}
      ${_shirtDoodle('spark', 'd6')}
      ${_shirtDoodle('loop', 'd7')}
      ${_shirtDoodle('x', 'd8')}
      ${_shirtDoodle('bolt', 'd9')}
      ${_shirtDoodle('heart', 'd10')}
    </div>
    <div class="hp-stage">
      <div class="hp-main">
        <img class="hp-logo" src="/themes/hype/assets/logo.svg" alt="de HYPE!" />
        <div class="hp-soon">
          <strong>binnenkort live</strong>
          <span>gaat over enkele dagen live · even geduld...</span>
        </div>
      </div>
      <div class="hp-taglines" aria-hidden="true">
        <div class="hp-tag hp-tag-live"><span>LIVE.</span></div>
        <div class="hp-tag hp-tag-deel"><span>DEEL.</span></div>
        <div class="hp-tag hp-tag-hype"><span>HYPE.</span></div>
      </div>
    </div>
  `;

  _playPreLaunchAudio(root);
  return root;
}

function _shirtDoodle(kind, cls) {
  const svg = {
    flame: `<svg viewBox="0 0 80 90"><path d="M45 5c8 18-2 25 10 38 7 8 10 15 10 24 0 14-11 23-25 23S15 80 15 66c0-13 8-22 15-32 4 10 10 13 17 7 6-6 2-17-2-36Z" fill="currentColor"/><path d="M39 54c7 8 10 13 10 20 0 8-6 13-14 13s-14-5-14-13c0-7 5-12 10-18 2 7 5 9 8-2Z" fill="#fff" opacity=".35"/></svg>`,
    bolt: `<svg viewBox="0 0 80 100"><path d="M48 4 18 53h20L30 96l32-55H42L48 4Z" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/></svg>`,
    heart: `<svg viewBox="0 0 96 84"><path d="M48 74C18 50 9 36 14 21c4-12 18-16 30-5l4 4 4-4c12-11 26-7 30 5 5 15-4 29-34 53Z" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/></svg>`,
    squiggle: `<svg viewBox="0 0 130 80"><path d="M7 42c20-30 36-30 48 0s28 30 48 0c7-10 13-16 20-18" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>`,
    smile: `<svg viewBox="0 0 92 92"><circle cx="46" cy="46" r="34" fill="none" stroke="currentColor" stroke-width="7"/><circle cx="34" cy="37" r="4" fill="currentColor"/><circle cx="58" cy="37" r="4" fill="currentColor"/><path d="M28 54c9 13 27 13 36 0" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>`,
    spark: `<svg viewBox="0 0 100 100"><path d="M50 7 58 39 91 50 58 61 50 93 42 61 9 50 42 39 50 7Z" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/><path d="M18 16 25 23M78 74l8 8" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>`,
    loop: `<svg viewBox="0 0 138 82"><path d="M8 48c26-28 52-28 58-4 5 19-26 25-31 8-5-16 23-27 52-22 17 3 30 12 43 27" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>`,
    x: `<svg viewBox="0 0 60 60"><path d="M16 16 44 44M44 16 16 44" stroke="currentColor" stroke-width="8" stroke-linecap="round"/></svg>`,
  }[kind] || '';
  return `<span class="hp-doodle hp-doodle-${kind} ${cls}">${svg}</span>`;
}

function _playPreLaunchAudio(root) {
  const audio = new Audio('/modules/hype/audio/prelaunch.wav');
  audio.preload = 'auto';
  audio.loop = true;
  audio.volume = 0.55;
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
