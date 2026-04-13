import { el } from '../../shared/utils.js';

// Social wall layout — polaroid-card style.
// Cards have a fixed intrinsic size and are centred on the background;
// they never stretch to fill a cell. Pages crossfade when there are more
// submissions than fit on one screen.

/* ── Sizing maths ─────────────────────────────────────────────────────── */

// Default cards per page; actual page size comes from admin config.
const DEFAULT_PAGE_SIZE = 6;
const PAGE_DWELL_MS = 6000;
const PAGE_EXIT_MS  = 380;

/**
 * Compute card dimensions based on how many cards appear on the page.
 *
 * Returns pixel values derived from the viewport so cards always fit
 * without scrolling but retain natural polaroid proportions.
 *
 * Layout is arranged in a balanced grid with up to 4 cards per row.
 */
/**
 * Compute card dimensions for the submission wall grid.
 *
 * Derives pixel values from the current viewport so cards always fit without
 * scrolling while retaining natural polaroid proportions.
 *
 * @param {number} n            - number of cards on this page
 * @param {number} bottomInset  - pixels reserved at the bottom (e.g. info bar)
 * @returns {{ cols, rows, pad, gap, cardW, cardH, border, photoSize, footerH, msgSize, metaSize, quoteSize }}
 */
function _sizing(n, bottomInset) {
  const vw = window.innerWidth  || 1920;
  const vh = window.innerHeight || 1080;
  const usableH = vh - (bottomInset || 0);

  const cols = n === 1 ? 1 : Math.min(4, n);
  const rows = Math.max(1, Math.ceil(n / cols));

  // Gaps and padding in px
  const pad  = Math.round(Math.min(vw * 0.022, 32));
  const gap  = Math.round(Math.min(vw * 0.016, 22));

  // Available space
  const availW = vw - pad * 2 - gap * (cols - 1);
  const availH = usableH - pad * 2 - gap * (rows - 1);

  // Card width derived from horizontal space
  const cardW = Math.floor(availW / cols);

  // Photo square inside the card (polaroid style: equal-sided)
  // Border = 4% of card width, minimum 6px
  const border = Math.max(6, Math.round(cardW * 0.04));

  // Photo size: square, fills card width inside borders
  const photoSize = cardW - border * 2;

  // Footer height: a generous white strip below the photo
  // Hero gets a taller footer for bigger text; grid cards get a compact one
  const footerH = n === 1
    ? Math.round(cardW * 0.22)
    : Math.round(cardW * 0.28);

  // Total card height
  const cardH = border + photoSize + footerH; // no bottom border — footer is the bottom

  // Check that the grid actually fits vertically; scale down if needed
  const totalH = cardH * rows + gap * (rows - 1) + pad * 2;
  const scale  = totalH > usableH ? (usableH - pad * 2 - gap * (rows - 1)) / (cardH * rows) : 1;
  const finalCardW = Math.floor(cardW  * scale);
  const finalCardH = Math.floor(cardH  * scale);
  const finalBorder = Math.max(5, Math.round(border * scale));
  const finalPhoto = finalCardW - finalBorder * 2;
  const finalFooter = finalCardH - finalBorder - finalPhoto;

  // Font sizes relative to card width
  const msgSize  = n === 1
    ? Math.round(finalCardW * 0.055)   // hero: big
    : Math.round(finalCardW * 0.072);  // grid: fill the footer
  const metaSize = Math.round(msgSize * 0.62);
  const quoteSize = Math.round(msgSize * 1.8);

  return {
    cols, rows, pad, gap,
    cardW: finalCardW, cardH: finalCardH,
    border: finalBorder,
    photoSize: finalPhoto,
    footerH: finalFooter,
    msgSize, metaSize, quoteSize,
  };
}

/* ── Row layout helper ────────────────────────────────────────────────── */

