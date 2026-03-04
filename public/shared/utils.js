// Shared utilities used by both admin and screen modules

/**
 * Format a millisecond age as a human-readable relative time.
 * @param {number|null} ms - Age in milliseconds (now - timestamp)
 */
export function fmtAgo(ms) {
  if (ms == null) return '–';
  if (ms < 1000) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

/**
 * Linear interpolation
 * @param {number} a
 * @param {number} b
 * @param {number} t - 0..1
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Normalize a value within a range to 0..1
 * @param {number} val
 * @param {number} min
 * @param {number} max
 */
export function norm(val, min, max) {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (val - min) / (max - min)));
}

/**
 * Debounce a function call
 * @param {Function} fn
 * @param {number} ms
 */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Fisher-Yates shuffle in-place
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * HTML-escape a string for safe insertion into attribute values or text nodes.
 * @param {string|*} str
 * @returns {string}
 */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Create a DOM element with optional properties and children.
 * @param {string} tag - Element tag name
 * @param {object} [props]
 * @param {string}   [props.cls]    - className
 * @param {string}   [props.id]     - id
 * @param {string}   [props.text]   - textContent
 * @param {string}   [props.src]    - src attribute
 * @param {string}   [props.alt]    - alt attribute
 * @param {string}   [props.href]   - href attribute
 * @param {object}   [props.data]   - dataset entries
 * @param {object}   [props.styles] - inline style entries (camelCase)
 * @param {object}   [props.attrs]  - arbitrary attributes via setAttribute
 * @param {...Node}  children       - child nodes to append
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props.cls)   node.className   = props.cls;
  if (props.id)    node.id          = props.id;
  if (props.text)  node.textContent = props.text;
  if (props.src)   node.src         = props.src;
  if (props.alt)   node.alt         = props.alt;
  if (props.href)  node.href        = props.href;
  if (props.data)   for (const [k, v] of Object.entries(props.data))   node.dataset[k]       = v;
  if (props.styles) for (const [k, v] of Object.entries(props.styles)) node.style[k]         = v;
  if (props.attrs)  for (const [k, v] of Object.entries(props.attrs))  node.setAttribute(k, v);
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

/**
 * Format a millisecond duration as MM:SS or HH:MM:SS.
 * @param {number} ms
 * @returns {string}
 */
export function fmtDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Return a photo's best display URL.
 * @param {{ displayUrl?: string, url?: string }} photo
 * @returns {string}
 */
export function photoUrl(photo) {
  return photo.displayUrl || photo.url || '';
}

/**
 * Return the best thumbnail URL for a photo object (thumb preferred, falls back to display).
 * @param {{ thumbUrl?: string, displayUrl?: string, url?: string }} photo
 * @returns {string}
 */
export function photoThumbUrl(photo) {
  return photo.thumbUrl || photo.displayUrl || photo.url || '';
}

/**
 * Return the slide display duration in milliseconds.
 * @param {{ durationSec?: number }} slide
 * @param {number} defaultSec
 * @returns {number}
 */
export function slideDurationMs(slide, defaultSec) {
  return (slide.durationSec || defaultSec) * 1000;
}

/**
 * Return a Promise that resolves after ms milliseconds — for use as slide play().
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function slideDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract the screen config slice for the given screen ID from a global config object.
 * Falls back to screen '1' if the screen ID is not found.
 * @param {object} config   Global config object
 * @param {string|number} screenId
 * @returns {object}
 */
export function getScreenCfg(config, screenId) {
  return config?.screens?.[String(screenId)] || config?.screens?.['1'] || {};
}

/**
 * Return the sorted list of active screen IDs for a config object.
 * @param {{ screenCount?: number, screens?: object }} cfg
 * @returns {string[]}
 */
export function activeScreenIds(cfg) {
  const count = Math.max(1, Math.min(4, Number(cfg?.screenCount || 2)));
  const ids = Object.keys(cfg?.screens || {})
    .filter(id => Number(id) >= 1 && Number(id) <= 4)
    .sort((a, b) => Number(a) - Number(b));
  for (let i = 1; i <= count; i++) {
    const id = String(i);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, count).sort((a, b) => Number(a) - Number(b));
}
