// fulco-festival-2026:zone-loop — "Van Maarn naar de wereld"
// Level change -> scouting journey map, then station photo page expands from the station.
// Admin click → map overlay immediately, card updates live.
//
// Tag photos in admin with eventGroup:
//   fulco | rsw | regio | hit | landelijk | jamboree
// ponytail: texts hardcoded — edit LEVELS before the event

import { photoUrl } from '/shared/utils.js';
import { getLevel, getLevelChangedAt, isManual } from './state-client.js';

const CYCLES_PER_LEVEL = 4;

// Route split into 3 segments for prev→next line animation
const SEGMENTS = [
  { path: 'M 245 720 C 360 690, 430 620, 560 590', len: 360 },
  { path: 'M 560 590 C 720 548, 760 452, 910 420', len: 390 },
  { path: 'M 910 420 C 1070 388, 1110 284, 1260 250', len: 410 },
];

const START_POINT = { x: 110, y: 760 };
const START_PATH = 'M 110 760 C 145 742, 188 728, 245 720';
const CONTINUE_PATH = 'M 1260 250 C 1350 220, 1424 172, 1508 110';
const JOURNEY_REVEAL_DELAY_MS = 3600;
const PAGE_REVEAL_MS = 2150;
const RETURN_TO_MAP_MS = 850;
const MAP_VIEWBOX = { x: 0, y: 0, w: 1600, h: 900 };
const PHOTO_VARIANTS = ['hero-grid', 'hero-stack', 'triptych', 'postcard'];

const STATIONS = [
  { x: 245, y: 720 },
  { x: 560, y: 590 },
  { x: 910, y: 420 },
  { x: 1260, y: 250 },
];

const LEVELS = [
  {
    step: 1, tag: 'MAARN', color: '#6c9fc9',
    laag: 'Jouw eigen groep',
    naam: 'Scouting Ridder Fulco',
    waarom: 'Hier begin je. Je eigen groep, je eigen vrienden, je eigen avonturen — elke zaterdag weer.',
    events: ['Gewone Opkomsten', 'Weekendkampen', 'Zomerkamp'],
    chips: ['blokhut', 'speltakken', 'kamp', 'vrijwilligers'],
    groups: ['opkomsten', 'weka', 'zoka'],
    eventGroup: { 'Gewone Opkomsten': 'opkomsten', 'Weekendkampen': 'weka', 'Zomerkamp': 'zoka' },
  },
  {
    step: 2, tag: 'REGIO UH', color: '#ed1c24',
    laag: 'De regio',
    naam: 'Regio Utrechtse Heuvelrug',
    waarom: 'Ineens ben je niet meer alleen. Je ontmoet scouts van andere groepen en ontdekt dat scouting veel groter is dan de opkomsten in Maarn.',
    events: ['Bever-doe-dag', 'Jungledag', 'RSW', 'IJsberenweekend'],
    chips: ['regioactiviteit', 'RSW', 'ploegen', 'samenwerking'],
    groups: ['rsw', 'jungledag', 'ybw'],
    eventGroup: { 'Bever-doe-dag': 'beverdoedag', 'Jungledag': 'jungledag', 'RSW': 'rsw', 'IJsberenweekend': 'ybw' },
  },
  {
    step: 3, tag: 'NEDERLAND', color: '#00a551',
    laag: 'Heel Nederland',
    naam: 'Scouting Nederland',
    waarom: 'Jij kiest je eigen avontuur. LSW, HIT — er is voor ieder wat wils, ergens in Nederland.',
    events: ['LSW', 'HIT'],
    chips: ['Scouting Nederland', 'LSW', 'HIT', 'zelf kiezen'],
    groups: ['hit', 'lsw'],
    eventGroup: { 'LSW': 'lsw', 'HIT': 'hit' },
  },
  {
    step: 4, tag: 'DE WERELD', color: '#7c3aed',
    laag: 'De hele wereld',
    naam: 'Wereldjamboree',
    waarom: 'Het grootste avontuur begint gewoon hier, in Maarn. Maar het eindigt aan de andere kant van de wereld.',
    events: ['World Scout Jamboree', 'Gdańsk 2027'],
    chips: ['internationaal', 'Gdańsk 2027', 'Bravely', 'Thessa'],
    groups: ['wsj'],
    eventGroup: { 'World Scout Jamboree': 'wsj', 'Gdańsk 2027': 'wsj' },
  },
];