/** Array of row lengths for n cards in a max-3 grid. */
function _rowSizes(n) {
  if (n <= 1) return [1];
  const cols = Math.min(4, n);
  const rows = Math.ceil(n / cols);
  const base = Math.floor(n / rows);
  const remainder = n % rows;
  const out = [];

  for (let i = 0; i < rows; i++) {
    out.push(base + (i < remainder ? 1 : 0));
  }

  return out;
}

/* ── Card builder ─────────────────────────────────────────────────────── */

function _buildCard(item, sz, delayMs, isHero) {
  const hasPhoto   = !!(item.photoThumbUrl || item.photoUrl);
  const msgText    = String(item.message || '').trim();
  const metaText   = item.submitterValue ? `— ${item.submitterValue}` : '';

  const card = el('article', { cls: 'sw-card' });
  card.style.setProperty('--sw-rot',    `${(Math.random() * 3.2 - 1.6).toFixed(2)}deg`);
  card.style.setProperty('--sw-delay',  `${delayMs}ms`);
  card.style.setProperty('--sw-card-w', `${sz.cardW}px`);
  if (isHero) card.style.setProperty('--sw-rot', `${(Math.random() * 1.4 - 0.7).toFixed(2)}deg`);

  if (hasPhoto) {
    // Photo area — square, with polaroid border on sides and top
    const wrap = el('div', { cls: 'sw-photo-wrap' });
    wrap.style.cssText = [
      `width:${sz.photoSize}px;`,
      `height:${sz.photoSize}px;`,
      `margin:${sz.border}px ${sz.border}px 0 ${sz.border}px;`,
    ].join('');

    const img = el('img', { cls: 'sw-photo', src: item.photoThumbUrl || item.photoUrl, alt: '' });
    wrap.appendChild(img);
    card.appendChild(wrap);
  }

  // Footer / copy area
  const footer = el('div', { cls: 'sw-footer' });
  footer.style.cssText = [
    `min-height:${sz.footerH}px;`,
    `padding:${Math.round(sz.footerH * 0.12)}px ${sz.border}px ${Math.round(sz.footerH * 0.14)}px;`,
  ].join('');

  if (!hasPhoto && msgText) {
    // Text-only card: decorative quote mark above message
    const qm = el('span', { cls: 'sw-quote-mark', text: '\u201C' });
    qm.style.fontSize = `${sz.quoteSize}px`;
    footer.appendChild(qm);
  }

  if (msgText) {
    const msg = el('div', { cls: 'sw-message', text: msgText });
    msg.style.fontSize = `${sz.msgSize}px`;
    // Text-only: allow more lines in the tall footer
    msg.style.setProperty('--sw-lines', hasPhoto ? '2' : '5');
    footer.appendChild(msg);
  }

  if (metaText) {
    const meta = el('div', { cls: 'sw-meta', text: metaText });
    meta.style.fontSize = `${sz.metaSize}px`;
    footer.appendChild(meta);
  }

  card.appendChild(footer);
  return card;
}

/* ── Page builder ─────────────────────────────────────────────────────── */

function _buildPage(items, entering, bottomInset) {
  const n    = items.length;
  const sz   = _sizing(n, bottomInset);
  const rows = _rowSizes(n);

  const page = el('div', { cls: 'sw-page' + (entering ? ' sw-page-enter' : '') });
  page.style.setProperty('--sw-gap', `${sz.gap}px`);
  page.style.setProperty('--sw-pad', `${sz.pad}px`);

  const isHero = n === 1;
  let cursor = 0;
  rows.forEach((rowLen, rowIdx) => {
    const row = el('div', { cls: 'sw-row' });
    for (let i = 0; i < rowLen; i++) {
      const delay = (rowIdx * 3 + i) * 70;
      const card  = _buildCard(items[cursor++], sz, delay, isHero);
      row.appendChild(card);
    }
    page.appendChild(row);
  });

  return page;
}

/* ── QR bug ───────────────────────────────────────────────────────────── */

