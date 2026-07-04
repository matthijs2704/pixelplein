// Game mirror — spectator view of the reboot-ritual minigames on the big screens.
//
// Connects DIRECTLY to the HypeReset Arduino's WebSocket (it broadcasts phase/
// charge/surge/gate/packet/simon events to every client, not just the reboot
// console) and mirrors the games in the same visual language as the console,
// so the whole group can follow along.
//
// Lifecycle: hidden in idle/online; shows from the moment the key turns
// (phase 'armed') through the startup checks; hides again at 'booting' — the
// hype-restart alert takeover owns the screens from there.
//
// z-index: hype takeover alerts (.hype-alert, incl. the offline takeover)
// render at 9600 — the mirror sits at 9700 so it covers them, and below the
// glitch layer at 9800. At 'booting' it holds as a black cover for ~1s and
// fades out over the restart takeover's own black/static intro, so there is
// no gap between the last game screen and the reboot animation.
//
// Fully self-contained: own styles, own reconnect loop. If the Arduino is
// unreachable the overlay simply never shows.

const ARDUINO_WS = 'ws://192.168.3.139/ws'; // same rig the reboot console talks to

const PHASE_TITLES = {
  armed: 'NOODSTROOM INGESCHAKELD',
  recharge: '⚡ LAAD DE SERVER OP',
  sync: '⚡ STROMEN VERBONDEN!',
  fans: 'CHECK 1: VENTILATOREN',
  handshake: 'CHECK 2: NETWERK',
  simon: 'CHECK 3: BOOT-CODE',
  ignite: 'START DE SERVER',
};

// how-to-play steps, shown to the crowd while the gate is open (same as console)
const PHASE_STEPS = {
  fans: ['TIK <b class="cy">GEEL</b>', 'TIK <b class="cr">ROOD</b>', 'OM &amp; OM,<br>METER VOL!'],
  handshake: ['HET <b class="cb">LICHT</b> STUITERT<br>HEEN EN WEER', '<b class="cy">GEEL</b> VANGT LINKS<br><b class="cr">ROOD</b> VANGT RECHTS', 'DRUK ALS HET LICHT<br>IN JOUW VAK KOMT — <b class="cb">4× RAAK!</b>'],
  simon: ['KIJK NAAR<br>DE KLEUREN', 'ONTHOUD<br>DE VOLGORDE', 'DRUK HEM NA:<br><b class="cy">GEEL</b> &amp; <b class="cr">ROOD</b>'],
};

const CHECK_ORDER = ['fans', 'handshake', 'simon'];