const EVENT_INFO = {
  'Gewone Opkomsten': {
    label: 'Bij je eigen groep',
    text: 'Elke week samen spelen, bouwen, avonturen beleven en nieuwe dingen leren in je eigen speltak, met je eigen vrienden.',
    feit: 'Scouting Ridder Fulco bestaat al sinds 1969, dus Scouting in Maarn is waarschijnlijk ouder dan jouw ouders!',
    chips: ['jouw speltak', 'wekelijks', 'vrienden', 'blokhut'],
    question: 'Hoeveel speltakken heeft Scouting Ridder Fulco?',
  },
  'Weekendkampen': {
    label: 'Een nachtje weg',
    text: 'Overnachten in een gebouw/tent, nachtspellen doen en keten met je groep — je eerste stapje richting echt avontuur!',
    feit: 'De bevers en welpen slapen meestal in het gebouw, de verkenners en explorers slapen vaak in tenten op het terrein, en zetten deze ook zelf op.',
    chips: ['overnachten', 'nachtspel', 'tentenkamp', 'avontuur', 'Maarn'],
    question: 'Hoeveel keer per jaar is er een weekendkamp?',
  },
  'Zomerkamp': {
    label: 'Het hoogtepunt van het jaar',
    text: 'Een hele week op pad, zelf koken, bouwen en slapen onder de sterren. Het moment waarop je merkt dat je meer kunt dan je dacht!',
    feit: 'De Explorers gaan naar het buitenland op zomerkamp en verdienen daar zelf hun geld voor — door te klussen en het Pannenkoeken restaurant te organiseren.',
    chips: ['7 dagen', 'koken', 'bouwen', 'zelfstandig', 'ergens anders'],
    question: 'Hoeveelste zomerkamp is het voor Matthijs als leiding?',
  },
  'Bever-doe-dag': {
    label: 'Samen spelen met de hele regio',
    text: 'Tientallen bevers uit de hele regio komen samen voor één grote, vrolijke speeldag. Nieuwe vriendjes maken gegarandeerd!',
    feit: 'Elke Bever-doe-dag heeft een ander thema en verhaal — geen twee edities zijn ooit hetzelfde!',
    chips: ['5–7 jaar', 'bevers', 'regio', 'speeldag', 'nieuwe vrienden'],
    question: 'Waar vond de afgelopen bever-doe-dag plaats?',
  },
  'Jungledag': {
    label: 'Welpen uit de hele regio',
    text: 'Welpen van andere groepen komen samen voor een groot spel. Want scouting is veel groter dan alleen jouw groep!',
    feit: 'Op één Jungledag spelen soms meer dan 300 welpen tegelijk samen — dat is een heel welpenleger!',
    chips: ['7-11 jaar', 'welpen', 'regio', 'groot spel', 'samenwerken'],
    question: 'Hoeveel welpen(groepen) deden er dit jaar mee aan Jungledag?',
  },
  'RSW': {
    label: 'Strijden met je ploeg',
    text: 'Een heel weekend zonder je leiding: zelf je kamp opbouwen, koken op houtvuur en hiken met je ploeg. Alleen de beste ploegen gaan door naar de LSW!',
    feit: 'RSW staat voor Regionale ScoutingWedstrijden. Alleen de winnende ploeg mag door naar de landelijke finale.',
    chips: ['ploegen', 'houtvuur', 'hiken', 'naar de LSW'],
    question: 'Welke Scouting-groep heeft dit jaar RSW gewonnen?',
  },
  'IJsberenweekend': {
    label: 'Winterse uitdaging',
    text: 'Kamperen en hiken midden in de winter — alleen de stoerste scouts durven dit aan!',
    feit: 'Het IJsberenweekend vindt altijd in januari of februari plaats — als het echt koud is.',
    chips: ['winter', 'kamperen', 'hiken', 'ijskoud', 'IJsberenweekend is cool!'],
    question: 'Wat deed Scouting Maarn altijd aan naar het IJsberenweekend?',
  },
  'HIT': {
    label: 'Kies je eigen avontuur',
    text: 'Hiken, klimmen, theater, koken of survivallen — jíj kiest wat je doet! De HIT is het enige scoutingevenement waarbij je zelf bepaalt wat voor avontuur je beleeft.',
    feit: 'Elk jaar worden er op 8 plekken meer dan 80 activiteiten georganiseerd — van klimmen en koken tot theater en survival.',
    chips: ['8 locaties', '86 activiteiten', 'zelf kiezen', 'door heel Nederland'],
    question: 'In welk weekend vindt de HIT jaarlijks plaats?',
  },
  'LSW': {
    label: 'De landelijke finale',
    text: 'De allerbeste ploegen uit heel Nederland komen samen in Baarn. Drie dagen lang laten ze zien wie de beste scouts van Nederland zijn!',
    feit: 'De LSW bestaat al sinds 1924 en begon als selectie voor de Wereldjamboree in Denemarken!',
    chips: ['Baarn', 'nationale finale', '3 dagen', 'beste scouts'],
    question: 'Hoeveel ploegen doen er mee aan de LSW?',
  },
  'World Scout Jamboree': {
    label: 'De ultieme droom',
    text: 'Eens in de vier jaar bouwen scouts uit de hele wereld samen één gigantische stad van tenten. Nieuwe vrienden maken in 150 talen tegelijk!',
    feit: 'Op de vorige Jamboree in Korea werden scouts geëvacueerd vanwege een orkaan én een hittegolf van 39°C!',
    chips: ['40.000 scouts', '150 landen', 'tentstad', 'eens per 4 jaar'],
    question: 'Hoeveel Wereld Jamborees zijn er tot nu toe geweest?',
  },
  'Gdańsk 2027': {
    label: 'Next Stop: Polen!',
    text: 'In de zomer van 2027 reizen scouts uit Nederland af naar Gdańsk in Polen. Thessa, Toto, Ryan en Hens uit onze groep gaan ook — vraag Thessa eens hoe ze zich voorbereidt!!',
    feit: 'Het kampterrein van de WSJ 2027 ligt op het eiland Sobieszewo, vlak bij de Poolse havenstad Gdańsk.',
    chips: ['Polen', 'eiland Sobieszewo', 'zomer 2027', 'Thessa gaat!'],
    question: 'Wat is het thema van de WSJ 2027?',
  },
};

