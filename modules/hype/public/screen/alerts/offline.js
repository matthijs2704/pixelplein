// Alert renderer: hype-offline
// Theatrical power-down → infinite idle. Stays until Restart fires
// alert_dismiss for id="hype-offline-active".
//
// Beats:
//   0.0s  hard glitch tear (body shake) — platform being yanked
//   1.0s  CRT collapse — whole screen flashes white, snaps to a single
//         bright horizontal line, then a single white dot, then snuffs out
//   2.0s  pitch black, ambient breathing (faint scanlines drift, dead-pixel
//         flickers every few seconds)
//   4.0s  "DeHype is offline" card fades in slowly
//   ∞     stays until Restart

import { icon } from '../icons.js';

export function renderOfflineAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-offline';
  root.dataset.alertId = alert.id;

  const title = alert.message || 'DeHype is offline';
  const subtitle = alert.payload?.subtitle
    || 'het platform ligt eruit — iemand moet DeHype opnieuw opstarten';

  root.innerHTML = `
    <div class="ho-stage" aria-hidden="true">
      <div class="ho-flash"></div>
      <div class="ho-crt-line"></div>
      <div class="ho-crt-dot"></div>
    </div>

    <div class="ho-ambient" aria-hidden="true">
      <div class="ho-noise"></div>
      <div class="ho-vignette"></div>
      <div class="ho-dead-pixel" style="top:28%; left:62%"></div>
      <div class="ho-dead-pixel" style="top:71%; left:18%; animation-delay:2.1s"></div>
      <div class="ho-dead-pixel" style="top:44%; left:85%; animation-delay:3.7s"></div>
    </div>

    <div class="ho-card">
      <div class="ho-icon" aria-hidden="true">${icon.wifiOff(64)}</div>
      <div class="ho-title">${escape(title)}</div>
      <div class="ho-body">${escape(subtitle)}</div>
      <div class="ho-pulse">
        <span></span><span></span><span></span>
      </div>
      <div class="ho-foot">geen verbinding • wachten op herstart</div>
    </div>
  `;

  // Brief hard glitch on the underlying screen — only during the yank.
  document.body.classList.add('hype-glitching', 'hype-glitching-3');
  setTimeout(() => {
    document.body.classList.remove('hype-glitching-3');
    document.body.classList.add('hype-glitching-1');
  }, 700);
  setTimeout(() => {
    document.body.classList.remove('hype-glitching', 'hype-glitching-1');
  }, 1100);

  return root;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
