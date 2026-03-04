// Overlay: unified info bar — bottom strip with clock, event/countdown, and ticker.
//
// Layout (left → right, slots hide when disabled/empty):
//   [HH:MM]  |  Event Name · 04:32  |  ▶ scrolling ticker text…
//
// The bar sits at position:fixed bottom:0, z-index 9100 — above theme frames
// (camp frame is z-index 9000/9001) but below alerts (z-index 9500).
//
// Themeable via CSS custom properties; all have sensible fallbacks.

import { fmtDuration, el }                                      from '../../../shared/utils.js';
import { startTickerScroll, startTickerFade, filterTickerMessages } from './_overlay-utils.js';

const EVENT_FADE_MS       = 370;   // fade-out duration for event slot transitions
const COUNTDOWN_TICK_MS   = 500;   // countdown refresh interval
const DEFAULT_INFOBAR_H   = 40;    // default bar height in px
const DEFAULT_FONT_SIZE   = 15;    // default font size in px

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

/**
 * Snapshot of the last-rendered event slot state.
 * Compared on each refresh to detect meaningful changes that require a fade transition,
 * vs. simple countdown ticks that update in-place without animation.
 */
let _prevEventSnapshot = { name: null, timeVisible: null, visible: null, kind: null, name2: null, visible2: null };

let _cfg      = {};
let _schedule = [];   // sorted upcoming events from server
let _alert    = null; // active bottom-bar countdown alert (overrides schedule)
// Ticker animation config (read at _startTicker time)
let _tickerMessages = [];
let _tickerDwellMs  = 5000;
let _stopTickerAnim = () => {};

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

function _formatClock() {
  const use24h = _cfg.clock24h !== false;
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

/**
 * Determine what to display in the event slot(s) of the info bar.
 *
 * Returns `{ primary, secondary }` where each is either a slot descriptor
 * `{ name, loc, remaining, targetMs, kind }` or `null`.
 *
 * Resolution priority for the primary slot:
 *   1. Explicit alert (set via `setInfoBarAlert`)
 *   2. Next upcoming event whose countdown window (countdownFromMinutes) is active
 *   3. Currently-running event (started but not ended)
 *   4. Soonest future event with countdownFromMinutes = 0 (always-visible)
 *
 * The secondary slot is populated only when there is no ticker and both a
 * current event and a next-event-in-countdown-window coexist — allowing the
 * bar to show both simultaneously.
 *
 * @returns {{ primary: Object|null, secondary: Object|null }}
 */
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

  // Find current event — walk sorted backwards from the last past event
  let current = null;
  if (showCurrent) {
    // Find the index of the last event that has already started
    let lastPastIdx = -1;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].startMs <= now) { lastPastIdx = i; break; }
    }
    for (let i = lastPastIdx; i >= 0; i--) {
      const { e } = sorted[i];
      if (e.endTime) {
        const endMs = Number(new Date(e.endTime));
        if (Number.isFinite(endMs) && endMs <= now) continue;
      } else {
        // No explicit end time — the event ends when the next one in the schedule starts.
        const nextEvStartMs = sorted[i + 1]?.startMs;
        if (nextEvStartMs !== undefined && nextEvStartMs <= now) continue;
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
      timeEl.textContent = fmtDuration(slot.remaining);
      timeEl.style.display = '';
    } else {
      timeEl.style.display = 'none';
    }
  }
}

/**
 * Re-render the event slot(s) in the info bar.
 *
 * Calls `_resolveEventSlots()` to determine the current primary and secondary
 * slot content, then compares each against the previous snapshot
 * (`_prevEventSnapshot`) to decide how to update the DOM:
 *
 *  - If only the countdown number changed → update the text in place (no animation).
 *  - If the event name, visibility, or kind changed → crossfade: fade out the old
 *    content over EVENT_FADE_MS, swap in the new content, then fade back in.
 *  - If the slot was previously hidden → appear with a quick opacity ramp (no fade-out).
 *
 * After updating both slots the divider strip is rebuilt via `_updateDividers()`.
 */