// ── State ─────────────────────────────────────────────────────────────────

let _levelIdx = 0;
let _prevLevelIdx = -1;
let _cycleCnt = 0;
let _groupIdx = 0;
let _variantIdx = 0;
let _lastLevel = 0;
let _lastLevelOverrideAt = 0;
let _showMap = false;
let _skipMapCycle = false;
let _liveRoot = null;

// ── Map builder ───────────────────────────────────────────────────────────

function _stationPct(li) {
  const s = STATIONS[li];
  return {
    x: ((s.x - MAP_VIEWBOX.x) / MAP_VIEWBOX.w * 100).toFixed(1),
    y: ((s.y - MAP_VIEWBOX.y) / MAP_VIEWBOX.h * 100).toFixed(1),
  };
}

function _eventBadgesSvg(level, x, y, side) {
  const events = (level.events || []).slice(0, 3);
  const dir = side === 'left' ? -1 : 1;
  const baseX = x + (dir * 58);
  const anchor = side === 'left' ? 'end' : 'start';
  return events.map((eventName, i) => {
    const yy = y - ((events.length - 1) * 16) + (i * 32);
    return `<text class="xp-map-event-badge" x="${baseX}" y="${yy}"
      text-anchor="${anchor}">${eventName}</text>`;
  }).join('');
}

