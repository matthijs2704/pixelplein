// Alert renderer: hype-glitch
// Pure screen-glitch effect — no content takeover. The photo wall/feed
// underneath stays visible; we shake the screen, add scanlines + RGB fringe,
// flash occasional black/colour frames.
//
// Level is operator-controlled through payload.level (1-3):
//   1 → barely-there twitch
//   2 → clear shake + colour flash
//   3 → hard scramble with blackout frames
//
// Implementation: the renderer adds a class to document.body so the screen
// container itself shakes (CSS animates #screen). The alert root carries the
// scanline/colour overlay. Both are torn down on the alert's lifetime end via
// a setTimeout matching durationSec.

const LEVEL_CONFIG = {
  1: { bodyClass: 'hype-glitching-1', durationSec: 1.2 },
  2: { bodyClass: 'hype-glitching-2', durationSec: 2.0 },
  3: { bodyClass: 'hype-glitching-3', durationSec: 3.0 },
};

function _resolveLevel(payload) {
  if (Number.isFinite(Number(payload?.level))) {
    return Math.max(1, Math.min(3, Number(payload.level) | 0));
  }
  return 1;
}

export function renderGlitchAlert(alert) {
  const level = _resolveLevel(alert.payload);
  const cfg = LEVEL_CONFIG[level];

  const root = document.createElement('div');
  root.className = `hype-alert hype-alert-glitch level-${level}`;
  root.dataset.alertId = alert.id;
  // Overlay-only — no content. Layered noise, scanline, colour flash divs.
  root.innerHTML = `
    <div class="hype-glitch-noise"   aria-hidden="true"></div>
    <div class="hype-glitch-scan"    aria-hidden="true"></div>
    <div class="hype-glitch-rgb"     aria-hidden="true"></div>
    <div class="hype-glitch-flash"   aria-hidden="true"></div>
    <div class="hype-glitch-blackout" aria-hidden="true"></div>
  `;

  // Shake the actual screen container via a body class.
  document.body.classList.add('hype-glitching', cfg.bodyClass);

  const durationMs = Math.round((Number(alert.payload?.durationSec) || cfg.durationSec) * 1000);
  setTimeout(() => {
    document.body.classList.remove('hype-glitching', cfg.bodyClass);
  }, durationMs);

  return root;
}
