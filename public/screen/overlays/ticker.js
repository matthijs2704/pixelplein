// Overlay: scrolling / fading ticker strip
//
// Modes
//   scroll — all messages joined with ' · ' and scrolled continuously
//   fade   — one message at a time; fade-out → fade-in, dwell configurable
//
// Alignment (fade mode only)
//   start  — text anchored to the left edge (default)
//   center — text centered in the strip
//   end    — text anchored to the right edge
//
// Appearance is driven by CSS custom properties; all have fallbacks matching
// the original hardcoded defaults so the ticker looks identical when no theme
// is active.

let _tickerEl   = null;
let _animFrame  = null;
let _fadeTimer  = null;
let _pos        = 0;
let _speed      = 60; // px/s  (scroll mode)
let _lastTime   = null;

// Fade-mode state
let _messages    = [];  // array of strings
let _msgIndex    = 0;
let _dwellMs     = 5000;

// ---------------------------------------------------------------------------
// DOM builders
// ---------------------------------------------------------------------------

function _createWrap(cfg) {
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
  return wrap;
}

function _createInner(text) {
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
    transition: opacity 0.5s ease;
  `;
  inner.style.fontFamily = "var(--ticker-font-family, 'Segoe UI', system-ui, sans-serif)";
  inner.textContent = text;
  return inner;
}

// Map tickerAlign → CSS justify-content value for the wrap element
function _justifyContent(align) {
  if (align === 'center') return 'center';
  if (align === 'end')    return 'flex-end';
  return 'flex-start';
}

// Map tickerAlign → left/right padding for the inner element in fade mode
function _fadePadding(align) {
  if (align === 'center') return '0 32px';
  if (align === 'end')    return '0 16px 0 0';
  return '16px 0 0 16px';
}

// ---------------------------------------------------------------------------
// Scroll mode
// ---------------------------------------------------------------------------

function _startScroll(inner, speed) {
  _speed    = speed;
  _pos      = 0;
  _lastTime = null;

  function step(ts) {
    if (_lastTime !== null) {
      const dt = (ts - _lastTime) / 1000;
      _pos += _speed * dt;
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
// Fade mode
// ---------------------------------------------------------------------------

function _startFade(inner, messages, dwellMs, align) {
  _messages = messages;
  _msgIndex = 0;
  _dwellMs  = dwellMs;

  const padding = _fadePadding(align);

  function showNext() {
    if (!inner || !_messages.length) return;
    inner.style.opacity = '0';
    setTimeout(() => {
      if (!inner) return;
      inner.textContent  = _messages[_msgIndex % _messages.length];
      inner.style.transform = 'none';
      inner.style.padding   = padding;
      inner.style.opacity = '1';
      _msgIndex++;
      _fadeTimer = setTimeout(showNext, _dwellMs);
    }, 500);
  }

  inner.style.padding   = padding;
  inner.style.transform = 'none';
  inner.style.opacity   = '1';
  inner.textContent = _messages[0] || '';
  _msgIndex = 1;

  if (messages.length > 1) {
    _fadeTimer = setTimeout(showNext, _dwellMs);
  }
}

function _stopFade() {
  if (_fadeTimer) { clearTimeout(_fadeTimer); _fadeTimer = null; }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function mountTicker(cfg) {
  removeTicker();

  const messages = Array.isArray(cfg.tickerMessages) ? cfg.tickerMessages.filter(m => m && m.trim()) : [];

  if (!cfg.tickerEnabled || !messages.length) return;

  const mode  = cfg.tickerMode  || 'scroll';
  const align = cfg.tickerAlign || 'start';

  _tickerEl = _createWrap(cfg);

  if (mode === 'fade') {
    _tickerEl.style.justifyContent = _justifyContent(align);
    const inner = _createInner(messages[0] || '');
    inner.style.paddingLeft = '0';
    _tickerEl.appendChild(inner);
    document.body.appendChild(_tickerEl);

    const dwellMs = Math.max(500, (Number(cfg.tickerFadeDwellSec) || 5) * 1000);
    _startFade(inner, messages, dwellMs, align);
  } else {
    // scroll mode — join all messages, alignment irrelevant
    const text  = messages.join('\u2003\u00b7\u2003');
    const inner = _createInner(text);
    _tickerEl.appendChild(inner);
    document.body.appendChild(_tickerEl);
    _startScroll(inner, cfg.tickerSpeed || 60);
  }
}

export function removeTicker() {
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
  _stopFade();
  if (_tickerEl) { _tickerEl.remove(); _tickerEl = null; }
}