function _buildMapHTML(li, lv, prevLi) {
  const pct = _stationPct(li);
  const fullPath = [START_PATH, ...SEGMENTS.map(s => s.path), CONTINUE_PATH].join(' ');
  const isLevelChange = prevLi >= 0 && prevLi !== li;
  const isProgress = isLevelChange && li > 0;
  // Segment that animates is the one *arriving* at li.
  const animSeg = isLevelChange && li > 0 ? li - 1 : -1;

  let svg = '';

  // Career-map structure: local group, region, national, international.
  svg += `
    <g class="xp-map-career-bands">
      <path d="M 78 790 C 300 720, 442 696, 618 638 C 760 592, 862 500, 1026 462 C 1210 420, 1340 312, 1518 180"/>
      <path d="M 92 700 C 298 654, 414 620, 560 558 C 724 488, 822 404, 996 368 C 1160 334, 1280 236, 1458 120"/>
      <path d="M 160 820 C 344 758, 496 736, 664 674 C 810 620, 942 532, 1088 500 C 1274 458, 1388 354, 1526 248"/>
    </g>`;

  // Route drop shadow
  svg += `<path d="${fullPath}" fill="none" stroke="rgba(28,43,51,.18)"
    stroke-width="9" stroke-linecap="round" transform="translate(0,5)"/>`;

  // Faint full route background
  svg += `<path d="${fullPath}" fill="none" stroke="rgba(28,43,51,.22)"
    stroke-width="5" stroke-linecap="round"/>`;
  svg += `<path class="xp-route-dashed-bg" d="${fullPath}" fill="none" stroke="#C8442B"
    stroke-width="6" stroke-linecap="round" stroke-dasharray="14 16" opacity=".92"/>`;

  svg += `<path class="xp-route-start" d="${START_PATH}" fill="none" stroke="#6c9fc9"
    stroke-width="7" stroke-linecap="round"/>`;
  svg += `<path class="xp-route-continue" d="${CONTINUE_PATH}" fill="none" stroke="#C8442B"
    stroke-width="5" stroke-linecap="round" stroke-dasharray="16 18"/>`;

  svg += `<g class="xp-map-start">
    <circle cx="${START_POINT.x}" cy="${START_POINT.y}" r="16" fill="#F8F1DE" stroke="#23264e" stroke-width="4"/>
    <circle cx="${START_POINT.x}" cy="${START_POINT.y}" r="6" fill="#6c9fc9"/>
    <text x="${START_POINT.x + 24}" y="${START_POINT.y - 6}"
      font-family="Saira Condensed,system-ui" font-weight="700" font-size="17"
      fill="#1C2B33" letter-spacing=".14em">START</text>
    <text x="${START_POINT.x + 24}" y="${START_POINT.y + 15}"
      font-family="Saira Condensed,system-ui" font-weight="700" font-size="13"
      fill="#23264e" letter-spacing=".12em">RIDDER FULCO</text>
  </g>`;

  // Done segments: all segments before the animated one (or all before li for non-progress)
  const staticSegUntil = isProgress ? animSeg : li;
  for (let di = 0; di < Math.min(staticSegUntil, SEGMENTS.length); di++) {
    const segColor = di === 0 ? '#ed1c24' : LEVELS[di + 1].color;
    svg += `<path d="${SEGMENTS[di].path}" fill="none" stroke="${segColor}"
      stroke-width="7" stroke-linecap="round" opacity=".74"/>`;
  }

  // Animated segment: the one arriving at li (handles multi-step jumps correctly)
  if (animSeg >= 0 && animSeg < SEGMENTS.length) {
    const seg = SEGMENTS[animSeg];
    svg += `<path class="xp-seg-anim" d="${seg.path}" fill="none" stroke="${lv.color}"
      stroke-width="9" stroke-linecap="round" pathLength="1"
      stroke-dasharray="1" stroke-dashoffset="1"/>`;
  }

  // Inactive stations
  for (let i = 0; i < LEVELS.length; i++) {
    if (i === li) continue;
    const s = STATIONS[i];
    const slv = LEVELS[i];
    const done = i < li;  // all stations before the active one are done
    const departing = isProgress && i === prevLi;
    const r = departing ? 34 : (done ? 30 : 28);
    const fill = departing ? '#C28B22' : (done ? slv.color : '#F8F1DE');
    const cls = departing ? 'xp-map-departing' : '';

    svg += `<g class="${cls}" style="${departing ? `--depart-to:${slv.color}` : ''}">`;
    svg += `<circle class="xp-station-ring2" cx="${s.x}" cy="${s.y}" r="${r + 8}"/>`;
    svg += `<circle class="xp-station-ring" cx="${s.x}" cy="${s.y}" r="${r}"
      fill="${fill}"/>`;
    svg += `<text class="xp-station-num${departing ? ' xp-station-num-active' : ''}" x="${s.x}" y="${s.y + 1}">${i + 1}</text>`;
    svg += `<text class="xp-map-station-tag" x="${s.x}" y="${s.y + (done ? 52 : 44)}" text-anchor="middle"
      font-family="Saira Condensed,system-ui" font-weight="700" font-size="16"
      fill="#1C2B33"
      letter-spacing=".1em">${slv.tag}</text>`;
    svg += _eventBadgesSvg(slv, s.x, s.y, i === 3 ? 'left' : 'right');
    svg += `</g>`;
  }

  // Active station — animated in after route draws
  const as = STATIONS[li];
  const activeClass = isProgress ? 'xp-map-active' : 'xp-map-active xp-map-active-now';
  const activeTagClass = isProgress ? 'xp-map-active-tag' : 'xp-map-active-tag xp-map-active-tag-now';
  svg += `
    <circle class="xp-map-glow" cx="${as.x}" cy="${as.y}" r="92"
      fill="#C28B22" opacity="0"/>
    <circle class="xp-map-ring" cx="${as.x}" cy="${as.y}" r="58"
      fill="none" stroke="#1C2B33" stroke-width="3" opacity="0"/>
    <g class="${activeClass}">
      <circle cx="${as.x}" cy="${as.y}" r="34"
        fill="#C28B22" stroke="#1C2B33" stroke-width="4"/>
      <text class="xp-station-num xp-station-num-active" x="${as.x}" y="${as.y + 1}">${li + 1}</text>
    </g>
    <text class="${activeTagClass}" x="${as.x}" y="${as.y + 90}"
      text-anchor="middle" font-family="Saira Condensed,system-ui"
      font-weight="700" font-size="21" fill="#1C2B33"
      letter-spacing=".14em" opacity="0">${lv.tag}</text>
    ${_eventBadgesSvg(lv, as.x, as.y, li === 3 ? 'left' : 'right')}`;


  svg += `<g class="xp-compass" transform="translate(1468 760)">
    <circle r="58"/>
    <circle class="xp-compass-inner" r="48"/>
    <polygon points="0,-44 9,0 0,10 -9,0"/>
    <polygon class="xp-compass-south" points="0,44 9,0 0,-10 -9,0"/>
    <text x="0" y="-62" text-anchor="middle">N</text>
  </g>`;

  return `<div class="xp-map-stage${isProgress ? '' : ' xp-map-stage-static'}"
    style="--xp-color:${lv.color};--reveal-x:${pct.x}%;--reveal-y:${pct.y}%">
    <div class="xp-topbar xp-map-topbar">
      <div class="xp-header-main">
        <div class="xp-brand">
          <img class="xp-brand-logo" src="/modules/fulco-festival-2026/logos/fulco.svg"
            alt="Scouting Ridder Fulco" onerror="this.style.display='none'">
          <div class="xp-brand-titles">
            <div class="xp-brand-event">Fulco Festival 2026</div>
            <div class="xp-brand-main">Scoutingcarrière</div>
          </div>
        </div>
        <div class="xp-header-station">
          <div class="xp-header-kicker">Stap ${String(lv.step).padStart(2, '0')} &middot; ${lv.laag}</div>
          <div class="xp-header-title">${lv.naam}</div>
        </div>
      </div>
      <div class="xp-journey-bar">${_journeyBar(li)}</div>
    </div>
    <svg class="xp-map-svg" viewBox="${MAP_VIEWBOX.x} ${MAP_VIEWBOX.y} ${MAP_VIEWBOX.w} ${MAP_VIEWBOX.h}"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true">${svg}</svg>
  </div>`;
}