function _appendQr(shell, options = {}) {
  if (!options.showQr || !options.qrImageUrl) return;
  const bottomInset = Number(options.bottomInset) || 0;
  const baseBottom  = Math.max(12, Math.round(window.innerHeight * 0.018));

  const qr = el('div', { cls: 'sw-qr' });
  qr.style.bottom = `${baseBottom + bottomInset}px`;

  const img = el('img', { src: options.qrImageUrl, alt: '' });
  qr.appendChild(img);

  qr.appendChild(el('div', { cls: 'sw-qr-label', text: 'deel jouw foto' }));

  shell.appendChild(qr);
}

/* ── Page rotation ────────────────────────────────────────────────────── */

function _startPaging(shell, pageChunks, firstPage, bottomInset) {
  if (pageChunks.length <= 1) return () => {};

  let current   = firstPage;
  let pageIndex = 0;
  let timer     = null;

  function advance() {
    if (!shell.isConnected) return;

    pageIndex = (pageIndex + 1) % pageChunks.length;
    const next = _buildPage(pageChunks[pageIndex], false, bottomInset);

    current.classList.remove('sw-page-enter');
    current.classList.add('sw-page-exit');

    timer = setTimeout(() => {
      if (!shell.isConnected) return;
      current.remove();
      next.classList.add('sw-page-enter');
      const qrEl = shell.querySelector('.sw-qr');
      qrEl ? shell.insertBefore(next, qrEl) : shell.appendChild(next);
      current = next;
      timer = setTimeout(advance, PAGE_DWELL_MS);
    }, PAGE_EXIT_MS);
  }

  timer = setTimeout(advance, PAGE_DWELL_MS);
  return () => clearTimeout(timer);
}

/* ── Public API ───────────────────────────────────────────────────────── */

/**
 * @param {Array}  items
 * @param {string} mode   'single' | 'grid' | 'both'
 * @param {{ showQr?: boolean, qrImageUrl?: string, bottomInset?: number, pageSize?: number }} options
 */
export function buildSubmissionWall(items, mode = 'both', options = {}) {
  const list        = Array.isArray(items) ? items : [];
  const bottomInset = Number(options.bottomInset) || 0;
  const pageSize    = Math.max(3, Math.min(12, Math.floor(Number(options.pageSize) || DEFAULT_PAGE_SIZE)));

  const rootEl = el('div', { cls: 'layout sw-layout' });
  if (bottomInset > 0) rootEl.style.paddingBottom = `${bottomInset}px`;

  const shell = el('div', { cls: 'sw-shell' });
  rootEl.appendChild(shell);

  // Empty state
  if (!list.length) {
    shell.appendChild(el('div', { cls: 'sw-empty-wrap' },
      el('div', { cls: 'sw-empty' },
        el('div', { cls: 'sw-empty-title', text: 'Deel jouw foto\'s' }),
        el('div', { cls: 'sw-empty-sub',   text: 'Goedgekeurde inzendingen verschijnen hier' }),
      ),
    ));
    _appendQr(shell, options);
    return { el: rootEl, visibleIds: [], startMotion: () => {} };
  }

  // Effective mode
  const effectiveMode = mode === 'both'
    ? (list.length === 1 ? 'single' : 'grid')
    : mode;

  // Single / hero
  if (effectiveMode === 'single' || list.length === 1) {
    const page = _buildPage([list[0]], true, bottomInset);
    shell.appendChild(page);
    _appendQr(shell, options);
    return {
      el: rootEl,
      visibleIds: [`submission:${list[0].id}`],
      startMotion: () => {},
    };
  }

  // Grid with optional paging
  const pageChunks = [];
  for (let i = 0; i < list.length; i += pageSize) {
    pageChunks.push(list.slice(i, i + pageSize));
  }

  const firstPage = _buildPage(pageChunks[0], true, bottomInset);
  shell.appendChild(firstPage);
  _appendQr(shell, options);

  let _stopPaging = () => {};

  return {
    el: rootEl,
    visibleIds: list.map(i => `submission:${i.id}`),
    startMotion() {
      _stopPaging = _startPaging(shell, pageChunks, firstPage, bottomInset);
    },
    destroy() {
      _stopPaging();
    },
  };
}
