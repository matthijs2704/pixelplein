// Polaroid layout: photos displayed as slightly rotated "polaroid" cards
// on a dark background. Cards are scattered across the whole screen including
// the centre, overlapping naturally like photos tossed on a table.

function jitter(base, range) {
  return base + (Math.random() - 0.5) * 2 * range;
}

/**
 * @param {Object[]} photos - 5–10 photos
 * @returns {{ el, visibleIds, startMotion }}
 */
export function buildPolaroid(photos) {
  const el = document.createElement('div');
  el.className = 'layout layout-polaroid';
  el.style.cssText = 'position:absolute;inset:0;' +
    'padding-top:var(--screen-padding-top,var(--screen-padding,0px));' +
    'padding-right:var(--screen-padding-right,var(--screen-padding,0px));' +
    'padding-bottom:var(--screen-padding-bottom,var(--screen-padding,0px));' +
    'padding-left:var(--screen-padding-left,var(--screen-padding,0px));' +
    'background:var(--polaroid-bg,#18130e);';

  // Warm vignette
  const vignette = document.createElement('div');
  vignette.style.cssText = [
    'position:absolute;inset:0;pointer-events:none;z-index:999;',
    'background:radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.45) 100%);',
  ].join('');
  el.appendChild(vignette);

  // Keyframes — injected once
  const STYLE_ID = 'polaroid-anim-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes polaroid-drop {
        0%   { opacity:0; transform:translate(-50%,calc(-50% - var(--lift))) rotate(var(--rot)) scale(0.93); }
        70%  { opacity:1; transform:translate(-50%,calc(-50% + 3px)) rotate(calc(var(--rot) + var(--rock))) scale(1.01); }
        100% { opacity:1; transform:translate(-50%,-50%) rotate(var(--rot)) scale(1); }
      }
    `;
    document.head.appendChild(style);
  }

  // Position presets — centres spread across the whole screen, including middle.
  // cx/cy are % of screen width/height for the card centre.
  // Designed so no large empty region forms regardless of jitter.
  const PRESETS = {
    5: [
      { cx: 25, cy: 35, rot: -7 },
      { cx: 72, cy: 28, rot:  6 },
      { cx: 50, cy: 55, rot: -3 }, // centre
      { cx: 22, cy: 72, rot:  8 },
      { cx: 76, cy: 68, rot: -6 },
    ],
    6: [
      { cx: 22, cy: 32, rot: -8 },
      { cx: 58, cy: 25, rot:  5 },
      { cx: 82, cy: 45, rot: -4 },
      { cx: 42, cy: 55, rot:  7 }, // centre-left
      { cx: 20, cy: 70, rot: -5 },
      { cx: 68, cy: 72, rot:  6 },
    ],
    7: [
      { cx: 20, cy: 30, rot: -8 },
      { cx: 52, cy: 22, rot:  4 },
      { cx: 80, cy: 35, rot: -5 },
      { cx: 35, cy: 52, rot:  7 }, // centre-left
      { cx: 68, cy: 56, rot: -6 }, // centre-right
      { cx: 22, cy: 74, rot:  5 },
      { cx: 72, cy: 75, rot: -7 },
    ],
    8: [
      { cx: 18, cy: 28, rot: -8 },
      { cx: 48, cy: 20, rot:  4 },
      { cx: 78, cy: 30, rot: -3 },
      { cx: 28, cy: 52, rot:  6 },
      { cx: 62, cy: 48, rot: -7 }, // centre-right
      { cx: 82, cy: 66, rot:  5 },
      { cx: 48, cy: 72, rot: -4 }, // centre-bottom
      { cx: 16, cy: 68, rot:  7 },
    ],
    9: [
      { cx: 16, cy: 26, rot: -8 },
      { cx: 44, cy: 18, rot:  5 },
      { cx: 74, cy: 24, rot: -3 },
      { cx: 86, cy: 50, rot:  8 },
      { cx: 26, cy: 46, rot: -6 },
      { cx: 55, cy: 50, rot:  3 }, // centre
      { cx: 74, cy: 72, rot: -7 },
      { cx: 42, cy: 76, rot:  6 },
      { cx: 16, cy: 68, rot: -4 },
    ],
    10: [
      { cx: 15, cy: 24, rot: -8 },
      { cx: 40, cy: 16, rot:  5 },
      { cx: 66, cy: 20, rot: -2 },
      { cx: 86, cy: 36, rot:  8 },
      { cx: 28, cy: 44, rot: -6 },
      { cx: 56, cy: 40, rot:  4 }, // centre
      { cx: 82, cy: 62, rot: -5 },
      { cx: 58, cy: 72, rot:  6 },
      { cx: 32, cy: 74, rot: -6 },
      { cx: 12, cy: 60, rot:  7 },
    ],
  };

  const count      = Math.min(Math.max(photos.length, 5), 10);
  const bases      = PRESETS[count] || PRESETS[5];
  const visibleIds = [];

  // Card sizing — large but scales down gently for higher counts.
  // Overlap is intentional; each card is fully visible before the next lands.
  const PHOTO_VH  = count <= 5 ? 48 : count <= 6 ? 44 : count <= 7 ? 40 : count <= 8 ? 37 : count <= 9 ? 34 : 31;
  const BORDER_VH = Math.max(1.2, PHOTO_VH * 0.05); // ~5% border, minimum 1.2vh
  const FOOTER_VH = BORDER_VH * 4.0;                // thick bottom strip (4× side border)
  const CARD_W_VH = PHOTO_VH + BORDER_VH * 2;
  const CARD_H_VH = PHOTO_VH + BORDER_VH + FOOTER_VH;

  const STAGGER_MS = 350;

  for (let i = 0; i < count; i++) {
    const photo = photos[i];
    const base  = bases[i];
    if (!photo) continue;

    const cx   = jitter(base.cx,  5);
    const cy   = jitter(base.cy,  4);
    const rot  = jitter(base.rot, 3.5);
    const rock = (i % 2 === 0 ? 0.5 : -0.5) + jitter(0, 0.3);
    const lift = Math.round(40 + Math.random() * 20) + 'px';
    const dur  = Math.round(380 + Math.random() * 80);

    const card = document.createElement('div');
    card.style.cssText = [
      'position:absolute;',
      `width:${CARD_W_VH}vh;`,
      `height:${CARD_H_VH}vh;`,
      `left:${cx}%;top:${cy}%;`,
      `transform:translate(-50%,-50%) rotate(${rot}deg);`,
      `--rot:${rot}deg;`,
      `--rock:${rock}deg;`,
      `--lift:${lift};`,
      'background:var(--polaroid-card-bg,#fffef8);',
      'border-radius:var(--polaroid-card-radius,10px);',
      'box-shadow:var(--polaroid-card-shadow,0 24px 60px rgba(0,0,0,0.65),0 6px 18px rgba(0,0,0,0.4),0 2px 4px rgba(0,0,0,0.25));',
      'display:flex;flex-direction:column;',
      `z-index:${i + 1};`,
      `animation:polaroid-drop ${dur}ms cubic-bezier(0.25,0.46,0.45,0.94) ${i * STAGGER_MS}ms both;`,
    ].join('');

    // Photo — forced square via aspect-ratio so landscape/portrait both crop correctly
    const photoWrap = document.createElement('div');
    photoWrap.style.cssText = [
      `width:${PHOTO_VH}vh;`,
      `height:${PHOTO_VH}vh;`, // explicit square — belt + suspenders with object-fit:cover
      'flex-shrink:0;',
      'overflow:hidden;',
      'border-radius:4px;',
      `margin:${BORDER_VH}vh ${BORDER_VH}vh 0 ${BORDER_VH}vh;`,
    ].join('');

    const img = document.createElement('img');
    img.src   = photo.displayUrl || photo.url;
    img.alt   = photo.name || '';
    // object-fit:cover + object-position:center crops to square from centre
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:center;display:block;';
    photoWrap.appendChild(img);

    // Thick white bottom strip — the polaroid signature
    const footer = document.createElement('div');
    footer.style.cssText = `height:${FOOTER_VH}vh;flex-shrink:0;`;

    card.appendChild(photoWrap);
    card.appendChild(footer);
    el.appendChild(card);

    visibleIds.push(photo.id);
  }

  return {
    el,
    visibleIds,
    startMotion: () => {},
  };
}