function _pickLevelPhotos(level, cfg, helpers, eventFocus) {
  const groupKey = (eventFocus && level.eventGroup?.[eventFocus.name])
    || level.groups[_groupIdx % level.groups.length];
  // groupMixPct:0 keeps matching groups focused; final filter prevents
  // getReadyPhotoPool's no-match fallback from mixing unrelated event photos.
  const zoneCfg = { ...cfg, groupMode: 'manual', activeGroup: groupKey, hiddenGroups: [], groupMixPct: 0 };
  const photos = helpers.pickPhotos(4, zoneCfg, [], false)
    .filter(photo => (photo?.eventGroup || 'ungrouped') === groupKey);
  return photos.slice(0, 4);
}

function _pickPhotoVariant(photoCount) {
  const count = Math.max(0, Number(photoCount) || 0);
  const variants = count <= 1
    ? ['hero-grid']
    : (count === 2
      ? ['hero-stack', 'postcard']
      : (count === 3
        ? ['triptych', 'hero-stack', 'postcard']
        : PHOTO_VARIANTS));
  const variant = variants[_variantIdx % variants.length];
  _variantIdx++;
  return variant;
}

function _eventFocus(level, idx) {
  const events = level.events || [];
  const name = events.length ? events[idx % events.length] : level.naam;
  return {
    name,
    ...(EVENT_INFO[name] || {
      label: level.laag,
      text: level.waarom,
      question: `Vraag: wat weet jij al over ${name}?`,
    }),
  };
}

