// Overlay: unified info bar — bottom strip with clock, event/countdown, and ticker.
//
// Layout (left → right, slots hide when disabled/empty):
//   [HH:MM]  |  Event Name · 04:32  |  ▶ scrolling ticker text…
//
// The bar sits at position:fixed bottom:0, z-index 9100 — above theme frames
// (camp frame is z-index 9000/9001) but below alerts (z-index 9500).
//
// Themeable via CSS custom properties; all have sensible fallbacks.

let _barEl        = null;
let _clockEl      = null;
let _eventEl      = null;
let _eventLabelEl = null;
let _eventNameEl  = null;
let _eventLocEl   = null;
let _eventTimeEl  = null;
let _event2El      = null;
let _event2LabelEl = null;
let _event2NameEl  = null;
let _event2LocEl   = null;
let _event2TimeEl  = null;
let _tickerEl     = null;
let _tickerInner  = null;

let _clockTimer      = null;
let _countdownTimer  = null;

// Last-rendered event slot state — used to detect meaningful changes for fade transition
let _eventSlotLast = { name: null, timeVisible: null, visible: null, kind: null, name2: null, visible2: null };
let _tickerFrame     = null;

let _cfg      = {};
let _schedule = [];   // sorted upcoming events from server
let _alert    = null; // active bottom-bar countdown alert (overrides schedule)
let _tickerPos   = 0;
let _tickerSpeed = 60;
let _tickerLast  = null;
// Fade-mode ticker state
let _tickerMessages = [];
let _tickerMsgIndex = 0;
let _tickerDwellMs  = 5000;
let _tickerFadeTimer = null;

// ---------------------------------------------------------------------------
// Style injection
// ---------------------------------------------------------------------------

let _styleInjected = false;