/**
 * Fade-transition a slot container to new content.
 * If the slot is currently hidden (display:none or opacity:0), the new content
 * is applied immediately and faded in.  Otherwise the slot fades out first,
 * swaps content, then fades back in.
 *
 * @param {Object|null} slot       - resolved slot descriptor (or null to hide)
 * @param {HTMLElement}  containerEl
 * @param {HTMLElement}  labelEl
 * @param {HTMLElement}  nameEl
 * @param {HTMLElement}  locEl
 * @param {HTMLElement}  timeEl
 */
function _fadeSlotTransition(slot, containerEl, labelEl, nameEl, locEl, timeEl) {
  if (containerEl.style.display === 'none' || containerEl.style.opacity === '0') {
    _applySlotToEl(slot, containerEl, labelEl, nameEl, locEl, timeEl);
    containerEl.style.opacity = '0';
    requestAnimationFrame(() => { containerEl.style.opacity = '1'; });
  } else {
    containerEl.style.opacity = '0';
    setTimeout(() => {
      _applySlotToEl(slot, containerEl, labelEl, nameEl, locEl, timeEl);
      containerEl.style.opacity = '1';
    }, EVENT_FADE_MS);
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

  const primaryChanged = newVisible     !== _prevEventSnapshot.visible
                      || newName        !== _prevEventSnapshot.name
                      || newTimeVisible !== _prevEventSnapshot.timeVisible
                      || newKind        !== _prevEventSnapshot.kind;

  if (!primaryChanged) {
    // Only the countdown number ticked — update in place without fading
    if (primary && _eventTimeEl && newTimeVisible) {
      _eventTimeEl.textContent = fmtDuration(primary.remaining);
    }
  } else {
    _prevEventSnapshot = { ...(_prevEventSnapshot), name: newName, timeVisible: newTimeVisible, visible: newVisible, kind: newKind };
    _fadeSlotTransition(primary, _eventEl, _eventLabelEl, _eventNameEl, _eventLocEl, _eventTimeEl);
  }

  // ── Secondary slot ────────────────────────────────────────────────────────
  if (_event2El) {
    const newVisible2 = secondary !== null;
    const newName2    = secondary ? secondary.name : null;

    const secondaryChanged = newVisible2 !== _prevEventSnapshot.visible2
                          || newName2    !== _prevEventSnapshot.name2;

    if (!secondaryChanged) {
      // Only countdown ticked — update in place
      if (secondary && _event2TimeEl) {
        const rem2 = secondary.remaining;
        if (rem2 !== null && Number.isFinite(rem2) && rem2 > 0) {
          _event2TimeEl.textContent = fmtDuration(rem2);
        }
      }
    } else {
      _prevEventSnapshot = { ...(_prevEventSnapshot), name2: newName2, visible2: newVisible2 };
      _fadeSlotTransition(secondary, _event2El, _event2LabelEl, _event2NameEl, _event2LocEl, _event2TimeEl);
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
  }, COUNTDOWN_TICK_MS);
}

function _stopCountdownTimer() {
  if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
}

// ---------------------------------------------------------------------------
// Ticker animation
// ---------------------------------------------------------------------------

function _startTicker() {
  if (!_tickerInner) return;
  const mode    = _cfg.tickerMode  || 'scroll';
  const align   = _cfg.tickerAlign || 'start';
  if (mode === 'fade') {
    _stopTickerAnim = startTickerFade(_tickerInner, _tickerMessages, _tickerDwellMs, align);
  } else {
    _stopTickerAnim = startTickerScroll(_tickerInner, _cfg.tickerSpeed || 60);
  }
}

function _stopTicker() {
  _stopTickerAnim();
  _stopTickerAnim = () => {};
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
    slots[i].insertAdjacentElement('afterend', el('div', { cls: 'infobar-divider' }));
  }
}

// ---------------------------------------------------------------------------
// DOM build helpers
// ---------------------------------------------------------------------------

/**
 * Build one event slot div + its four child spans.
 * @param {string} suffix  '' for the primary slot, '2' for the secondary
 * @returns {{ slotEl, labelEl, nameEl, locEl, timeEl }}
 */