function _advanceLevelCounters(manual) {
  _groupIdx++;

  if (!manual) {
    _cycleCnt++;
    if (_cycleCnt >= CYCLES_PER_LEVEL) {
      _cycleCnt = 0;
      _groupIdx = 0;
      _levelIdx = (_levelIdx + 1) % LEVELS.length;
    }
  }
}

function _appendPhotoPage(root, photos, level, levelIdx, revealFromStation, eventFocus, photoVariant = 'hero-grid') {
  const pct = _stationPct(levelIdx);
  const page = document.createElement('div');
  page.className = `xp-page${revealFromStation ? ' xp-page-reveal xp-page-from-map' : ''}`;
  page.style.setProperty('--reveal-x', `${pct.x}%`);
  page.style.setProperty('--reveal-y', `${pct.y}%`);
  page.style.setProperty('--reveal-delay', `${JOURNEY_REVEAL_DELAY_MS}ms`);
  page.style.setProperty('--xp-page-motion-delay', revealFromStation ? '0ms' : '460ms');

  const topBar = document.createElement('div');
  topBar.className = 'xp-topbar';
  topBar.innerHTML = `
    <div class="xp-header-main">
      <div class="xp-brand">
        <img class="xp-brand-logo" src="/modules/fulco-festival-2026/logos/fulco.svg"
          alt="Scouting Ridder Fulco" onerror="this.style.display='none'">
        <div class="xp-brand-titles">
          <div class="xp-brand-event">Fulco Festival 2026</div>
          <div class="xp-brand-main">Scoutingcarriere</div>
        </div>
      </div>
      <div class="xp-header-station">
        <div class="xp-header-kicker">Stap ${String(level.step).padStart(2, '0')} &middot; ${level.laag}</div>
        <div class="xp-header-title">${level.naam}</div>
      </div>
    </div>
    <div class="xp-journey-bar">${_journeyBar(levelIdx)}</div>`;
  page.appendChild(topBar);

  const waaromBar = document.createElement('div');
  waaromBar.className = 'xp-waarom-bar';
  waaromBar.innerHTML = `
    <span class="xp-waarom-label">Scoutingcarrière</span>
    <span class="xp-waarom-text">${level.waarom}</span>`;
  page.appendChild(waaromBar);

  const content = document.createElement('div');
  content.className = 'xp-station-content';

  const photoGrid = document.createElement('div');
  photoGrid.className = `xp-photo-grid xp-photo-count-${Math.max(1, photos.length)} xp-photo-variant-${photoVariant}`;
  const slots = Array.from({ length: 4 }, (_, i) => photos[i] || null);
  slots.forEach((photo, i) => {
    const slot = document.createElement('div');
    slot.className = `xp-photo-tile xp-photo-tile-${i + 1}`;
    if (photo) {
      const img = document.createElement('img');
      img.className = 'xp-photo-img';
      img.src = photoUrl(photo);
      img.alt = '';
      img.dataset.photoId = photo.id;
      slot.appendChild(img);
    } else {
      slot.classList.add('xp-photo-empty');
    }
    photoGrid.appendChild(slot);
  });
  const photoNote = document.createElement('div');
  photoNote.className = 'xp-photo-note';
  photoNote.innerHTML = `<span>in beeld</span><strong>${eventFocus.name}</strong>`;
  photoGrid.appendChild(photoNote);
  content.appendChild(photoGrid);

  const panel = document.createElement('div');
  panel.className = 'xp-info-panel';
  const chips = (eventFocus.chips || level.chips || []).map(chip => `<span>${chip}</span>`).join('');
  panel.innerHTML = `
    <div class="xp-card-header">
      <div class="xp-stamp-row">
        <div class="xp-stamp">STAP ${String(level.step).padStart(2, '0')}</div>
        <div>
          <h2 class="xp-naam">${level.naam}</h2>
          <div class="xp-laag">${level.laag}</div>
        </div>
      </div>
      <h3 class="xp-event-hero">${eventFocus.name}</h3>
      <div class="xp-event-sub">${eventFocus.label}</div>
    </div>
    <div class="xp-event-text">${eventFocus.text}</div>
    ${eventFocus.feit ? `<div class="xp-feit-block"><span class="xp-feit-label">Wist je dat?</span><span class="xp-feit-text">${eventFocus.feit}</span></div>` : ''}
    <div class="xp-chip-row">${chips}</div>
    <div class="xp-question-card">
      <div class="xp-question-label">Vraagkaartje</div>
      <div class="xp-question-text">${eventFocus.question}</div>
    </div>`;
  content.appendChild(panel);
  page.appendChild(content);
  root.appendChild(page);
  root.style.setProperty('--reveal-x', `${pct.x}%`);
  root.style.setProperty('--reveal-y', `${pct.y}%`);
}