const CSS = `
#hype-gm { position: fixed; inset: 0; z-index: 9700; display: none; overflow: hidden; opacity: 1; transition: opacity 0.35s ease;
  background: #07080c; color: #fff; font-family: var(--hype-font, 'DM Sans', sans-serif);
  flex-direction: column; align-items: center; justify-content: center; gap: 2.6vh; text-align: center; }
#hype-gm.show { display: flex; }
#hype-gm.shake { animation: gm-shake 0.4s cubic-bezier(.36,.07,.19,.97); }
#hype-gm.handoff { background: #000; }
#hype-gm.handoff > * { visibility: hidden; }
#hype-gm.fadeout { opacity: 0; }
@keyframes gm-shake { 10%,90%{transform:translateX(-3px)} 30%,70%{transform:translateX(6px)} 50%{transform:translateX(-9px)} }

/* ── background stack, same language as the console ── */
#hype-gm .gm-bg { position: absolute; inset: 0; pointer-events: none; }
#hype-gm .gm-glow { background: radial-gradient(ellipse 90% 55% at 50% 18%, rgba(255,120,0,0.16), transparent 60%); }
#hype-gm .gm-grid { inset: -20%;
  background: linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 72px 72px,
              linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 72px 72px;
  transform: perspective(900px) rotateX(56deg) translateY(20%); opacity: 0.26; }
#hype-gm .gm-vignette { background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.85) 100%); }
#hype-gm .gm-paint { position: absolute; left: 0; right: 0; height: 6vh; }
#hype-gm .gm-paint.py { top: 12vh; background: #f5d904; clip-path: polygon(0 14%, 100% 0%, 100% 86%, 0% 100%);
  transform: rotate(-2deg); opacity: 0.85; animation: gm-drift-y 7s ease-in-out infinite; }
#hype-gm .gm-paint.pr { bottom: 10vh; background: #f52368; clip-path: polygon(0 0%, 100% 14%, 100% 100%, 0% 86%);
  transform: rotate(2deg); opacity: 0.8; animation: gm-drift-r 8.5s ease-in-out 0.8s infinite; }
@keyframes gm-drift-y { 0%,100% { transform: rotate(-2deg) translateX(0); } 50% { transform: rotate(-2.6deg) translateX(-2%); } }
@keyframes gm-drift-r { 0%,100% { transform: rotate(2deg) translateX(0); }  50% { transform: rotate(2.6deg) translateX(2%); } }
#hype-gm .gm-whiteflash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
#hype-gm .gm-whiteflash.pop { animation: gm-fpop 0.45s ease-out forwards; }
@keyframes gm-fpop { 0%{opacity:0.55} 100%{opacity:0} }

/* ── checklist chips ── */
#hype-gm .gm-checklist { position: relative; display: flex; gap: 1.2vw; }
#hype-gm .gm-ck { display: inline-flex; align-items: center; gap: 10px; padding: 10px 22px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04);
  font-family: 'Courier New', monospace; font-size: clamp(14px,1.4vw,22px); letter-spacing: 1px; color: rgba(255,255,255,0.4); }
#hype-gm .gm-ck i { width: 11px; height: 11px; border-radius: 50%; background: rgba(255,255,255,0.15); }
#hype-gm .gm-ck.done { color: #32d74b; border-color: rgba(50,215,75,0.45); }
#hype-gm .gm-ck.done i { background: #32d74b; box-shadow: 0 0 10px #32d74b; }
#hype-gm .gm-ck.active { color: #fff; border-color: #f5d904; animation: gm-pulse 0.9s ease infinite; }
#hype-gm .gm-ck.active i { background: #f5d904; box-shadow: 0 0 10px #f5d904; }
@keyframes gm-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
@keyframes gm-slam { 0%{opacity:0;transform:scale(1.35) translateY(-8px)} 65%{transform:scale(0.97)} 100%{opacity:1;transform:none} }

/* ── header ── */
#hype-gm .gm-kicker { position: relative; font-weight: 900; letter-spacing: 5px; font-size: clamp(14px,1.4vw,22px); color: #f5d904; }
#hype-gm .gm-kicker::before { content: '●'; color: #ff3b30; margin-right: 10px; animation: gm-blink 1.4s ease infinite; }
@keyframes gm-blink { 0%,100%{opacity:1} 50%{opacity:0.15} }
#hype-gm .gm-title { position: relative; font-family: var(--hype-display, 'Bebas Neue', sans-serif);
  font-size: clamp(48px,7vw,120px); letter-spacing: 4px; line-height: 0.95; animation: gm-slam 0.5s cubic-bezier(.2,1.25,.2,1); }

/* ── game card, brand edge like the console ── */
#hype-gm .gm-card { position: relative; overflow: hidden; width: min(1500px, 92vw);
  display: flex; flex-direction: column; align-items: center; gap: 2.4vh;
  background: linear-gradient(180deg, rgba(20,24,33,0.96), rgba(11,13,18,0.96));
  border: 1px solid rgba(255,255,255,0.12); border-radius: 18px;
  padding: clamp(24px,4vh,52px) clamp(24px,3vw,64px);
  box-shadow: 0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06); }
#hype-gm .gm-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 7px;
  background: linear-gradient(100deg, #f5d904 0%, #f52368 100%); }
#hype-gm .gm-sub { font-size: clamp(20px,2.4vw,38px); font-weight: 700; color: rgba(255,255,255,0.85); letter-spacing: 1px; }
#hype-gm .cy { color: #f5d904; } #hype-gm .cr { color: #f52368; } #hype-gm .cb { color: #00b2ff; }

/* how-to-play step cards during the gate */
#hype-gm .gm-steps { display: flex; gap: 1.4vw; width: 100%; justify-content: center; }
#hype-gm .gm-step { flex: 1; max-width: 420px; display: flex; flex-direction: column; align-items: center; gap: 12px;
  background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px;
  padding: clamp(18px,3vh,30px) clamp(12px,1.5vw,24px); }
#hype-gm .gm-step .n { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
  font-family: var(--hype-display, 'Bebas Neue', sans-serif); font-size: 26px; color: #0b0d12;
  background: linear-gradient(120deg, #f5d904, #f52368); }
#hype-gm .gm-step .t { font-family: var(--hype-display, 'Bebas Neue', sans-serif);
  font-size: clamp(24px,2.6vw,44px); line-height: 1.05; letter-spacing: 1px; color: rgba(255,255,255,0.92); }

/* countdown digit */
#hype-gm .gm-count { font-family: var(--hype-display, 'Bebas Neue', sans-serif);
  font-size: clamp(140px,22vw,320px); line-height: 1; color: #f5d904; text-shadow: 0 0 90px rgba(245,217,4,0.6); }
#hype-gm .gm-count.pop { animation: gm-slam 0.35s cubic-bezier(.2,1.25,.2,1); }

/* recharge bars */
#hype-gm .gm-bars { display: flex; align-items: center; gap: 2vw; width: 100%; justify-content: center; }
#hype-gm .gm-track { position: relative; flex: 1; max-width: 560px; height: 52px; border-radius: 999px;
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12); overflow: hidden; }
#hype-gm .gm-fill { position: absolute; top: 0; bottom: 0; width: 0%; transition: width 0.12s linear; }
#hype-gm .gm-fill.y { left: 0; background: linear-gradient(90deg, rgba(245,217,4,0.4), #f5d904); box-shadow: 0 0 24px rgba(245,217,4,0.7); }
#hype-gm .gm-fill.r { right: 0; background: linear-gradient(270deg, rgba(245,35,104,0.4), #f52368); box-shadow: 0 0 24px rgba(245,35,104,0.7); }
#hype-gm .gm-pct { font-family: var(--hype-display, 'Bebas Neue', sans-serif); font-size: clamp(48px,6vw,110px); color: #00b2ff; min-width: 3ch; }

/* fans */
#hype-gm .gm-fanrow { display: flex; align-items: center; gap: 2vw; width: 100%; justify-content: center; }
#hype-gm .gm-rotor { font-size: clamp(60px,7vw,120px); display: inline-block; animation: gm-spin 1.4s linear infinite; }
@keyframes gm-spin { to { transform: rotate(360deg); } }
#hype-gm .gm-fantrack { position: relative; flex: 1; max-width: 900px; height: 52px; border-radius: 999px;
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12); overflow: hidden; }
#hype-gm .gm-fanfill { height: 100%; width: 0%; border-radius: 999px; transition: width 0.12s linear;
  background: linear-gradient(90deg, #f5d904, #ff8a00, #f52368); box-shadow: 0 0 26px rgba(255,140,0,0.8); }

/* handshake */
#hype-gm .gm-turn { font-family: var(--hype-display, 'Bebas Neue', sans-serif); font-size: clamp(44px,6vw,100px); letter-spacing: 4px; }
#hype-gm .gm-turn.y { color: #f5d904; text-shadow: 0 0 50px rgba(245,217,4,0.6); }
#hype-gm .gm-turn.r { color: #f52368; text-shadow: 0 0 50px rgba(245,35,104,0.6); }
#hype-gm .gm-packettrack { position: relative; width: 100%; max-width: 1300px; height: 56px; border-radius: 999px;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); overflow: hidden; }
#hype-gm .gm-zone { position: absolute; top: 0; bottom: 0; width: 19%; opacity: 0.25; transition: opacity 0.25s ease; }
#hype-gm .gm-zone.y { left: 0; background: linear-gradient(90deg, #f5d904, transparent); }
#hype-gm .gm-zone.r { right: 0; background: linear-gradient(270deg, #f52368, transparent); }
#hype-gm .gm-packettrack.turn-y .gm-zone.y, #hype-gm .gm-packettrack.turn-r .gm-zone.r { opacity: 0.95; animation: gm-pulse 0.8s ease infinite; }
#hype-gm .gm-dot { position: absolute; top: 50%; left: 0; width: 36px; height: 36px; margin: -18px 0 0 -18px;
  border-radius: 50%; background: #fff; box-shadow: 0 0 30px #00b2ff, 0 0 60px #00b2ff; transition: left 0.05s linear; }
#hype-gm .gm-lamps { display: flex; gap: 1.6vw; }
#hype-gm .gm-lamp { width: clamp(36px,3.4vw,64px); height: clamp(36px,3.4vw,64px); border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05); transition: all 0.2s ease; }
#hype-gm .gm-lamp.lit { background: #27d6c6; border-color: #27d6c6; box-shadow: 0 0 34px rgba(39,214,198,0.9); animation: gm-slam 0.4s cubic-bezier(.2,1.25,.2,1); }

/* simon */
#hype-gm .gm-flash { width: clamp(160px,18vw,300px); height: clamp(160px,18vw,300px); border-radius: 26px;
  background: rgba(255,255,255,0.06); border: 2px solid rgba(255,255,255,0.14);
  transition: background 0.08s ease, box-shadow 0.08s ease; }
#hype-gm .gm-flash.y { background: #f5d904; box-shadow: 0 0 140px rgba(245,217,4,0.95); }
#hype-gm .gm-flash.r { background: #f52368; box-shadow: 0 0 140px rgba(245,35,104,0.95); }
#hype-gm .gm-dots { display: flex; gap: 1.4vw; }
#hype-gm .gm-sdot { width: clamp(28px,2.8vw,52px); height: clamp(28px,2.8vw,52px); border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05); transition: all 0.15s ease; }
#hype-gm .gm-sdot.ok { background: #32d74b; border-color: #32d74b; box-shadow: 0 0 28px rgba(50,215,75,0.9); }

/* prompts */
#hype-gm .gm-prompt { position: relative; font-family: var(--hype-display, 'Bebas Neue', sans-serif);
  font-size: clamp(44px,6.5vw,110px); letter-spacing: 4px; color: #fff; background: #f52368;
  padding: 8px 54px; border-radius: 16px; box-shadow: 0 0 90px rgba(245,35,104,0.9); display: none; }
#hype-gm.surging .gm-prompt { display: block; animation: gm-pulse 0.3s ease infinite; }
#hype-gm .gm-pass { position: relative; font-family: var(--hype-display, 'Bebas Neue', sans-serif);
  font-size: clamp(60px,9vw,150px); letter-spacing: 4px; color: #fff; background: #32d74b;
  padding: 12px 70px; border-radius: 20px; box-shadow: 0 0 120px rgba(50,215,75,0.95); display: none; }
#hype-gm.passing .gm-pass { display: block; animation: gm-slam 0.45s cubic-bezier(.2,1.25,.2,1); }
#hype-gm.passing .gm-card, #hype-gm.passing .gm-prompt { display: none; }
`;

