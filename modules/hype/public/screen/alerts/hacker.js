// Alert renderer: hype-hacker
// Theatrical full-screen takeover when Harry Ecker breaks in.
// Full-width alarm banner, large terminal, faint watermark in background.
//
// payload.lines  — override the typed lines (max 10)
// payload.target — creator handle Harry is targeting (shown in alarm sub)

const DEFAULT_LINES = [
  '> verbinding gemaakt met dehype.live...',
  '> authenticatie omzeild · niveau 2',
  '> creator-profiel geladen',
  '> privé-data ophalen...',
  '> foto-locaties: gevonden',
  '> persoonlijke info: toegang verkregen',
  '> jullie zien me niet aankomen  :)',
];

const DEFAULT_SIGNATURE = 'H · E · C · K · E · R';

export function renderHackerAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-hacker';
  root.dataset.alertId = alert.id;

  const lines = Array.isArray(alert.payload?.lines) && alert.payload.lines.length
    ? alert.payload.lines.slice(0, 10)
    : DEFAULT_LINES;
  const signature = String(alert.payload?.signature || DEFAULT_SIGNATURE);
  const target = alert.payload?.target ? `· doelwit: @${escape(alert.payload.target)}` : '';

  const bodyId = `hh-body-${escapeAttr(alert.id)}`;

  root.innerHTML = `
    <div class="hype-hacker-watermark" aria-hidden="true">h4rr3ck3r</div>
    <div class="hype-hacker-scan"    aria-hidden="true"></div>
    <div class="hype-hacker-vignette" aria-hidden="true"></div>

    <div class="hype-hacker-alarm" role="alert">
      <span class="hype-hacker-alarm-dot"></span>
      <span class="hype-hacker-alarm-text">BEVEILIGINGSLEK GEDETECTEERD</span>
      <span class="hype-hacker-alarm-sub">onbevoegde toegang · h4rr3ck3r ${target}</span>
    </div>

    <div class="hype-hacker-term">
      <div class="hype-hacker-bar">
        <span class="hype-hacker-dot r"></span>
        <span class="hype-hacker-dot y"></span>
        <span class="hype-hacker-dot g"></span>
        <span class="hype-hacker-title">bash — hype-server.nl · ONBEVEILIGD</span>
      </div>
      <div class="hype-hacker-body" id="${bodyId}"></div>
    </div>
  `;

  const body = root.querySelector(`[id="${bodyId}"]`);
  _typeLines(body, lines);
  return root;
}

function _typeLines(container, lines) {
  if (!container) return;
  let i = 0, j = 0, lineEl = null;
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
      lineEl = null; i++; j = 0;
    }
  }, 36);
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escapeAttr(s) { return String(s).replace(/[^a-z0-9_-]/gi, '-'); }