function _photoIds(photos) {
  return photos.map(p => p?.id).filter(Boolean);
}

// ── Live update (admin click) ─────────────────────────────────────────────

export function refreshLive() {
  _showMap = true;
  _skipMapCycle = false;
  _liveRoot?.querySelector('.xp-map-overlay')?.remove();
}

// ── Journey bar (top bar) ─────────────────────────────────────────────────

function _journeyBar(activeLi) {
  return LEVELS.map((lv, i) => {
    const done = i < activeLi;
    const active = i === activeLi;
    const cls = ['xp-journey-stop', done && 'done', active && 'active'].filter(Boolean).join(' ');
    const color = active ? '#C28B22' : '#00a551';
    const style = (done || active) ? ` style="--stop-color:${color}"` : '';
    return `<div class="${cls}"${style}>
      <div class="xp-journey-node"><span class="xp-journey-num">${i + 1}</span></div>
      <div class="xp-journey-lbl">${lv.tag}</div>
    </div>${i < LEVELS.length - 1 ? '<div class="xp-journey-line"></div>' : ''}`;
  }).join('');
}

// ── Layout export ─────────────────────────────────────────────────────────

export const layout = {
  id: 'fulco-festival-2026:zone-loop',
  name: 'fulco-festival-2026:zone-loop',
  module: 'fulco-festival-2026',
  minPhotos: 1,

  pick(cfg, helpers) {
    const manual = isManual();
    const levelOverrideAt = getLevelChangedAt();
    if (!manual && levelOverrideAt !== _lastLevelOverrideAt) {
      _lastLevelOverrideAt = levelOverrideAt;
      _levelIdx = Math.min(getLevel(), LEVELS.length - 1);
      _cycleCnt = 0;
      _groupIdx = 0;
    }
    const li = manual ? Math.min(getLevel(), LEVELS.length - 1) : _levelIdx;
    const level = LEVELS[li];

    if (li !== _lastLevel) {
      _prevLevelIdx = _lastLevel;
      _lastLevel = li;
      _groupIdx = 0;
      if (!_skipMapCycle) _showMap = true;
      _skipMapCycle = false;
    }

    if (_showMap) {
      _showMap = false;
      const eventFocus = _eventFocus(level, _groupIdx);
      const photos = _pickLevelPhotos(level, cfg, helpers, eventFocus);
      const photoVariant = _pickPhotoVariant(photos.length);
      _advanceLevelCounters(manual);
      return { mode: 'journey', level, levelIdx: li, prevLevelIdx: _prevLevelIdx, photos, eventFocus, photoVariant };
    }

    const eventFocus = _eventFocus(level, _groupIdx);
    const photos = _pickLevelPhotos(level, cfg, helpers, eventFocus);
    const photoVariant = _pickPhotoVariant(photos.length);
    _advanceLevelCounters(manual);
    return { mode: 'photo', photos, level, levelIdx: li, eventFocus, photoVariant };
  },

  build({ mode, photos = [], level, levelIdx, prevLevelIdx, eventFocus, photoVariant = 'hero-grid' }) {
    const prevLi = prevLevelIdx !== undefined ? prevLevelIdx : _prevLevelIdx;
    const visibleIds = _photoIds(photos);

    // ── Journey transition: map first, station page expands inside same root.
    if (mode === 'journey') {
      const root = document.createElement('div');
      root.className = 'layout layout-fulco-festival-2026 xp-journey-mode';
      root.dataset.level = levelIdx;
      root.innerHTML = _buildMapHTML(levelIdx, level, prevLi);
      _appendPhotoPage(root, photos, level, levelIdx, true, eventFocus || _eventFocus(level, 0), photoVariant);
      _liveRoot = root;
      return {
        el: root,
        visibleIds,
        duration: (JOURNEY_REVEAL_DELAY_MS + PAGE_REVEAL_MS + (8000)),
        transition: 'fulco-festival-2026-journey',
        transitionMs: RETURN_TO_MAP_MS,
        startMotion: () => { },
      };
    }

    // ── Photo mode ──────────────────────────────────────────────────────
    const root = document.createElement('div');
    root.className = 'layout layout-fulco-festival-2026 xp-photo-mode';
    root.dataset.level = levelIdx;
    root.innerHTML = _buildMapHTML(levelIdx, level, prevLi);
    _appendPhotoPage(root, photos, level, levelIdx, false, eventFocus || _eventFocus(level, 0), photoVariant);
    _liveRoot = root;
    return { el: root, visibleIds, startMotion: () => { } };
  },
};
