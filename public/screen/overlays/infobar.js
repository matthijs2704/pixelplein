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
import { resolveEventSlots }                                      from './event-resolver.js';

const EVENT_FADE_MS       = 370;   // fade-out duration for event slot transitions
const COUNTDOWN_TICK_MS   = 500;   // countdown refresh interval
const DEFAULT_INFOBAR_H   = 40;    // default bar height in px
const DEFAULT_FONT_SIZE   = 15;    // default font size in px

/** DOM element references — grouped to reduce module-level let count. */
const _dom = {
  bar:         null,
  clock:       null,
  event:       null,
  eventLabel:  null,
  eventName:   null,
  eventLoc:    null,
  eventTime:   null,
  event2:      null,
  event2Label: null,
  event2Name:  null,
  event2Loc:   null,
  event2Time:  null,
  ticker:      null,
  tickerInner: null,
  deviceInfo:  null,
  slotStart:   null,
  slotEnd:     null,
};

/** Timer IDs */
let _clockTimer     = null;
let _countdownTimer = null;

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
  if (_dom.clock) _dom.clock.textContent = _formatClock();
  // Align tick to next minute boundary for clean transitions
  const now = new Date();
  const msToNextMin = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => {
    if (_dom.clock) _dom.clock.textContent = _formatClock();
    _clockTimer = setInterval(() => {
      if (_dom.clock) _dom.clock.textContent = _formatClock();
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
 * Delegates to the pure `resolveEventSlots()` function, passing in the
 * current module state.
 *
 * @returns {{ primary: Object|null, secondary: Object|null }}
 */
function _resolveEventSlots() {
  return resolveEventSlots(_cfg, _schedule, _alert, Boolean(_dom.ticker));
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
  if (!_dom.event) return;
  const showCurrent = _cfg.infoBarShowCurrentEvent !== false;
  const showNext    = _cfg.infoBarShowNextEvent    !== false;
  if (!showCurrent && !showNext) {
    _dom.event.style.display = 'none';
    if (_dom.event2) _dom.event2.style.display = 'none';
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
    if (primary && _dom.eventTime && newTimeVisible) {
      _dom.eventTime.textContent = fmtDuration(primary.remaining);
    }
  } else {
    _prevEventSnapshot = { ...(_prevEventSnapshot), name: newName, timeVisible: newTimeVisible, visible: newVisible, kind: newKind };
    _fadeSlotTransition(primary, _dom.event, _dom.eventLabel, _dom.eventName, _dom.eventLoc, _dom.eventTime);
  }

  // ── Secondary slot ────────────────────────────────────────────────────────
  if (_dom.event2) {
    const newVisible2 = secondary !== null;
    const newName2    = secondary ? secondary.name : null;

    const secondaryChanged = newVisible2 !== _prevEventSnapshot.visible2
                          || newName2    !== _prevEventSnapshot.name2;

    if (!secondaryChanged) {
      // Only countdown ticked — update in place
      if (secondary && _dom.event2Time) {
        const rem2 = secondary.remaining;
        if (rem2 !== null && Number.isFinite(rem2) && rem2 > 0) {
          _dom.event2Time.textContent = fmtDuration(rem2);
        }
      }
    } else {
      _prevEventSnapshot = { ...(_prevEventSnapshot), name2: newName2, visible2: newVisible2 };
      _fadeSlotTransition(secondary, _dom.event2, _dom.event2Label, _dom.event2Name, _dom.event2Loc, _dom.event2Time);
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
  if (!_dom.tickerInner) return;
  const mode    = _cfg.tickerMode  || 'scroll';
  const align   = _cfg.tickerAlign || 'start';
  if (mode === 'fade') {
    _stopTickerAnim = startTickerFade(_dom.tickerInner, _tickerMessages, _tickerDwellMs, align);
  } else {
    _stopTickerAnim = startTickerScroll(_dom.tickerInner, _cfg.tickerSpeed || 60);
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
  if (!_dom.bar) return;
  for (const d of _dom.bar.querySelectorAll('.infobar-divider')) d.remove();

  const slots = [];
  if (_dom.clock && _cfg.infoBarShowClock) slots.push(_dom.clock);
  const _showAnyEvent = _cfg.infoBarShowCurrentEvent !== false || _cfg.infoBarShowNextEvent !== false;
  if (_dom.event && _showAnyEvent && _dom.event.style.display !== 'none') slots.push(_dom.event);
  if (_dom.event2 && _dom.event2.style.display !== 'none') slots.push(_dom.event2);
  if (_dom.ticker) slots.push(_dom.ticker);
  if (_dom.deviceInfo && _cfg.infoBarShowDeviceInfo) slots.push(_dom.deviceInfo);

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

function _buildBar(cfg, screenId) {
  const bar = el('div', { id: 'overlay-infobar' });

  // Theme start-slot — e.g. logo, left badge
  const slotStart = document.getElementById('overlay-infobar-slot-start');
  if (slotStart) { _dom.slotStart = slotStart; bar.appendChild(slotStart); }

  // Clock slot
  if (cfg.infoBarShowClock !== false) {
    _dom.clock = el('div', { id: 'overlay-infobar-clock', text: _formatClock() });
    bar.appendChild(_dom.clock);
  } else {
    _dom.clock = null;
  }

  // Event slot — shown when at least one of the two event flags is on
  const showAnyEvent = cfg.infoBarShowCurrentEvent !== false || cfg.infoBarShowNextEvent !== false;
  if (showAnyEvent) {
    ({ slotEl: _dom.event, labelEl: _dom.eventLabel, nameEl: _dom.eventName,
       locEl: _dom.eventLoc, timeEl: _dom.eventTime } = _makeEventSlot(''));
    bar.appendChild(_dom.event);

    // Second event slot — only visible when secondary event is resolved (no ticker + both current & next)
    ({ slotEl: _dom.event2, labelEl: _dom.event2Label, nameEl: _dom.event2Name,
       locEl: _dom.event2Loc, timeEl: _dom.event2Time } = _makeEventSlot('2'));
    bar.appendChild(_dom.event2);
  } else {
    _dom.event = null;
    _dom.eventLabel = null;
    _dom.eventName = null;
    _dom.eventLoc = null;
    _dom.eventTime = null;
    _dom.event2 = null;
    _dom.event2Label = null;
    _dom.event2Name = null;
    _dom.event2Loc = null;
    _dom.event2Time = null;
  }

  // Ticker slot — shown when infoBarShowTicker is set (falls back to tickerEnabled)
  const rawMessages = filterTickerMessages(cfg.tickerMessages);
  const _showTicker = cfg.infoBarShowTicker ?? cfg.tickerEnabled;

  if (_showTicker && rawMessages.length) {
    const mode  = cfg.tickerMode  || 'scroll';
    const align = cfg.tickerAlign || 'start';

    _dom.ticker      = el('div', { id: 'overlay-infobar-ticker' });
    _dom.tickerInner = el('div', { id: 'overlay-infobar-ticker-inner' });

    if (mode === 'fade') {
      // Alignment applies in fade mode — set justify-content on container
      if (align === 'center') _dom.ticker.style.justifyContent = 'center';
      else if (align === 'end') _dom.ticker.style.justifyContent = 'flex-end';
      // else default: flex-start
      _dom.tickerInner.textContent = rawMessages[0];
    } else {
      // Scroll mode: all messages joined, entry from right
      _dom.tickerInner.textContent = rawMessages.join('\u2003\u00b7\u2003');
      _dom.tickerInner.style.paddingLeft = '100%';
    }

    _dom.ticker.appendChild(_dom.tickerInner);
    bar.appendChild(_dom.ticker);
  } else {
    _dom.ticker      = null;
    _dom.tickerInner = null;
  }

  // Device info slot — shown when infoBarShowDeviceInfo is on
  if (cfg.infoBarShowDeviceInfo) {
    _dom.deviceInfo = el('div', { id: 'overlay-infobar-device' });
    _dom.deviceInfo.textContent = `Screen ${screenId || '?'}  ·  …`;
    bar.appendChild(_dom.deviceInfo);

    fetch('/api/screens/info', { signal: AbortSignal.timeout(2000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!_dom.deviceInfo) return;
        const port = data?.port;
        const ip   = data?.lanIps?.[0];
        const addr = ip ? `${ip}${port && port !== 80 && port !== 443 ? `:${port}` : ''}` : location.hostname;
        _dom.deviceInfo.textContent = `Screen ${screenId || '?'}  ·  ${addr}`;
      })
      .catch(() => {
        if (_dom.deviceInfo) _dom.deviceInfo.textContent = `Screen ${screenId || '?'}`;
      });
  } else {
    _dom.deviceInfo = null;
  }

  // Flex spacer — pushes the end-slot to the right when no ticker is acting as spacer
  if (!_dom.ticker) {
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);
  }

  // Theme end-slot — e.g. nav icons, right badge
  const slotEnd = document.getElementById('overlay-infobar-slot-end');
  if (slotEnd) { _dom.slotEnd = slotEnd; bar.appendChild(slotEnd); }

  return bar;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount (or remount) the info bar.
 * @param {object} cfg       Screen config object
 * @param {Array}  schedule  Sorted array of schedule entries
 * @param {string} [screenId] Screen ID for the device info slot
 */
export function mountInfoBar(cfg, schedule, screenId) {
  const remounting = _dom.bar !== null;
  removeInfoBar();

  _cfg      = cfg || {};
  _schedule = Array.isArray(schedule) ? schedule : [];

  // Prepare fade-mode state
  _tickerMessages = filterTickerMessages(_cfg.tickerMessages);
  _tickerDwellMs  = Math.max(500, (Number(_cfg.tickerFadeDwellSec) || 5) * 1000);

  _dom.bar = _buildBar(_cfg, screenId);
  if (remounting) _dom.bar.style.animation = 'none';
  if (_cfg.infoBarFontSize) {
    const fs = _cfg.infoBarFontSize;
    _dom.bar.style.setProperty('--infobar-font-size', `${fs}px`);
    // Scale height proportionally when the user picks a non-default font size.
    // When fs == DEFAULT_FONT_SIZE we leave --infobar-height alone so the theme
    // CSS variable (e.g. camp's 60px) is not clobbered by the JS override.
    if (fs !== DEFAULT_FONT_SIZE) {
      const scaledHeight  = Math.round((fs / DEFAULT_FONT_SIZE) * DEFAULT_INFOBAR_H);
      _dom.bar.style.setProperty('--infobar-height', `${scaledHeight}px`);
      // Also set on :root so hoisted theme elements (e.g. camp gold border) track it
      document.documentElement.style.setProperty('--infobar-height', `${scaledHeight}px`);
    }
  }
  document.body.appendChild(_dom.bar);

  // After mount, read the actual rendered height and publish it on :root so that
  // hoisted theme elements (e.g. the camp gold border) can position themselves
  // relative to the bar using var(--infobar-height).
  requestAnimationFrame(() => {
    if (!_dom.bar) return;
    const h = _dom.bar.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty('--infobar-height', `${h}px`);
  });

  _prevEventSnapshot = { name: null, timeVisible: null, visible: null, kind: null, name2: null, visible2: null };

  if (_cfg.infoBarShowClock !== false) _startClock();
  const showAnyEvent = _cfg.infoBarShowCurrentEvent !== false || _cfg.infoBarShowNextEvent !== false;
  if (showAnyEvent) {
    _refreshEventSlot();
    _startCountdownTimer();
  }
  if (_dom.tickerInner) _startTicker();

  _updateDividers();
}

/**
 * Tear down the info bar and stop all timers.
 */
export function removeInfoBar() {
  _stopClock();
  _stopCountdownTimer();
  _stopTicker();
  if (_dom.slotStart) document.body.appendChild(_dom.slotStart); // rescue before bar removal
  if (_dom.slotEnd)   document.body.appendChild(_dom.slotEnd);
  if (_dom.bar) { _dom.bar.remove(); }
  document.documentElement.style.removeProperty('--infobar-height');
  for (const k of Object.keys(_dom)) _dom[k] = null;
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
  if (!_dom.bar) return 0;
  return _dom.bar.offsetHeight || 40;
}

/**
 * Returns true if the info bar is currently mounted in the DOM.
 */
export function isInfoBarMounted() {
  return _dom.bar !== null;
}