let root = null;
let phase = 'idle';

function _el(cls, html) {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  return d;
}

function _build() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  root = _el('', '');
  root.id = 'hype-gm';
  root.innerHTML = `
    <div class="gm-bg gm-glow"></div>
    <div class="gm-bg gm-grid"></div>
    <div class="gm-bg gm-vignette"></div>
    <div class="gm-paint py"></div>
    <div class="gm-paint pr"></div>
    <div class="gm-whiteflash"></div>

    <div class="gm-checklist">
      <div class="gm-ck done" data-ck="power"><i></i>STROOM</div>
      <div class="gm-ck" data-ck="fans"><i></i>VENTILATOREN</div>
      <div class="gm-ck" data-ck="handshake"><i></i>NETWERK</div>
      <div class="gm-ck" data-ck="simon"><i></i>BOOT-CODE</div>
    </div>
    <div class="gm-kicker">LIVE VANAF DE HERSTART-CONSOLE</div>
    <div class="gm-title"></div>

    <div class="gm-card">
      <div class="gm-sub"></div>
      <div class="gm-steps" style="display:none"></div>
      <div class="gm-count"></div>
      <div class="gm-bars" style="display:none">
        <div class="gm-track"><div class="gm-fill y"></div></div>
        <div class="gm-pct">0%</div>
        <div class="gm-track"><div class="gm-fill r"></div></div>
      </div>
      <div class="gm-fanrow" style="display:none">
        <span class="gm-rotor">✻</span>
        <div class="gm-fantrack"><div class="gm-fanfill"></div></div>
        <div class="gm-pct gm-fanpct">0%</div>
      </div>
      <div class="gm-turn" style="display:none"></div>
      <div class="gm-packettrack" style="display:none">
        <div class="gm-zone y"></div><div class="gm-zone r"></div><div class="gm-dot"></div>
      </div>
      <div class="gm-lamps" style="display:none">
        <div class="gm-lamp"></div><div class="gm-lamp"></div><div class="gm-lamp"></div><div class="gm-lamp"></div>
      </div>
      <div class="gm-flash" style="display:none"></div>
      <div class="gm-dots" style="display:none"></div>
    </div>

    <div class="gm-prompt">⚡ LOSLATEN!</div>
    <div class="gm-pass">✓ CHECK GESLAAGD!</div>
  `;
  document.body.appendChild(root);
}

