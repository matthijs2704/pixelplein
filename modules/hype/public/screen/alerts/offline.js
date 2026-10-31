// Alert renderer: hype-offline
// Theatrical power-down for kids 7-11. ~25s total, stays until Restart fires.
//
// Timeline:
//   0.0s  Harry's terminal fills the screen — identical to standalone hacker
//   0.3s  Hack lines type out, escalating: green → yellow → red → Harry panics
//   6.5s  Red alarm FRAME slams around the whole screen
//   6.5s  "KRITIEK SYSTEEM ALARM" banner drops from top, terminal shakes
//   7.0s  BIG countdown: 3… red flash  8.0s 2… red flash  9.0s 1… red flash
//  10.5s  Terminal exits, massive white FLASH
//  11.0s  CRT line collapses → dot → gone
//  13.0s  Ambient noise + dead pixels
//  15.0s  "DE HYPE IS NEER" materialises in RED
//   ∞     Stays until Restart fires alert_dismiss id="hype-offline-active"

const HACK_LINES = [
  { text: '> verbinding gemaakt met dehype.live…', cls: '' },
  { text: '> authenticatie omzeild · niveau 4', cls: '' },
  { text: '> privé-data: volledige toegang…', cls: '' },
  { text: '> FOUT: beveiligingsgrens overschreden!!', cls: 'warn' },
  { text: '> KRITIEK: systeemkern instabiel!!!', cls: 'fatal' },
  { text: '> h4rr3ck3r: nee nee nee…', cls: 'harry' },
  { text: '> [AUTOMATISCHE AFSLUITING GESTART]', cls: 'fatal' },
];

// Gap (ms) after each line before the next appears
const LINE_GAPS = [700, 700, 1000, 1200, 900, 900];

export function renderOfflineAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-offline';
  root.dataset.alertId = alert.id;

  const title = alert.message || 'DE HYPE\nLIGT PLAT';
  const subtitle = alert.payload?.subtitle || 'kritieke systeemfout\nalle diensten uitgeschakeld';
  const id = _eid(alert.id);
  // instant mode (admin "direct offline"): skip the ~15s hack/countdown/CRT
  // intro and the powerdown audio — jump straight to the dead-screen state
  const instant = !!alert.payload?.instant;
  if (instant) root.classList.add('ho-instant');

  root.innerHTML = `
    <!-- Harry's terminal: fullscreen, same visual as standalone hacker, exits at 10.5s -->
    <div class="ho-hack">
      <div class="hype-hacker-watermark" aria-hidden="true">h4rr3ck3r</div>
      <div class="hype-hacker-scan" aria-hidden="true"></div>
      <div class="hype-hacker-vignette" aria-hidden="true"></div>
      <div class="hype-hacker-alarm" role="alert">
        <span class="hype-hacker-alarm-dot"></span>
        <span class="hype-hacker-alarm-text">BEVEILIGINGSLEK GEDETECTEERD</span>
        <span class="hype-hacker-alarm-sub">onbevoegde toegang · h4rr3ck3r</span>
      </div>
      <div class="hype-hacker-term">
        <div class="hype-hacker-bar">
          <span class="hype-hacker-dot r"></span>
          <span class="hype-hacker-dot y"></span>
          <span class="hype-hacker-dot g"></span>
          <span class="hype-hacker-title">bash — hype-server.nl · ONBEVEILIGD</span>
        </div>
        <div class="hype-hacker-body" id="ho-lines-${id}"></div>
      </div>
    </div>

    <!-- KRITIEK alarm banner (6.5s+, separate from hack container) -->
    <div class="ho-alarm-banner" aria-hidden="true">⚠ &nbsp; KRITIEK SYSTEEM ALARM &nbsp; ⚠</div>

    <!-- Red border frame around the whole screen (6.5–10.5s) -->
    <div class="ho-alarm-frame" aria-hidden="true"></div>

    <!-- Red flash on each countdown beat (7s, 8s, 9s) -->
    <div class="ho-cd-beat" style="animation-delay:7.0s" aria-hidden="true"></div>
    <div class="ho-cd-beat" style="animation-delay:8.0s" aria-hidden="true"></div>
    <div class="ho-cd-beat" style="animation-delay:9.0s" aria-hidden="true"></div>

    <!-- Big countdown overlay (7.0–10.2s) -->
    <div class="ho-countdown" aria-hidden="true">
      <div class="ho-countdown-label">SYSTEEM AFSLUITING OVER</div>
      <div class="ho-countdown-num" id="ho-cd-${id}">3</div>
    </div>

    <!-- CRT collapse sequence (10.5–13s) -->
    <div class="ho-stage" aria-hidden="true">
      <div class="ho-flash"></div>
      <div class="ho-crt-line"></div>
      <div class="ho-crt-dot"></div>
    </div>

    <!-- Ambient dead-screen (13s+) -->
    <div class="ho-ambient" aria-hidden="true">
      <div class="ho-noise"></div>
      <div class="ho-vignette"></div>
      <div class="ho-dead-pixel" style="top:14%;left:62%"></div>
      <div class="ho-dead-pixel" style="top:71%;left:18%;animation-delay:2.1s"></div>
      <div class="ho-dead-pixel" style="top:44%;left:85%;animation-delay:3.7s"></div>
      <div class="ho-dead-pixel" style="top:28%;left:34%;animation-delay:1.3s"></div>
      <div class="ho-dead-pixel" style="top:82%;left:56%;animation-delay:4.4s"></div>
    </div>

    <!-- Offline title: materialises red from the dark (15s+) -->
    <div class="ho-card">
      <div class="ho-title">${_fmt(title)}</div>
      <div class="ho-body">${_fmt(subtitle)}</div>
      <div class="ho-pulse"><span></span><span></span><span></span></div>
      <div class="ho-foot">geen verbinding &nbsp;·&nbsp; wachten op herstart</div>
    </div>
  `;

  // Type hack lines — terminal is immediately visible so start at 300ms
  const linesEl = root.querySelector(`#ho-lines-${id}`);
  if (linesEl && !instant) {
    let delay = 300;
    HACK_LINES.forEach((line, i) => {
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'hype-hacker-line' + (line.cls ? ' ho-line-' + line.cls : '');
        el.textContent = line.text;
        linesEl.appendChild(el);
      }, delay);
      delay += LINE_GAPS[i] ?? 700;
    });
  }

  // Countdown ticks: CSS shows at 7s, JS changes the number
  const cdNum = root.querySelector(`#ho-cd-${id}`);
  if (cdNum && !instant) {
    setTimeout(() => { cdNum.textContent = '2'; cdNum.classList.add('bump'); setTimeout(() => cdNum.classList.remove('bump'), 400); }, 8000);
    setTimeout(() => { cdNum.textContent = '1'; cdNum.classList.add('bump'); setTimeout(() => cdNum.classList.remove('bump'), 400); }, 9000);
  }

  if (!instant) _playPowerDownAudio(root);

  return root;
}

function _fmt(s) {
  return String(s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    .replace(/\n/g, '<br>');
}
function _eid(s) { return String(s).replace(/[^a-z0-9_-]/gi, '-'); }

function _playPowerDownAudio(root) {
  const audio = new Audio('/modules/hype/audio/powerdown.wav');
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

