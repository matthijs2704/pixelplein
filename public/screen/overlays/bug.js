// Overlay: corner bug (text or image)
// Appearance is driven by CSS custom properties; all have fallbacks matching the
// original hardcoded defaults so the bug looks identical when no theme is active.

import { cornerStyle }  from './_overlay-utils.js';
import { el }           from '../../../shared/utils.js';

let _bugEl = null;

export function mountBug(cfg, safeInsets = {}) {
  removeBug();
  if (!cfg.bugEnabled) return;
  if (!cfg.bugText && !cfg.bugImageUrl) return;

  const bugEl = el('div', { id: 'overlay-bug', attrs: { style: cornerStyle(cfg.bugCorner, safeInsets, '--bug-offset') } },
    cfg.bugImageUrl ? el('img', { src: cfg.bugImageUrl })                 : null,
    cfg.bugText     ? el('span', { text: cfg.bugText })                   : null,
  );

  document.body.appendChild(bugEl);
  _bugEl = bugEl;
}

export function removeBug() {
  if (_bugEl) { _bugEl.remove(); _bugEl = null; }
}
