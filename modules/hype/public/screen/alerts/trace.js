// Alert renderer: hype-trace
// Mark Suikerberg traces the hack back to its source. Harry used no VPN, so:
// terminal trace → radar lock → cinematic zoom over real OSM map tiles
// (Netherlands → the parking lot) → pin + location name. Stays on screen
// until dismissed from admin; the infinite offline alert sits underneath.
//
// payload.location — display name of the spot ("Parkeerplaats …")
// payload.lat/lon  — WGS84 target; without valid coords (or without tiles)
//                    the scene ends in the radar view with the location name.
//
// Tiles come from our own caching proxy (/api/modules/hype/tiles/z/x/y) so
// the night game does not depend on festival wifi once prefetched.

const TILE = 256;
const GRID = 5;              // 5×5 tiles per zoom level
const ZOOM_MIN = 8;          // country view
const ZOOM_MAX = 17;         // parking-lot view
const ZOOM_STEP_MS = 1500;   // per zoom level

const TRACE_LINES = [
  '> herstelconsole — M. Suikerberg',
  '> bron van de hack traceren…',
  '> VPN-check: GEEN VPN GEDETECTEERD',
  '> amateur. signaal ligt open.',
  '> IP-adres herleiden…',
  '> locatie gevonden.',
];

export function renderTraceAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-trace';
  root.dataset.alertId = alert.id;

  const location = String(alert.payload?.location || 'Onbekende locatie');
  const lat = Number(alert.payload?.lat);
  const lon = Number(alert.payload?.lon);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

  root.innerHTML = `
    <!-- CRT power-on out of the dead offline screen (0–2.4s):
         dot → line → screen opens, then the console is revealed. -->
    <div class="ht-boot" aria-hidden="true">
      <span class="ht-boot-dot"></span>
      <span class="ht-boot-line"></span>
    </div>
    <div class="ht-header">
      <span class="ht-header-dot"></span>
      <span class="ht-header-text">SIGNAAL TRACEREN</span>
      <span class="ht-header-sub">herstelconsole · M. Suikerberg</span>
      <span class="ht-coords">--.------ , -.------</span>
    </div>
    <div class="ht-stage"></div>
    <div class="ht-scan" aria-hidden="true"></div>
  `;

  const stage = root.querySelector('.ht-stage');
  const coordsEl = root.querySelector('.ht-coords');
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  _onRemoved(root, () => timers.forEach(clearTimeout));

  // Optional soundtrack for the trace (see timing sheet); missing file is fine.
  const audio = new Audio('/modules/hype/audio/trace.wav');
  audio.preload = 'auto';
  audio.volume = 0.9;
  const play = audio.play();
  if (play && typeof play.catch === 'function') play.catch(() => { });
  _onRemoved(root, () => { try { audio.pause(); audio.src = ''; } catch { } });

  // Timeline: CRT-on (2.2s) → terminal → radar (10s) → map zoom (15s).
  later(() => root.classList.add('ht-on'), 2000);
  later(() => _phaseTerminal(stage, coordsEl, hasCoords ? { lat, lon } : null, timers), 2200);
  later(() => _phaseRadar(stage, location), 10000);
  if (hasCoords) {
    later(() => _phaseMapZoom(root, stage, { lat, lon, location }), 15000);
  }
  return root;
}

/* ── Phase 1: terminal with ticking coordinates ──────────────────────── */

function _phaseTerminal(stage, coordsEl, target, timers) {
  stage.innerHTML = `
    <div class="hype-hacker-term ht-term">
      <div class="hype-hacker-bar">
        <span class="hype-hacker-dot r"></span>
        <span class="hype-hacker-dot y"></span>
        <span class="hype-hacker-dot g"></span>
        <span class="hype-hacker-title">trace — dehype herstelconsole</span>
      </div>
      <div class="hype-hacker-body"></div>
    </div>
  `;
  typeLines(stage.querySelector('.hype-hacker-body'), TRACE_LINES);

  // Ticking coordinate readout that converges on the target.
  const t0 = Date.now();
  const tick = setInterval(() => {
    const p = Math.min(1, (Date.now() - t0) / 7000);
    const jitter = (1 - p) * 4;
    const lat = (target ? target.lat : 52.1) + (Math.random() - 0.5) * jitter;
    const lon = (target ? target.lon : 5.3) + (Math.random() - 0.5) * jitter;
    coordsEl.textContent = `${lat.toFixed(6)} , ${lon.toFixed(6)}`;
    if (p >= 1) clearInterval(tick);
  }, 90);
  timers.push(tick);
}

/* ── Phase 2: radar lock ─────────────────────────────────────────────── */