const $ = sel => root.querySelector(sel);

function _whiteFlash() {
  const f = $('.gm-whiteflash');
  f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop');
}

const FLEX_WIDGETS = ['gm-steps', 'gm-bars', 'gm-fanrow', 'gm-lamps', 'gm-dots'];
function _widgets(list) {
  ['gm-steps', 'gm-bars', 'gm-fanrow', 'gm-turn', 'gm-packettrack', 'gm-lamps', 'gm-flash', 'gm-dots']
    .forEach(w => {
      $('.' + w).style.display = list.includes(w) ? (FLEX_WIDGETS.includes(w) ? 'flex' : 'block') : 'none';
    });
}

function _checklist(p) {
  const idx = CHECK_ORDER.indexOf(p);
  root.querySelectorAll('.gm-ck').forEach(el => {
    const ck = el.dataset.ck;
    if (ck === 'power') return;
    const ckIdx = CHECK_ORDER.indexOf(ck);
    el.classList.toggle('done', ckIdx > -1 && idx > -1 && ckIdx < idx);
    el.classList.toggle('active', ck === p);
  });
}

function _showFor(p) {
  phase = p;
  // booting: hold a black cover while the restart takeover starts underneath,
  // then fade — bridges the gap between the last game and the boot animation
  if (p === 'booting' && root.classList.contains('show')) {
    root.classList.remove('surging', 'passing');
    root.classList.add('handoff');
    setTimeout(() => root.classList.add('fadeout'), 900);
    setTimeout(() => root.classList.remove('show', 'handoff', 'fadeout'), 1300);
    return;
  }
  const active = !!PHASE_TITLES[p];
  root.classList.toggle('show', active);
  root.classList.remove('surging', 'passing', 'handoff', 'fadeout');
  if (!active) return;
  $('.gm-title').textContent = PHASE_TITLES[p];
  $('.gm-count').textContent = '';
  _checklist(p);
  _whiteFlash();

  if (p === 'recharge') {
    _widgets(['gm-bars']);
    $('.gm-sub').innerHTML = 'Houd <b class="cy">GEEL</b> en <b class="cr">ROOD</b> ingedrukt — laat de stromen elkaar raken!';
  } else if (CHECK_ORDER.includes(p)) {
    // gate first: crowd reads the how-to-play steps until the game starts
    _widgets(['gm-steps']);
    $('.gm-steps').innerHTML = (PHASE_STEPS[p] || [])
      .map((t, i) => `<div class="gm-step"><span class="n">${i + 1}</span><span class="t">${t}</span></div>`).join('');
    $('.gm-sub').textContent = 'Maak je klaar…';
  } else {
    _widgets([]);
    $('.gm-sub').textContent = p === 'armed' ? 'De sleutel is omgedraaid — daar gaan we!' : '';
  }
}

