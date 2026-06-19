// Alert renderer: hype-hacker
// Theatrical full-screen takeover when Harry Ecker tries to break in.
// Welpen-friendly Dutch + dramatic enough to feel like a real moment.
//
// Layout:
//   - red flashing "INDRINGER" alarm bar at the top
//   - dark terminal panel in the middle, lines type out
//   - flickering "HARRY ECKER" signature underneath
//   - subtle scanlines + vignette
//
// payload.lines overrides the default script. Default hints at the password
// puzzle (huisdier-naam + geboortedatum) which the kids unlock later.

const DEFAULT_LINES = [
  '> verbinding gemaakt met dehype.live',
  '> wachtwoord raden gestart…',
  '> hint 1: naam van een huisdier',
  '> hint 2: + geboortedatum',
  '> nog 9 998 combinaties te gaan',
  '> jullie zien me niet aankomen',
];

const DEFAULT_SIGNATURE = 'HARRY · ECKER';

export function renderHackerAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-hacker';
  root.dataset.alertId = alert.id;

  const lines = Array.isArray(alert.payload?.lines) && alert.payload.lines.length
    ? alert.payload.lines.slice(0, 10)
    : DEFAULT_LINES;
  const signature = String(alert.payload?.signature || DEFAULT_SIGNATURE);

  const bodyId = `hype-hacker-body-${escapeAttr(alert.id)}`;

  root.innerHTML = `
    <div class="hype-hacker-scan" aria-hidden="true"></div>
    <div class="hype-hacker-vignette" aria-hidden="true"></div>

    <div class="hype-hacker-alarm" role="alert">
      <span class="hype-hacker-alarm-dot"></span>
      <span class="hype-hacker-alarm-text">INDRINGER GEDETECTEERD</span>
      <span class="hype-hacker-alarm-sub">iemand probeert binnen te komen</span>
    </div>

    <div class="hype-hacker-term">
      <div class="hype-hacker-bar">
        <span class="hype-hacker-dot"></span>
        <span class="hype-hacker-dot"></span>
        <span class="hype-hacker-dot"></span>
        <span class="hype-hacker-title">security-log@dehype</span>
      </div>
      <div class="hype-hacker-head">
        <span>onbekende gebruiker</span>
        <strong>toegangspoging</strong>
      </div>
      <div class="hype-hacker-body" id="${bodyId}"></div>
    </div>

    <div class="hype-hacker-signature" data-text="${escape(signature)}">${escape(signature)}</div>
  `;

  const body = root.querySelector(`#${cssId(alert.id) ? 'hype-hacker-body-' + cssId(alert.id) : bodyId}`)
    || root.querySelector(`[id="${bodyId}"]`);
  _typeLines(body, lines);
  return root;
}

function _typeLines(container, lines) {
  if (!container) return;
  let i = 0, j = 0;
  let lineEl = null;
  const TICK = 38;
  const t = setInterval(() => {
    if (i >= lines.length) { clearInterval(t); return; }
    if (!lineEl) {
      lineEl = document.createElement('div');
      lineEl.className = 'hype-hacker-line';
      container.appendChild(lineEl);
    }
    const line = lines[i];
    if (j < line.length) {
      lineEl.textContent = line.slice(0, j + 1) + '▌';
      j++;
    } else {
      lineEl.textContent = line;
      lineEl = null;
      i++;
      j = 0;
    }
  }, TICK);
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escapeAttr(s) { return String(s).replace(/[^a-z0-9_-]/gi, '-'); }
function cssId(s)      { try { return CSS.escape(escapeAttr(s)); } catch { return ''; } }
