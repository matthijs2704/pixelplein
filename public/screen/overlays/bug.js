// Overlay: corner bug (text or image)
// Appearance is driven by CSS custom properties; all have fallbacks matching the
// original hardcoded defaults so the bug looks identical when no theme is active.

let _bugEl = null;

// --bug-offset-top/bottom/left/right nudge the bug away from each respective
// edge. The theme sets these independently so the correct offset is used
// regardless of which corner the user picks in the admin UI.
function cornerStyle(corner, safeInsets = {}) {
  const top    = 12 + (safeInsets.top    || 0);
  const bottom = 12 + (safeInsets.bottom || 0);
  switch (corner) {
    case 'top-left':     return `top: calc(${top}px + var(--bug-offset-top, 0px)); left: calc(14px + var(--bug-offset-left, 0px));`;
    case 'top-right':    return `top: calc(${top}px + var(--bug-offset-top, 0px)); right: calc(14px + var(--bug-offset-right, 0px));`;
    case 'bottom-left':  return `bottom: calc(${bottom}px + var(--bug-offset-bottom, 0px)); left: calc(14px + var(--bug-offset-left, 0px));`;
    case 'bottom-right': return `bottom: calc(${bottom}px + var(--bug-offset-bottom, 0px)); right: calc(14px + var(--bug-offset-right, 0px));`;
    default:             return `top: calc(${top}px + var(--bug-offset-top, 0px)); right: calc(14px + var(--bug-offset-right, 0px));`;
  }
}

export function mountBug(cfg, safeInsets = {}) {
  removeBug();
  if (!cfg.bugEnabled) return;
  if (!cfg.bugText && !cfg.bugImageUrl) return;

  const el = document.createElement('div');
  el.id = 'overlay-bug';
  el.style.cssText = `
    position: fixed;
    ${cornerStyle(cfg.bugCorner, safeInsets)}
    z-index: 901;
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bug-bg, rgba(0,0,0,0.55));
    border-radius: var(--bug-radius, 6px);
    padding: var(--bug-padding, 5px 10px);
    max-width: 25vw;
  `;

  if (cfg.bugImageUrl) {
    const img = document.createElement('img');
    img.src = cfg.bugImageUrl;
    img.style.cssText = 'height: 28px; width: auto; object-fit: contain;';
    el.appendChild(img);
  }

  if (cfg.bugText) {
    const span = document.createElement('span');
    span.style.cssText = `
      font-size: var(--bug-font-size, 15px);
      font-weight: var(--bug-font-weight, 700);
      color: var(--bug-color, #fff);
      white-space: nowrap;
    `;
    span.style.fontFamily = 'var(--bug-font-family, "Segoe UI", system-ui, sans-serif)';
    span.textContent = cfg.bugText;
    el.appendChild(span);
  }

  document.body.appendChild(el);
  _bugEl = el;
}

export function removeBug() {
  if (_bugEl) { _bugEl.remove(); _bugEl = null; }
}
