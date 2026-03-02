// Social wall layout for approved attendee submissions.
// Designed as a contained, animated polaroid wall that never overflows screen bounds.

let _styleInjected = false;

function _ensureStyle() {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.id = 'submission-wall-layout-style';
  style.textContent = `
    .sw-layout {
      position: absolute;
      inset: 0;
      padding-top: var(--screen-padding-top, var(--screen-padding, 0px));
      padding-right: var(--screen-padding-right, var(--screen-padding, 0px));
      padding-bottom: var(--screen-padding-bottom, var(--screen-padding, 0px));
      padding-left: var(--screen-padding-left, var(--screen-padding, 0px));
      background:
        radial-gradient(110% 80% at 50% 0%, rgba(255, 255, 255, 0.08), transparent 60%),
        linear-gradient(165deg, rgba(0,0,0,0.18), rgba(0,0,0,0.05) 46%, transparent 72%),
        var(--submission-wall-bg, var(--polaroid-bg, #1b130c));
      overflow: hidden;
      isolation: isolate;
    }

    .sw-layout::before {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(circle at 25% 18%, rgba(255,255,255,0.05) 0%, transparent 36%),
        radial-gradient(circle at 80% 84%, rgba(255,255,255,0.04) 0%, transparent 38%),
        radial-gradient(ellipse at 50% 50%, transparent 44%, rgba(0, 0, 0, 0.48) 100%);
      z-index: 0;
    }

    .sw-shell {
      position: relative;
      width: 100%;
      height: 100%;
      padding: clamp(14px, 1.8vw, 30px);
      z-index: 1;
    }

    .sw-grid {
      width: 100%;
      height: 100%;
      display: grid;
      gap: clamp(10px, 1.2vw, 18px);
      align-content: center;
      justify-content: center;
    }

    .sw-single-wrap {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: clamp(8px, 1vw, 16px);
    }

    .sw-card {
      background: var(--polaroid-card-bg, #fffef8);
      border-radius: var(--polaroid-card-radius, 10px);
      box-shadow: var(--polaroid-card-shadow, 0 20px 48px rgba(0,0,0,0.5), 0 6px 16px rgba(0,0,0,0.3));
      display: flex;
      flex-direction: column;
      gap: clamp(6px, 0.7vw, 10px);
      padding: clamp(8px, 0.8vw, 12px) clamp(8px, 0.8vw, 12px) clamp(12px, 1vw, 16px);
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      transform: rotate(var(--sw-rot, 0deg));
      animation: sw-card-enter 500ms cubic-bezier(0.2, 0.85, 0.25, 1) var(--sw-delay, 0ms) both;
    }

    .sw-grid .sw-card {
      width: 100%;
      height: 100%;
    }

    .sw-single-wrap .sw-card {
      width: min(68vw, 1120px);
      max-height: 88vh;
      transform: rotate(-0.8deg);
    }

    .sw-photo {
      width: 100%;
      aspect-ratio: 4 / 3;
      border-radius: 6px;
      object-fit: cover;
      background: #111;
      flex-shrink: 0;
    }

    .sw-single-wrap .sw-photo {
      max-height: min(58vh, 720px);
    }

    .sw-copy {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-height: 0;
    }

    .sw-message {
      color: var(--submission-wall-message-color, #2e2317);
      font-family: var(--submission-wall-message-font, var(--submission-font-family, 'Georgia', 'Times New Roman', serif));
      font-weight: 700;
      line-height: 1.22;
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: var(--sw-lines, 3);
    }

    .sw-grid .sw-message {
      font-size: clamp(14px, 1.5vw, 26px);
      --sw-lines: 3;
    }

    .sw-single-wrap .sw-message {
      font-size: clamp(24px, 3.1vw, 52px);
      --sw-lines: 4;
    }

    .sw-meta {
      color: var(--submission-wall-meta-color, #5e4d3a);
      font-family: var(--submission-wall-meta-font, 'Segoe UI', system-ui, sans-serif);
      font-weight: 600;
      letter-spacing: 0.02em;
      opacity: 0.92;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sw-grid .sw-meta {
      font-size: clamp(11px, 1.02vw, 14px);
    }

    .sw-single-wrap .sw-meta {
      font-size: clamp(13px, 1.3vw, 20px);
    }

    .sw-empty {
      width: min(62vw, 920px);
      padding: clamp(18px, 2.2vw, 34px);
      border-radius: 14px;
      background: var(--polaroid-card-bg, #fffef8);
      box-shadow: var(--polaroid-card-shadow, 0 20px 48px rgba(0,0,0,0.5), 0 6px 16px rgba(0,0,0,0.3));
      text-align: center;
      animation: sw-card-enter 540ms cubic-bezier(0.2, 0.85, 0.25, 1) both;
    }

    .sw-empty-title {
      color: var(--submission-wall-message-color, #2e2317);
      font-family: var(--submission-wall-message-font, var(--submission-font-family, 'Georgia', 'Times New Roman', serif));
      font-size: clamp(34px, 4.2vw, 68px);
      line-height: 1.06;
      font-weight: 800;
      margin-bottom: 8px;
    }

    .sw-empty-sub {
      color: var(--submission-wall-meta-color, #5e4d3a);
      font-family: var(--submission-wall-meta-font, 'Segoe UI', system-ui, sans-serif);
      font-size: clamp(16px, 1.7vw, 26px);
      font-weight: 600;
      line-height: 1.25;
    }

    .sw-qr {
      position: absolute;
      right: clamp(12px, 1.8vw, 24px);
      bottom: clamp(12px, 1.8vh, 24px);
      z-index: 3;
      background: rgba(8, 12, 18, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 12px;
      padding: 9px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      box-shadow: 0 8px 18px rgba(0,0,0,0.36);
      animation: sw-card-enter 420ms cubic-bezier(0.2, 0.85, 0.25, 1) 160ms both;
    }

    .sw-qr img {
      width: min(10.5vw, 112px);
      border-radius: 5px;
      background: #fff;
    }

    .sw-qr-label {
      color: #fff;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: clamp(10px, 0.92vw, 13px);
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      opacity: 0.93;
    }

    @keyframes sw-card-enter {
      from {
        opacity: 0;
        transform: translateY(18px) scale(0.94) rotate(var(--sw-rot, 0deg));
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1) rotate(var(--sw-rot, 0deg));
      }
    }
  `;

  document.head.appendChild(style);
}

