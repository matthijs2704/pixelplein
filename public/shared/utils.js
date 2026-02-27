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