function _ensureStyle() {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'overlay-infobar-style';
  style.textContent = `
    #overlay-infobar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: var(--infobar-height, 40px);
      background: var(--infobar-bg, rgba(0, 0, 0, 0.82));
      border-top: var(--infobar-border-top, 1px solid rgba(255, 255, 255, 0.1));
      color: var(--infobar-color, #ffffff);
      font-family: var(--infobar-font-family, var(--ticker-font-family, 'Segoe UI', system-ui, sans-serif));
      font-size: var(--infobar-font-size, 15px);
      font-weight: 600;
      letter-spacing: var(--infobar-letter-spacing, 0.03em);
      z-index: 9100;
      display: flex;
      align-items: center;
      overflow: hidden;
      pointer-events: none;
    }

    /* ── Clock slot ─────────────────────────────────────────────────────── */

    #overlay-infobar-clock {
      flex-shrink: 0;
      padding: 0 14px;
      color: var(--infobar-clock-color, rgba(255, 255, 255, 0.7));
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* ── Divider between slots ──────────────────────────────────────────── */

    .infobar-divider {
      flex-shrink: 0;
      width: 1px;
      height: 55%;
      background: var(--infobar-divider-color, rgba(255, 255, 255, 0.18));
    }

    /* ── Event slot ─────────────────────────────────────────────────────── */

    #overlay-infobar-event,
    #overlay-infobar-event2 {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 16px;
      max-width: 55%;
      overflow: hidden;
      white-space: nowrap;
      transition: opacity 0.35s ease;
    }

    #overlay-infobar-event-label,
    #overlay-infobar-event2-label {
      flex-shrink: 0;
      font-weight: 400;
      color: var(--infobar-event-label-color, rgba(255, 255, 255, 0.45));
    }

    #overlay-infobar-event-name,
    #overlay-infobar-event2-name {
      flex-shrink: 1;
      font-weight: 700;
      color: var(--infobar-event-color, #ffffff);
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #overlay-infobar-event-loc,
    #overlay-infobar-event2-loc {
      flex-shrink: 1;
      font-weight: 400;
      color: var(--infobar-event-loc-color, rgba(255, 255, 255, 0.5));
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #overlay-infobar-event-time,
    #overlay-infobar-event2-time {
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      color: var(--infobar-countdown-color, #ffdca8);
      font-weight: 700;
      font-size: var(--infobar-countdown-size, 1em);
    }

    /* ── Ticker slot ────────────────────────────────────────────────────── */

    #overlay-infobar-ticker {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      display: flex;
      align-items: center;
    }

    #overlay-infobar-ticker-inner {
      white-space: nowrap;
      will-change: transform;
      color: var(--infobar-ticker-color, var(--ticker-color, #ffffff));
      font-size: var(--infobar-ticker-font-size, var(--ticker-font-size, 15px));
      font-weight: var(--infobar-ticker-font-weight, var(--ticker-font-weight, 600));
      letter-spacing: var(--infobar-ticker-letter-spacing, var(--ticker-letter-spacing, 0.03em));
      transition: opacity 0.5s ease;
    }

    /* Entry animation */
    #overlay-infobar {
      animation: infobar-in 300ms ease forwards;
    }
    @keyframes infobar-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

function _formatClock() {
  const use24h = _cfg.infoBarClock24h !== false;
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !use24h });
}

function _startClock() {
  if (_clockTimer) return;
  if (_clockEl) _clockEl.textContent = _formatClock();
  // Align tick to next minute boundary for clean transitions
  const now = new Date();
  const msToNextMin = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => {
    if (_clockEl) _clockEl.textContent = _formatClock();
    _clockTimer = setInterval(() => {
      if (_clockEl) _clockEl.textContent = _formatClock();
    }, 60_000);
  }, msToNextMin + 50);
}

function _stopClock() {
  if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
}

// ---------------------------------------------------------------------------
// Event / countdown slot
// ---------------------------------------------------------------------------

function _formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// Resolve what to show in the event slot(s).
// Returns { primary, secondary } where secondary is only set when there is no ticker
// and both a current event and a next-event-in-countdown-window exist simultaneously.
//
// Priority for primary:
//   explicit alert → next event inside its cfm window → current event → next event (cfm=0)
// When primary is a current event and a next event is also in its cfm window,
// secondary gets the next event (shown only when no ticker).
function _resolveEventSlots() {
  if (_alert) {
    const target = Number(new Date(_alert.countdownTo || ''));
    const remaining = Number.isFinite(target) ? target - Date.now() : null;
    return {
      primary: { name: _alert.message || '', loc: '', remaining, targetMs: target, kind: 'alert' },
      secondary: null,
    };
  }

  const now = Date.now();
  const sorted = _schedule
    .map(e => ({ e, startMs: Number(new Date(e.startTime)) }))
    .filter(({ startMs }) => Number.isFinite(startMs))
    .sort((a, b) => a.startMs - b.startMs);

  const showCurrent = _cfg.infoBarShowCurrentEvent !== false;
  const showNext    = _cfg.infoBarShowNextEvent    !== false;
  const hasTicker   = Boolean(_tickerEl);

  // Next events that are upcoming
  const future = showNext ? sorted.filter(({ startMs }) => startMs > now) : [];

  // Find the soonest next event inside its countdown window (cfm > 0)
  let nextInWindow = null;
  for (const { e, startMs } of future) {
    const cfm = Number(e.countdownFromMinutes || 0);
    if (cfm > 0 && now >= startMs - (cfm * 60 * 1000)) {
      nextInWindow = { name: e.name || '', loc: e.location || '', remaining: startMs - now, targetMs: startMs, kind: 'next' };
      break;
    }
  }

  // Find current event
  let current = null;
  if (showCurrent) {
    const past = sorted.filter(({ startMs }) => startMs <= now);
    for (let i = past.length - 1; i >= 0; i--) {
      const { e } = past[i];
      if (e.endTime) {
        const endMs = Number(new Date(e.endTime));
        if (Number.isFinite(endMs) && endMs <= now) continue;
      }
      current = { name: e.name || '', loc: e.location || '', remaining: null, targetMs: null, kind: 'current' };
      break;
    }
  }

  // Both exist: primary = next-in-window (more urgent), secondary = current (when no ticker)
  if (nextInWindow && current) {
    return {
      primary:   nextInWindow,
      secondary: !hasTicker ? current : null,
    };
  }

  // Only next-in-window
  if (nextInWindow) return { primary: nextInWindow, secondary: null };

  // Only current
  if (current) return { primary: current, secondary: null };

  // Fallback: soonest next with cfm=0 (always visible)
  if (future.length) {
    const { e, startMs } = future[0];
    const cfm = Number(e.countdownFromMinutes || 0);
    if (cfm === 0) {
      return { primary: { name: e.name || '', loc: e.location || '', remaining: startMs - now, targetMs: startMs, kind: 'next' }, secondary: null };
    }
    return { primary: null, secondary: null };
  }

  return { primary: null, secondary: null };
}

// Apply a resolved slot object to a set of DOM elements.
// containerEl is hidden when slot is null; _updateDividers is NOT called here —
// caller must call it after applying both primary and secondary.
function _applySlotToEl(slot, containerEl, labelEl, nameEl, locEl, timeEl) {
  if (!slot) {
    containerEl.style.display = 'none';
    return;
  }

  containerEl.style.display = '';
  if (labelEl) {
    if (slot.kind === 'current')     labelEl.textContent = 'Nu:';
    else if (slot.kind === 'next')   labelEl.textContent = 'Zometeen:';
    else                             labelEl.textContent = '';
    labelEl.style.display = labelEl.textContent ? '' : 'none';
  }
  if (nameEl) nameEl.textContent = slot.name;
  if (locEl) {
    locEl.textContent = slot.loc ? `· ${slot.loc}` : '';
    locEl.style.display = slot.loc ? '' : 'none';
  }
  if (timeEl) {
    if (slot.remaining !== null && Number.isFinite(slot.remaining) && slot.remaining > 0) {
      timeEl.textContent = _formatDuration(slot.remaining);
      timeEl.style.display = '';
    } else {
      timeEl.style.display = 'none';
    }
  }
}

function _refreshEventSlot() {
  if (!_eventEl) return;
  const showCurrent = _cfg.infoBarShowCurrentEvent !== false;
  const showNext    = _cfg.infoBarShowNextEvent    !== false;
  if (!showCurrent && !showNext) {
    _eventEl.style.display = 'none';
    if (_event2El) _event2El.style.display = 'none';
    _updateDividers();
    return;
  }

  const { primary, secondary } = _resolveEventSlots();

  // ── Primary slot ──────────────────────────────────────────────────────────
  const newName        = primary ? primary.name : null;
  const newTimeVisible = primary ? (primary.remaining !== null && Number.isFinite(primary.remaining) && primary.remaining > 0) : null;
  const newVisible     = primary !== null;
  const newKind        = primary ? primary.kind : null;

  const primaryChanged = newVisible     !== _eventSlotLast.visible
                      || newName        !== _eventSlotLast.name
                      || newTimeVisible !== _eventSlotLast.timeVisible
                      || newKind        !== _eventSlotLast.kind;

  if (!primaryChanged) {
    // Only the countdown number ticked — update in place without fading
    if (primary && _eventTimeEl && newTimeVisible) {
      _eventTimeEl.textContent = _formatDuration(primary.remaining);
    }
  } else {
    _eventSlotLast = { ...(_eventSlotLast), name: newName, timeVisible: newTimeVisible, visible: newVisible, kind: newKind };

    if (_eventEl.style.display === 'none' || _eventEl.style.opacity === '0') {
      _applySlotToEl(primary, _eventEl, _eventLabelEl, _eventNameEl, _eventLocEl, _eventTimeEl);
      _eventEl.style.opacity = '0';
      requestAnimationFrame(() => { _eventEl.style.opacity = '1'; });
    } else {
      _eventEl.style.opacity = '0';
      setTimeout(() => {
        _applySlotToEl(primary, _eventEl, _eventLabelEl, _eventNameEl, _eventLocEl, _eventTimeEl);
        _eventEl.style.opacity = '1';
      }, 370);
    }
  }

  // ── Secondary slot ────────────────────────────────────────────────────────
  if (_event2El) {
    const newVisible2 = secondary !== null;
    const newName2    = secondary ? secondary.name : null;

    const secondaryChanged = newVisible2 !== _eventSlotLast.visible2
                          || newName2    !== _eventSlotLast.name2;

    if (!secondaryChanged) {
      // Only countdown ticked — update in place
      if (secondary && _event2TimeEl) {
        const rem2 = secondary.remaining;
        if (rem2 !== null && Number.isFinite(rem2) && rem2 > 0) {
          _event2TimeEl.textContent = _formatDuration(rem2);
        }
      }
    } else {
      _eventSlotLast = { ...(_eventSlotLast), name2: newName2, visible2: newVisible2 };

      if (_event2El.style.display === 'none' || _event2El.style.opacity === '0') {
        _applySlotToEl(secondary, _event2El, _event2LabelEl, _event2NameEl, _event2LocEl, _event2TimeEl);
        _event2El.style.opacity = '0';
        requestAnimationFrame(() => { _event2El.style.opacity = '1'; });
      } else {
        _event2El.style.opacity = '0';
        setTimeout(() => {
          _applySlotToEl(secondary, _event2El, _event2LabelEl, _event2NameEl, _event2LocEl, _event2TimeEl);
          _event2El.style.opacity = '1';
        }, 370);
      }
    }
  }

  _updateDividers();
}

function _startCountdownTimer() {
  if (_countdownTimer) return;
  _countdownTimer = setInterval(() => {
    _refreshEventSlot();
    // Auto-clear alert when its countdown target passes
    if (_alert?.countdownTo) {
      const target = Number(new Date(_alert.countdownTo));
      if (Number.isFinite(target) && target <= Date.now()) {
        _alert = null;
      }
    }
  }, 500);
}

function _stopCountdownTimer() {
  if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
}

// ---------------------------------------------------------------------------
// Ticker animation
// ---------------------------------------------------------------------------

function _startTickerScroll() {
  if (!_tickerInner) return;
  _tickerPos  = 0;
  _tickerLast = null;

  function step(ts) {
    if (_tickerLast !== null) {
      const dt = (ts - _tickerLast) / 1000;
      _tickerPos += _tickerSpeed * dt;
      if (_tickerPos > _tickerInner.scrollWidth) _tickerPos = -window.innerWidth;
      _tickerInner.style.transform = `translateX(${-_tickerPos}px)`;
    }
    _tickerLast  = ts;
    _tickerFrame = requestAnimationFrame(step);
  }

  if (_tickerFrame) cancelAnimationFrame(_tickerFrame);
  _tickerFrame = requestAnimationFrame(step);
}

// Map tickerAlign → padding string for inner element in fade mode
function _tickerFadePadding(align) {
  if (align === 'center') return '0 16px';
  if (align === 'end')    return '0 16px 0 0';
  return '0 0 0 16px'; // start
}

function _startTickerFade() {
  if (!_tickerInner || !_tickerMessages.length) return;

  const align   = _cfg.tickerAlign || 'start';
  const padding = _tickerFadePadding(align);

  _tickerInner.style.transform = 'none';
  _tickerInner.style.padding   = padding;

  function showNext() {
    if (!_tickerInner) return;
    _tickerInner.style.opacity = '0';
    setTimeout(() => {
      if (!_tickerInner) return;
      _tickerInner.textContent = _tickerMessages[_tickerMsgIndex % _tickerMessages.length];
      _tickerInner.style.padding   = padding;
      _tickerInner.style.opacity   = '1';
      _tickerMsgIndex++;
      _tickerFadeTimer = setTimeout(showNext, _tickerDwellMs);
    }, 500);
  }

  _tickerInner.textContent   = _tickerMessages[0] || '';
  _tickerInner.style.opacity = '1';
  _tickerMsgIndex = 1;

  if (_tickerMessages.length > 1) {
    _tickerFadeTimer = setTimeout(showNext, _tickerDwellMs);
  }
}

function _startTicker() {
  if (!_tickerInner) return;
  const mode = _cfg.tickerMode || 'scroll';
  if (mode === 'fade') {
    _startTickerFade();
  } else {
    _startTickerScroll();
  }
}

function _stopTicker() {
  if (_tickerFrame) { cancelAnimationFrame(_tickerFrame); _tickerFrame = null; }
  if (_tickerFadeTimer) { clearTimeout(_tickerFadeTimer); _tickerFadeTimer = null; }
}

// ---------------------------------------------------------------------------
// Divider management
// ---------------------------------------------------------------------------

// Rebuild dividers between visible slots.
function _updateDividers() {
  if (!_barEl) return;
  for (const d of _barEl.querySelectorAll('.infobar-divider')) d.remove();

  const slots = [];
  if (_clockEl && _cfg.infoBarShowClock) slots.push(_clockEl);
  const _showAnyEvent = _cfg.infoBarShowCurrentEvent !== false || _cfg.infoBarShowNextEvent !== false;
  if (_eventEl && _showAnyEvent && _eventEl.style.display !== 'none') slots.push(_eventEl);
  if (_event2El && _event2El.style.display !== 'none') slots.push(_event2El);
  if (_tickerEl) slots.push(_tickerEl);

  // Insert dividers between adjacent visible slots
  for (let i = 0; i < slots.length - 1; i++) {
    const div = document.createElement('div');
    div.className = 'infobar-divider';
    slots[i].insertAdjacentElement('afterend', div);
  }
}

// ---------------------------------------------------------------------------
// DOM build
// ---------------------------------------------------------------------------

function _buildBar(cfg) {
  _ensureStyle();

  const bar = document.createElement('div');
  bar.id = 'overlay-infobar';

  // Clock slot
  if (cfg.infoBarShowClock !== false) {
    _clockEl = document.createElement('div');
    _clockEl.id = 'overlay-infobar-clock';
    _clockEl.textContent = _formatClock();
    bar.appendChild(_clockEl);
  } else {
    _clockEl = null;
  }

  // Event slot — shown when at least one of the two event flags is on
  const showAnyEvent = cfg.infoBarShowCurrentEvent !== false || cfg.infoBarShowNextEvent !== false;
  if (showAnyEvent) {
    _eventEl = document.createElement('div');
    _eventEl.id = 'overlay-infobar-event';
    _eventEl.style.display = 'none'; // hidden until there's something to show

    _eventLabelEl = document.createElement('span');
    _eventLabelEl.id = 'overlay-infobar-event-label';
    _eventEl.appendChild(_eventLabelEl);

    _eventNameEl = document.createElement('span');
    _eventNameEl.id = 'overlay-infobar-event-name';
    _eventEl.appendChild(_eventNameEl);

    _eventLocEl = document.createElement('span');
    _eventLocEl.id = 'overlay-infobar-event-loc';
    _eventEl.appendChild(_eventLocEl);

    _eventTimeEl = document.createElement('span');
    _eventTimeEl.id = 'overlay-infobar-event-time';
    _eventEl.appendChild(_eventTimeEl);

    bar.appendChild(_eventEl);

    // Second event slot — only visible when secondary event is resolved (no ticker + both current & next)
    _event2El = document.createElement('div');
    _event2El.id = 'overlay-infobar-event2';
    _event2El.style.display = 'none';

    _event2LabelEl = document.createElement('span');
    _event2LabelEl.id = 'overlay-infobar-event2-label';
    _event2El.appendChild(_event2LabelEl);

    _event2NameEl = document.createElement('span');
    _event2NameEl.id = 'overlay-infobar-event2-name';
    _event2El.appendChild(_event2NameEl);

    _event2LocEl = document.createElement('span');
    _event2LocEl.id = 'overlay-infobar-event2-loc';
    _event2El.appendChild(_event2LocEl);

    _event2TimeEl = document.createElement('span');
    _event2TimeEl.id = 'overlay-infobar-event2-time';
    _event2El.appendChild(_event2TimeEl);

    bar.appendChild(_event2El);
  } else {
    _eventEl = null;
    _eventLabelEl = null;
    _eventNameEl = null;
    _eventLocEl = null;
    _eventTimeEl = null;
    _event2El = null;
    _event2LabelEl = null;
    _event2NameEl = null;
    _event2LocEl = null;
    _event2TimeEl = null;
  }

  // Ticker slot — only shown when ticker is enabled and has messages
  const rawMessages = Array.isArray(cfg.tickerMessages) ? cfg.tickerMessages.filter(m => m && m.trim()) : [];

  if (cfg.tickerEnabled && rawMessages.length) {
    const mode  = cfg.tickerMode  || 'scroll';
    const align = cfg.tickerAlign || 'start';

    _tickerEl = document.createElement('div');
    _tickerEl.id = 'overlay-infobar-ticker';

    _tickerInner = document.createElement('div');
    _tickerInner.id = 'overlay-infobar-ticker-inner';

    if (mode === 'fade') {
      // Alignment applies in fade mode — set justify-content on container
      if (align === 'center') _tickerEl.style.justifyContent = 'center';
      else if (align === 'end') _tickerEl.style.justifyContent = 'flex-end';
      // else default: flex-start
      _tickerInner.textContent = rawMessages[0];
    } else {
      // Scroll mode: all messages joined, entry from right
      _tickerInner.textContent = rawMessages.join('\u2003\u00b7\u2003');
      _tickerInner.style.paddingLeft = '100%';
    }

    _tickerEl.appendChild(_tickerInner);
    bar.appendChild(_tickerEl);
  } else {
    _tickerEl    = null;
    _tickerInner = null;
  }

  return bar;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount (or remount) the info bar.
 * @param {object} cfg   Screen config object
 * @param {Array}  schedule  Sorted array of schedule entries
 */
export function mountInfoBar(cfg, schedule) {
  removeInfoBar();

  _cfg      = cfg || {};
  _schedule = Array.isArray(schedule) ? schedule : [];
  _tickerSpeed = Number(_cfg.tickerSpeed) || 60;

  // Prepare fade-mode state
  _tickerMessages = Array.isArray(_cfg.tickerMessages) ? _cfg.tickerMessages.filter(m => m && m.trim()) : [];
  _tickerMsgIndex = 0;
  _tickerDwellMs  = Math.max(500, (Number(_cfg.tickerFadeDwellSec) || 5) * 1000);

  _barEl = _buildBar(_cfg);
  document.body.appendChild(_barEl);

  _eventSlotLast = { name: null, timeVisible: null, visible: null, kind: null, name2: null, visible2: null };

  if (_cfg.infoBarShowClock !== false) _startClock();
  const showAnyEvent = _cfg.infoBarShowCurrentEvent !== false || _cfg.infoBarShowNextEvent !== false;
  if (showAnyEvent) {
    _refreshEventSlot();
    _startCountdownTimer();
  }
  if (_tickerInner) _startTicker();

  _updateDividers();
}

/**
 * Tear down the info bar and stop all timers.
 */
export function removeInfoBar() {
  _stopClock();
  _stopCountdownTimer();
  _stopTicker();
  if (_barEl) { _barEl.remove(); _barEl = null; }
  _clockEl = _eventEl = _eventLabelEl = _eventNameEl = _eventLocEl = _eventTimeEl = null;
  _event2El = _event2LabelEl = _event2NameEl = _event2LocEl = _event2TimeEl = null;
  _tickerEl = _tickerInner = null;
  _alert = null;
  _tickerMessages = [];
  _tickerMsgIndex = 0;
  _eventSlotLast = { name: null, timeVisible: null, visible: null, kind: null, name2: null, visible2: null };
}

/**
 * Update schedule data — called when a schedule_update WebSocket message arrives.
 * @param {Array} schedule
 */
export function updateInfoBarSchedule(schedule) {
  _schedule = Array.isArray(schedule) ? schedule : [];
  _refreshEventSlot();
}

/**
 * Set an explicit countdown alert to display in the event slot.
 * @param {object} alert
 */
export function setInfoBarAlert(alert) {
  _alert = alert || null;
  _refreshEventSlot();
  if (_alert) _startCountdownTimer();
}

/**
 * Clear a specific alert from the event slot.
 * Falls back to schedule auto-display.
 * @param {string} alertId
 */
export function clearInfoBarAlert(alertId) {
  if (_alert && _alert.id === String(alertId || '')) {
    _alert = null;
    _refreshEventSlot();
  }
}

/**
 * Return the current bar height in pixels (0 if not mounted).
 * Used by the orchestrator to compute safe insets for bugs/qr-bugs.
 */
export function getInfoBarHeight() {
  if (!_barEl) return 0;
  return _barEl.offsetHeight || 40;
}

/**
 * Returns true if the info bar is currently mounted in the DOM.
 */
export function isInfoBarMounted() {
  return _barEl !== null;
}
