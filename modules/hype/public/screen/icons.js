// Lucide-style inline SVG icons (MIT). Returned as strings so they can be
// injected into innerHTML. The stroke colour inherits from CSS `color`.

const _wrap = (body, size = 24) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" class="hype-icon">${body}</svg>`;

export const icon = {
  home:       (s) => _wrap(`<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2Z"/>`, s),
  search:     (s) => _wrap(`<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`, s),
  plus:       (s) => _wrap(`<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>`, s),
  reels:      (s) => _wrap(`<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>`, s),
  user:       (s) => _wrap(`<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`, s),
  users:      (s) => _wrap(`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`, s),
  eye:        (s) => _wrap(`<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>`, s),
  radio:      (s) => _wrap(`<path d="M4.9 19.1a10 10 0 0 1 0-14.2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/>`, s),

  heart:      (s) => _wrap(`<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21l8.84-8.61a5.5 5.5 0 0 0 0-7.78z"/>`, s),
  heartFill:  (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s||24}" height="${s||24}" viewBox="0 0 24 24" fill="currentColor" class="hype-icon">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21l8.84-8.61a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  comment:    (s) => _wrap(`<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>`, s),
  send:       (s) => _wrap(`<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>`, s),
  bookmark:   (s) => _wrap(`<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>`, s),
  more:       (s) => _wrap(`<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>`, s),

  verified:   (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s||16}" height="${s||16}" viewBox="0 0 24 24" fill="#3897f0" class="hype-icon hype-verified">
    <path d="M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 2.96 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.69 3.61.82 1.89 3.18L12 21.04l3.4 1.42 1.89-3.18 3.61-.82-.34-3.68L23 12zm-12.91 4.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z"/></svg>`,

  trendingUp: (s) => _wrap(`<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`, s),
  flame:      (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s||24}" height="${s||24}" viewBox="0 0 24 24" fill="currentColor" class="hype-icon">
    <path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>`,
  wifiOff:    (s) => _wrap(`<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>`, s),
  terminal:   (s) => _wrap(`<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`, s),
  shield:     (s) => _wrap(`<path d="M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5z"/>`, s),
  sparkles:   (s) => _wrap(`<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4Z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z"/><path d="M5 14l.6 1.6L7 16l-1.4.4L5 18l-.6-1.6L3 16l1.4-.4Z"/>`, s),
  lock:       (s) => _wrap(`<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/>`, s),
  key:        (s) => _wrap(`<circle cx="8" cy="15" r="4"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>`, s),
};

/** Render a circular monogram avatar (Twitter/X default style) with the
 *  channel's brand colour and a story-ring gradient frame. */
export function monogramAvatar(name, color, size = 40) {
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  const px = `${size}px`;
  return `<span class="hype-avatar" style="width:${px};height:${px};--ch-color:${color || '#444'};">
    <span style="font-size:${Math.round(size * 0.42)}px;font-weight:800;">${initial}</span>
  </span>`;
}