function _makeEventSlot(suffix) {
  const labelEl = el('span', { id: `overlay-infobar-event${suffix}-label` });
  const nameEl  = el('span', { id: `overlay-infobar-event${suffix}-name` });
  const locEl   = el('span', { id: `overlay-infobar-event${suffix}-loc` });
  const timeEl  = el('span', { id: `overlay-infobar-event${suffix}-time` });

  const slotEl = el('div', { id: `overlay-infobar-event${suffix}`, styles: { display: 'none' } },
    labelEl, nameEl, locEl, timeEl,
  );

  return { slotEl, labelEl, nameEl, locEl, timeEl };
}

// ---------------------------------------------------------------------------
// DOM build
// ---------------------------------------------------------------------------

function _buildBar(cfg) {
  const bar = el('div', { id: 'overlay-infobar' });

  // Clock slot
  if (cfg.infoBarShowClock !== false) {
    _clockEl = el('div', { id: 'overlay-infobar-clock', text: _formatClock() });
    bar.appendChild(_clockEl);
  } else {
    _clockEl = null;
  }

  // Event slot — shown when at least one of the two event flags is on
  const showAnyEvent = cfg.infoBarShowCurrentEvent !== false || cfg.infoBarShowNextEvent !== false;
  if (showAnyEvent) {
    ({ slotEl: _eventEl, labelEl: _eventLabelEl, nameEl: _eventNameEl,
       locEl: _eventLocEl, timeEl: _eventTimeEl } = _makeEventSlot(''));
    bar.appendChild(_eventEl);

    // Second event slot — only visible when secondary event is resolved (no ticker + both current & next)
    ({ slotEl: _event2El, labelEl: _event2LabelEl, nameEl: _event2NameEl,
       locEl: _event2LocEl, timeEl: _event2TimeEl } = _makeEventSlot('2'));
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
  const rawMessages = filterTickerMessages(cfg.tickerMessages);

  if (cfg.tickerEnabled && rawMessages.length) {
    const mode  = cfg.tickerMode  || 'scroll';
    const align = cfg.tickerAlign || 'start';

    _tickerEl    = el('div', { id: 'overlay-infobar-ticker' });
    _tickerInner = el('div', { id: 'overlay-infobar-ticker-inner' });

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

  // Prepare fade-mode state
  _tickerMessages = filterTickerMessages(_cfg.tickerMessages);
  _tickerDwellMs  = Math.max(500, (Number(_cfg.tickerFadeDwellSec) || 5) * 1000);

  _barEl = _buildBar(_cfg);
  if (_cfg.infoBarFontSize) {
    const fs = _cfg.infoBarFontSize;
    _barEl.style.setProperty('--infobar-font-size', `${fs}px`);
    // Scale height proportionally when the user picks a non-default font size.
    // When fs == DEFAULT_FONT_SIZE we leave --infobar-height alone so the theme
    // CSS variable (e.g. camp's 60px) is not clobbered by the JS override.
    if (fs !== DEFAULT_FONT_SIZE) {
      const scaledHeight  = Math.round((fs / DEFAULT_FONT_SIZE) * DEFAULT_INFOBAR_H);
      _barEl.style.setProperty('--infobar-height', `${scaledHeight}px`);
      // Also set on :root so hoisted theme elements (e.g. camp gold border) track it
      document.documentElement.style.setProperty('--infobar-height', `${scaledHeight}px`);
    }
  }
  document.body.appendChild(_barEl);

  // After mount, read the actual rendered height and publish it on :root so that
  // hoisted theme elements (e.g. the camp gold border) can position themselves
  // relative to the bar using var(--infobar-height).
  requestAnimationFrame(() => {
    if (!_barEl) return;
    const h = _barEl.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty('--infobar-height', `${h}px`);
  });

  _prevEventSnapshot = { name: null, timeVisible: null, visible: null, kind: null, name2: null, visible2: null };

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
  document.documentElement.style.removeProperty('--infobar-height');
  _clockEl = _eventEl = _eventLabelEl = _eventNameEl = _eventLocEl = _eventTimeEl = null;
  _event2El = _event2LabelEl = _event2NameEl = _event2LocEl = _event2TimeEl = null;
  _tickerEl = _tickerInner = null;
  _alert = null;
  _tickerMessages = [];
  _prevEventSnapshot = { name: null, timeVisible: null, visible: null, kind: null, name2: null, visible2: null };
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