function _phaseRadar(stage, location) {
  stage.innerHTML = `
    <div class="ht-radar">
      <div class="ht-radar-rings" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="ht-radar-cross" aria-hidden="true"></div>
      <div class="ht-radar-sweep" aria-hidden="true"></div>
      <div class="ht-radar-blip"></div>
    </div>
    <div class="ht-label">
      <strong>SIGNAAL VERGRENDELD</strong>
      <span class="ht-label-loc"></span>
    </div>
  `;
  stage.querySelector('.ht-label-loc').textContent = location;
}

/* ── Phase 3: cinematic OSM tile zoom onto the target ────────────────── */

function _phaseMapZoom(root, stage, { lat, lon, location }) {
  // Probe the deepest tile first: no tile (offline + empty cache) → stay
  // in the radar view, which already shows the location name.
  const probe = new Image();
  probe.onerror = () => { /* radar fallback — do nothing */ };
  probe.onload = () => _startMapZoom(root, stage, { lat, lon, location });
  const { x, y } = _tileXY(lat, lon, ZOOM_MAX);
  probe.src = _tileUrl(ZOOM_MAX, Math.floor(x), Math.floor(y));
}

function _startMapZoom(root, stage, { lat, lon, location }) {
  root.classList.add('ht-mapmode');
  // Base scale so the 5×5 grid always covers the viewport (and a bit more).
  const gridPx = GRID * TILE;
  const base = Math.max(window.innerWidth, window.innerHeight) / gridPx * 1.25;

  stage.innerHTML = `
    <div class="ht-map"></div>
    <div class="ht-map-tint" aria-hidden="true"></div>
    <div class="ht-crosshair" aria-hidden="true"><span></span><span></span></div>
    <div class="ht-pin" aria-hidden="true"></div>
    <div class="ht-map-label">
      <strong>HIER ZIT HIJ</strong>
      <span class="ht-label-loc"></span>
      <em>${lat.toFixed(5)} , ${lon.toFixed(5)}</em>
    </div>
  `;
  stage.querySelector('.ht-label-loc').textContent = location;

  const map = stage.querySelector('.ht-map');
  const levels = [];
  for (let z = ZOOM_MIN; z <= ZOOM_MAX; z++) levels.push(z);

  levels.forEach((z, i) => {
    setTimeout(() => {
      const level = _buildLevel(z, lat, lon);
      const isLast = i === levels.length - 1;
      level.style.setProperty('--s0', base);
      level.style.setProperty('--s1', base * 2);
      level.style.animation = isLast
        ? `ht-level-settle 1200ms ease-out forwards`
        : `ht-level-zoom ${ZOOM_STEP_MS}ms linear forwards`;
      map.appendChild(level);
      // Keep the DOM shallow: older levels are fully covered, drop them.
      while (map.children.length > 2) map.firstChild.remove();
      if (isLast) root.classList.add('ht-locked');
    }, i * ZOOM_STEP_MS);
  });
}

// One zoom level: a GRID×GRID tile patch positioned so (lat,lon) sits at
// the exact center of the viewport.
function _buildLevel(z, lat, lon) {
  const { x, y } = _tileXY(lat, lon, z);
  const cx = Math.floor(x), cy = Math.floor(y);
  const half = Math.floor(GRID / 2);
  const level = document.createElement('div');
  level.className = 'ht-map-level';
  // Pixel offset of the target inside the patch (origin = patch top-left).
  const px = (x - (cx - half)) * TILE;
  const py = (y - (cy - half)) * TILE;
  level.style.setProperty('--ox', `${px}px`);
  level.style.setProperty('--oy', `${py}px`);
  const max = 2 ** z;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const img = document.createElement('img');
      const tx = cx + dx, ty = cy + dy;
      img.style.left = `${(dx + half) * TILE}px`;
      img.style.top = `${(dy + half) * TILE}px`;
      img.onerror = () => { img.style.visibility = 'hidden'; };
      if (tx >= 0 && ty >= 0 && tx < max && ty < max) {
        img.src = _tileUrl(z, tx, ty);
      } else {
        img.style.visibility = 'hidden';
      }
      level.appendChild(img);
    }
  }
  return level;
}

/* ── Slippy-map math + tile source ───────────────────────────────────── */

function _tileXY(lat, lon, z) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

function _tileUrl(z, x, y) {
  return `/api/modules/hype/tiles/${z}/${x}/${y}`;
}

// Char-by-char terminal typing (same effect as the offline hack terminal).
function typeLines(container, lines) {
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

function _onRemoved(root, fn) {
  const observer = new MutationObserver(() => {
    if (!root.isConnected) { observer.disconnect(); fn(); }
  });
  queueMicrotask(() => {
    if (root.parentNode) observer.observe(root.parentNode, { childList: true });
  });
}