function _buildCard(item, isSingle) {
  const card = document.createElement('article');
  card.className = 'sw-card';

  if (item.photoThumbUrl || item.photoUrl) {
    const img = document.createElement('img');
    img.className = 'sw-photo';
    img.src = item.photoUrl || item.photoThumbUrl;
    img.alt = '';
    card.appendChild(img);
  }

  const copy = document.createElement('div');
  copy.className = 'sw-copy';

  const messageText = String(item.message || '').trim();
  if (messageText) {
    const message = document.createElement('div');
    message.className = 'sw-message';
    message.textContent = messageText;
    copy.appendChild(message);
  }

  const meta = document.createElement('div');
  meta.className = 'sw-meta';
  meta.textContent = item.submitterValue ? `from ${item.submitterValue}` : (isSingle ? 'approved submission' : 'event submission');
  copy.appendChild(meta);

  card.appendChild(copy);
  return card;
}

function _appendQr(shell, options = {}) {
  if (!options.showQr || !options.qrImageUrl) return;

  const qr = document.createElement('div');
  qr.className = 'sw-qr';

  const img = document.createElement('img');
  img.src = options.qrImageUrl;
  img.alt = '';
  qr.appendChild(img);

  const label = document.createElement('div');
  label.className = 'sw-qr-label';
  label.textContent = 'submit yours';
  qr.appendChild(label);

  shell.appendChild(qr);
}

function _buildSingle(shell, items) {
  const wrap = document.createElement('div');
  wrap.className = 'sw-single-wrap';

  const item = items[0];
  if (!item) {
    const empty = document.createElement('div');
    empty.className = 'sw-empty';

    const title = document.createElement('div');
    title.className = 'sw-empty-title';
    title.textContent = 'Share your photos';
    empty.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'sw-empty-sub';
    sub.textContent = 'Your approved submissions will appear here';
    empty.appendChild(sub);

    wrap.appendChild(empty);
    shell.appendChild(wrap);
    return;
  }

  const card = _buildCard(item, true);
  card.style.setProperty('--sw-rot', '-0.8deg');
  card.style.setProperty('--sw-delay', '0ms');
  wrap.appendChild(card);
  shell.appendChild(wrap);
}

function _buildGrid(shell, items) {
  const grid = document.createElement('div');
  grid.className = 'sw-grid';

  const total = items.length;
  const cols = total <= 2 ? 2 : total <= 4 ? 2 : total <= 8 ? 3 : 4;
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

  items.forEach((item, index) => {
    const card = _buildCard(item, false);
    const rot = (Math.random() * 3.2 - 1.6).toFixed(2);
    card.style.setProperty('--sw-rot', `${rot}deg`);
    card.style.setProperty('--sw-delay', `${index * 80}ms`);
    grid.appendChild(card);
  });

  shell.appendChild(grid);
}

/**
 * @param {Array} items
 * @param {'single'|'grid'|'both'} mode
 * @param {{ showQr?: boolean, qrImageUrl?: string }} options
 */
export function buildSubmissionWall(items, mode = 'both', options = {}) {
  _ensureStyle();

  const list = Array.isArray(items) ? items : [];
  const el = document.createElement('div');
  el.className = 'layout sw-layout';

  const shell = document.createElement('div');
  shell.className = 'sw-shell';
  el.appendChild(shell);

  const wallMode = mode === 'both'
    ? (list.length >= 5 ? 'grid' : (Math.random() < 0.5 ? 'single' : 'grid'))
    : mode;

  if (!list.length || wallMode === 'single') {
    _buildSingle(shell, list);
  } else {
    _buildGrid(shell, list);
  }

  _appendQr(shell, options);

  return {
    el,
    visibleIds: list.map(item => `submission:${item.id}`),
    startMotion: () => {},
  };
}
