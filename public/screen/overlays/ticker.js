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

import { startTickerScroll, startTickerFade } from './_overlay-utils.js';
import { el }                                  from '../../../shared/utils.js';

let _tickerEl  = null;
let _stopAnim  = () => {};

// ---------------------------------------------------------------------------
// DOM builders
// ---------------------------------------------------------------------------

function _createWrap(cfg) {
  const wrap = el('div', { id: 'overlay-ticker' });
  wrap.classList.add(cfg.tickerPosition === 'top' ? 'ticker-top' : 'ticker-bottom');
  return wrap;
}

function _createInner(text, forFade) {
  return el('div', {
    id:     'overlay-ticker-inner',
    text,
    styles: forFade ? {} : { paddingLeft: '100vw' },
  });
}

// Map tickerAlign → CSS justify-content value for the wrap element
function _justifyContent(align) {
  if (align === 'center') return 'center';
  if (align === 'end')    return 'flex-end';
  return 'flex-start';
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
    const inner = _createInner(messages[0] || '', true);
    _tickerEl.appendChild(inner);
    document.body.appendChild(_tickerEl);

    const dwellMs = Math.max(500, (Number(cfg.tickerFadeDwellSec) || 5) * 1000);
    _stopAnim = startTickerFade(inner, messages, dwellMs, align);
  } else {
    // scroll mode — join all messages, alignment irrelevant
    const text  = messages.join('\u2003\u00b7\u2003');
    const inner = _createInner(text, false);
    _tickerEl.appendChild(inner);
    document.body.appendChild(_tickerEl);
    _stopAnim = startTickerScroll(inner, cfg.tickerSpeed || 60);
  }
}

export function removeTicker() {
  _stopAnim();
  _stopAnim = () => {};
  if (_tickerEl) { _tickerEl.remove(); _tickerEl = null; }
}