function _gameWidgets() { // gate finished — swap in the actual game view
  if (phase === 'fans') {
    _widgets(['gm-fanrow']);
    $('.gm-sub').innerHTML = 'Tik om de beurt: <b class="cy">GEEL</b> — <b class="cr">ROOD</b> — <b class="cy">GEEL</b> — <b class="cr">ROOD</b>!';
  } else if (phase === 'handshake') {
    _widgets(['gm-turn', 'gm-packettrack', 'gm-lamps']);
    $('.gm-sub').textContent = 'Vang het lichtpakketje in je eigen vak!';
  } else if (phase === 'simon') {
    _widgets(['gm-flash', 'gm-dots']);
    $('.gm-sub').textContent = 'Kijk goed naar de kleuren…';
  }
}

function _onMsg(d) {
  if (d.event === 'phase') { _showFor(d.phase); return; }
  if (!root.classList.contains('show')) return;
  switch (d.event) {
    case 'charge': {
      $('.gm-fill.y').style.width = (d.a | 0) + '%';
      $('.gm-fill.r').style.width = (d.b | 0) + '%';
      $('.gm-pct').textContent = Math.round(((d.a | 0) + (d.b | 0)) / 2) + '%';
      break;
    }
    case 'surge': {
      root.classList.add('surging');
      $('.gm-prompt').textContent = '⚡ LOSLATEN!';
      root.classList.add('shake');
      setTimeout(() => root.classList.remove('shake'), 450);
      break;
    }
    case 'overload': $('.gm-prompt').textContent = '🔥 OVERBELAST! LAAT LOS!'; break;
    case 'surge_end': root.classList.remove('surging'); break;
    case 'gate': {
      const c = $('.gm-count');
      if (d.state === 'count') {
        _widgets([]);
        c.textContent = d.n;
        c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
        $('.gm-sub').textContent = '';
      } else if (d.state === 'run') {
        c.textContent = '';
        _whiteFlash();
        _gameWidgets();
      } else {
        c.textContent = '';
        $('.gm-sub').textContent = d.state === 'key' ? 'De sleutel gaat om…' : 'Handen op de knoppen…';
      }
      break;
    }
    case 'fans': {
      $('.gm-fanfill').style.width = (d.rpm | 0) + '%';
      $('.gm-fanpct').textContent = (d.rpm | 0) + '%';
      $('.gm-rotor').style.animationDuration = (2.5 - (d.rpm | 0) * 0.0225) + 's';
      break;
    }
    case 'packet': $('.gm-dot').style.left = Math.max(0, Math.min(100, d.p | 0)) + '%'; break;
    case 'handshake': {
      root.querySelectorAll('.gm-lamp').forEach((el, i) => el.classList.toggle('lit', i < (d.catches | 0)));
      $('.gm-packettrack').className = 'gm-packettrack turn-' + d.turn;
      const t = $('.gm-turn');
      t.className = 'gm-turn ' + d.turn;
      t.textContent = (d.turn === 'y' ? 'GEEL' : 'ROOD') + ', VANG!';
      $('.gm-dot').style.left = (d.turn === 'y' ? 100 : 0) + '%'; // bounce/drop anchor
      break;
    }
    case 'simon_flash': $('.gm-flash').className = 'gm-flash' + (d.c === 'Y' ? ' y' : d.c === 'R' ? ' r' : ''); break;
    case 'simon': {
      const dots = $('.gm-dots');
      if (dots.children.length !== d.len) {
        dots.innerHTML = '';
        for (let i = 0; i < d.len; i++) dots.appendChild(_el('gm-sdot'));
      }
      [...dots.children].forEach((el, i) => el.classList.toggle('ok', i < d.pos));
      $('.gm-sub').textContent = d.show ? 'Kijk goed naar de kleuren…' : 'Druk de code na!';
      break;
    }
    case 'check_passed': root.classList.add('passing'); _whiteFlash(); break;
  }
}

function _connect() {
  let ws;
  try { ws = new WebSocket(ARDUINO_WS); } catch { setTimeout(_connect, 5000); return; }
  ws.onmessage = e => { try { _onMsg(JSON.parse(e.data)); } catch { } };
  ws.onclose = () => { root.classList.remove('show'); setTimeout(_connect, 5000); };
  ws.onerror = () => { };
}

export function initGameMirror() {
  if (root) return;
  _build();
  _connect();
}
