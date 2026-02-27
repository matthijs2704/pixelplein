// Overlay: scrolling ticker strip
// Appearance is driven by CSS custom properties; all have fallbacks matching the
// original hardcoded defaults so the ticker looks identical when no theme is active.

let _tickerEl   = null;
let _animFrame  = null;
let _pos        = 0;
let _speed      = 60; // px/s
let _lastTime   = null;

function createTicker(cfg) {
  const isTop = cfg.tickerPosition === 'top';
  const wrap = document.createElement('div');
  wrap.id = 'overlay-ticker';
  wrap.style.cssText = `
    position: fixed;
    left: var(--ticker-inset-x, 0px); right: var(--ticker-inset-x, 0px);
    ${isTop ? 'top: calc(0px + var(--ticker-offset-y, 0px));' : 'bottom: calc(0px + var(--ticker-offset-y, 0px));'}
    height: var(--ticker-height, 38px);
    background: var(--ticker-bg, rgba(0,0,0,0.75));
    border-radius: var(--ticker-radius, 0px);
    overflow: hidden;
    z-index: 900;
    display: flex;
    align-items: center;
  `;

  const inner = document.createElement('div');
  inner.id = 'overlay-ticker-inner';
  inner.style.cssText = `
    white-space: nowrap;
    font-size: var(--ticker-font-size, 18px);
    font-weight: var(--ticker-font-weight, 600);
    color: var(--ticker-color, #fff);
    will-change: transform;
    padding-left: 100vw;
    letter-spacing: var(--ticker-letter-spacing, 0.02em);
  `;
  inner.style.fontFamily = "var(--ticker-font-family, 'Segoe UI', system-ui, sans-serif)";
  inner.textContent = cfg.tickerText || '';

  wrap.appendChild(inner);
  return wrap;
}

function animateTicker(inner, speed) {
  _speed = speed;
  _pos   = 0;
  _lastTime = null;

  function step(ts) {
    if (_lastTime !== null) {
      const dt = (ts - _lastTime) / 1000;
      _pos += _speed * dt;

      // Reset when text has fully scrolled off screen
      if (_pos > inner.scrollWidth) _pos = -window.innerWidth;
      inner.style.transform = `translateX(${-_pos}px)`;
    }
    _lastTime  = ts;
    _animFrame = requestAnimationFrame(step);
  }

  if (_animFrame) cancelAnimationFrame(_animFrame);
  _animFrame = requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function mountTicker(cfg) {
  removeTicker();
  if (!cfg.tickerEnabled || !cfg.tickerText) return;

  _tickerEl = createTicker(cfg);
  document.body.appendChild(_tickerEl);
  const inner = _tickerEl.querySelector('#overlay-ticker-inner');
  animateTicker(inner, cfg.tickerSpeed || 60);
}

export function removeTicker() {
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
  if (_tickerEl)  { _tickerEl.remove(); _tickerEl = null; }
}
