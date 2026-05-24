// Alert renderer: hype-hacker
// Terminal-style typing message. Default copy hints at Harry Ecker's
// presence; payload.lines can override.

export function renderHackerAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-hacker';
  root.dataset.alertId = alert.id;

  const lines = Array.isArray(alert.payload?.lines) ? alert.payload.lines : [
    '> connecting to dehype.platform',
    '> bypassing firewall…',
    '> ik ben hier',
    '> jullie kennen mij niet',
    '> maar ik ken jullie wel',
  ];

  root.innerHTML = `
    <div class="hype-hacker-term">
      <div class="hype-hacker-bar">
        <span class="hype-hacker-dot"></span>
        <span class="hype-hacker-dot"></span>
        <span class="hype-hacker-dot"></span>
        <span class="hype-hacker-title">root@dehype:~</span>
      </div>
      <div class="hype-hacker-body" id="hype-hacker-body-${escapeAttr(alert.id)}"></div>
    </div>
  `;

  const body = root.querySelector(`#hype-hacker-body-${cssId(alert.id)}`);
  _typeLines(body, lines);
  return root;
}

function _typeLines(container, lines) {
  let i = 0, j = 0;
  let lineEl = null;
  const TICK = 35;
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

function escapeAttr(s) { return String(s).replace(/[^a-z0-9_-]/gi, '-'); }
function cssId(s)      { return CSS.escape(escapeAttr(s)); }
