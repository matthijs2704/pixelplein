// Overlay: corner QR widget (small persistent QR code)
// Uses the same server-generated QR PNG as the QR slide type.
// Appearance is driven by CSS custom properties; all have fallbacks matching the
// original hardcoded defaults so the widget looks identical when no theme is active.

let _qrBugEl  = null;
let _lastUrl  = null;

// --qr-bug-offset-top/bottom/left/right nudge the QR bug away from each
// respective edge, applied based on which corner is active.
function cornerStyle(corner, safeInsets = {}) {
  const top    = 12 + (safeInsets.top    || 0);
  const bottom = 12 + (safeInsets.bottom || 0);
  switch (corner) {
    case 'top-left':     return `top: calc(${top}px + var(--qr-bug-offset-top, 0px)); left: calc(14px + var(--qr-bug-offset-left, 0px));`;
    case 'top-right':    return `top: calc(${top}px + var(--qr-bug-offset-top, 0px)); right: calc(14px + var(--qr-bug-offset-right, 0px));`;
    case 'bottom-left':  return `bottom: calc(${bottom}px + var(--qr-bug-offset-bottom, 0px)); left: calc(14px + var(--qr-bug-offset-left, 0px));`;
    case 'bottom-right': return `bottom: calc(${bottom}px + var(--qr-bug-offset-bottom, 0px)); right: calc(14px + var(--qr-bug-offset-right, 0px));`;
    default:             return `bottom: calc(${bottom}px + var(--qr-bug-offset-bottom, 0px)); right: calc(14px + var(--qr-bug-offset-right, 0px));`;
  }
}

export async function mountQrBug(cfg, safeInsets = {}) {
  removeQrBug();
  if (!cfg.qrBugEnabled || !cfg.qrBugUrl) return;

  // Only re-fetch if URL changed
  let imgSrc = '';
  try {
    const res  = await fetch(`/api/slides/qr?url=${encodeURIComponent(cfg.qrBugUrl)}`);
    const data = await res.json();
    imgSrc = data.url || '';
  } catch { return; }

  if (!imgSrc) return;

  const el = document.createElement('div');
  el.id = 'overlay-qr-bug';
  el.style.cssText = `
    position: fixed;
    ${cornerStyle(cfg.qrBugCorner, safeInsets)}
    z-index: 901;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: var(--qr-bug-bg, rgba(0,0,0,0.65));
    border-radius: var(--qr-bug-radius, 10px);
    padding: var(--qr-bug-padding, 8px);
  `;

  const img = document.createElement('img');
  img.src = imgSrc;
  img.style.cssText = 'width: var(--qr-bug-size, min(10vw, 100px)); height: auto; display: block; border-radius: 4px;';
  el.appendChild(img);

  if (cfg.qrBugLabel) {
    const label = document.createElement('div');
    label.style.cssText = `
      font-size: var(--qr-bug-label-size, 11px);
      color: var(--qr-bug-label-color, #fff);
      text-align: center;
      max-width: 12vw;
      font-weight: 600;
    `;
    label.style.fontFamily = 'var(--qr-bug-label-font-family, "Segoe UI", system-ui, sans-serif)';
    label.textContent = cfg.qrBugLabel;
    el.appendChild(label);
  }

  document.body.appendChild(el);
  _qrBugEl = el;
  _lastUrl  = cfg.qrBugUrl;
}

export function removeQrBug() {
  if (_qrBugEl) { _qrBugEl.remove(); _qrBugEl = null; }
  _lastUrl = null;
}
