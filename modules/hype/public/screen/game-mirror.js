// Game mirror — spectator view of the reboot-ritual minigames on the big screens.
//
// Connects DIRECTLY to the HypeReset Arduino's WebSocket (it broadcasts phase/
// charge/surge/gate/packet/simon events to every client, not just the reboot
// console) and mirrors the games so the whole group can follow along.
//
// Lifecycle: hidden in idle/online; shows from the moment the key turns
// (phase 'armed') through the startup checks; hides again at 'booting' — the
// hype-restart alert takeover owns the screens from there.
//
// z-index sits ABOVE the alert layer (9500): during the ritual the screens are
// showing the persistent hype-offline takeover (an alert), and the mirror must
// cover it. It hides itself at 'booting', handing back to the alert layer.
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

const CSS = `
#hype-gm { position: fixed; inset: 0; z-index: 9600; display: none;
  background: rgba(7,8,12,0.94); color: #fff; font-family: var(--hype-font, 'DM Sans', sans-serif);
  flex-direction: column; align-items: center; justify-content: center; gap: 3vh; text-align: center; }
#hype-gm.show { display: flex; }
#hype-gm .gm-kicker { font-weight: 900; letter-spacing: 4px; font-size: clamp(14px,1.4vw,22px); color: #f5d904; }
#hype-gm .gm-title { font-family: var(--hype-display, 'Bebas Neue', sans-serif);
  font-size: clamp(48px,7vw,120px); letter-spacing: 4px; line-height: 0.95; }
#hype-gm .gm-stage { display: flex; flex-direction: column; align-items: center; gap: 2.4vh; width: min(1400px, 90vw); }

#hype-gm .gm-bars { display: flex; align-items: center; gap: 2vw; width: 100%; justify-content: center; }
#hype-gm .gm-track { position: relative; flex: 1; max-width: 480px; height: 42px; border-radius: 999px;
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12); overflow: hidden; }
#hype-gm .gm-fill { position: absolute; top: 0; bottom: 0; width: 0%; transition: width 0.12s linear; }
#hype-gm .gm-fill.y { left: 0; background: linear-gradient(90deg, rgba(245,217,4,0.4), #f5d904); }
#hype-gm .gm-fill.r { right: 0; background: linear-gradient(270deg, rgba(245,35,104,0.4), #f52368); }
#hype-gm .gm-pct { font-family: var(--hype-display, 'Bebas Neue', sans-serif); font-size: clamp(40px,5vw,84px); color: #00b2ff; min-width: 3ch; }
#hype-gm .gm-prompt { font-family: var(--hype-display, 'Bebas Neue', sans-serif); font-size: clamp(36px,5.5vw,92px);
  letter-spacing: 4px; color: #fff; background: #f52368; padding: 6px 44px; border-radius: 14px;
  box-shadow: 0 0 70px rgba(245,35,104,0.9); display: none; }
#hype-gm.surging .gm-prompt { display: block; animation: gm-pulse 0.3s ease infinite; }
@keyframes gm-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }

#hype-gm .gm-count { font-family: var(--hype-display, 'Bebas Neue', sans-serif);
  font-size: clamp(120px,20vw,280px); line-height: 1; color: #f5d904; text-shadow: 0 0 80px rgba(245,217,4,0.6); }
#hype-gm .gm-sub { font-size: clamp(18px,2vw,30px); font-weight: 700; color: rgba(255,255,255,0.75); letter-spacing: 1px; }

#hype-gm .gm-packettrack { position: relative; width: min(1200px,86vw); height: 48px; border-radius: 999px;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); overflow: hidden; }
#hype-gm .gm-zone { position: absolute; top: 0; bottom: 0; width: 19%; opacity: 0.25; transition: opacity 0.25s ease; }
#hype-gm .gm-zone.y { left: 0; background: linear-gradient(90deg, #f5d904, transparent); }
#hype-gm .gm-zone.r { right: 0; background: linear-gradient(270deg, #f52368, transparent); }
#hype-gm .gm-packettrack.turn-y .gm-zone.y, #hype-gm .gm-packettrack.turn-r .gm-zone.r { opacity: 0.95; animation: gm-pulse 0.8s ease infinite; }
#hype-gm .gm-dot { position: absolute; top: 50%; left: 0; width: 30px; height: 30px; margin: -15px 0 0 -15px;
  border-radius: 50%; background: #fff; box-shadow: 0 0 26px #00b2ff, 0 0 50px #00b2ff; transition: left 0.05s linear; }
#hype-gm .gm-lamps { display: flex; gap: 1.6vw; }
#hype-gm .gm-lamp { width: clamp(30px,3vw,54px); height: clamp(30px,3vw,54px); border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05); }
#hype-gm .gm-lamp.lit { background: #27d6c6; border-color: #27d6c6; box-shadow: 0 0 30px rgba(39,214,198,0.9); }

#hype-gm .gm-flash { width: clamp(140px,16vw,260px); height: clamp(140px,16vw,260px); border-radius: 22px;
  background: rgba(255,255,255,0.06); border: 2px solid rgba(255,255,255,0.14); transition: background 0.08s ease, box-shadow 0.08s ease; }
#hype-gm .gm-flash.y { background: #f5d904; box-shadow: 0 0 110px rgba(245,217,4,0.95); }
#hype-gm .gm-flash.r { background: #f52368; box-shadow: 0 0 110px rgba(245,35,104,0.95); }
#hype-gm .gm-dots { display: flex; gap: 1.4vw; }
#hype-gm .gm-sdot { width: clamp(24px,2.4vw,42px); height: clamp(24px,2.4vw,42px); border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.05); }
#hype-gm .gm-sdot.ok { background: #32d74b; border-color: #32d74b; box-shadow: 0 0 24px rgba(50,215,75,0.9); }
#hype-gm .gm-pass { font-family: var(--hype-display, 'Bebas Neue', sans-serif); font-size: clamp(50px,8vw,130px);
  letter-spacing: 4px; color: #fff; background: #32d74b; padding: 10px 60px; border-radius: 18px;
  box-shadow: 0 0 100px rgba(50,215,75,0.95); display: none; }
#hype-gm.passing .gm-pass { display: block; animation: gm-pulse 0.4s ease 2; }
#hype-gm.passing .gm-stage { display: none; }
`;

let root = null;

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
    <div class="gm-kicker">LIVE VANAF DE HERSTART-CONSOLE</div>
    <div class="gm-title"></div>
    <div class="gm-stage">
      <div class="gm-count"></div>
      <div class="gm-sub"></div>
      <div class="gm-bars" style="display:none">
        <div class="gm-track"><div class="gm-fill y"></div></div>
        <div class="gm-pct">0%</div>
        <div class="gm-track"><div class="gm-fill r"></div></div>
      </div>
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

function _showFor(p) {
  const active = !!PHASE_TITLES[p];
  root.classList.toggle('show', active);
  root.classList.remove('surging', 'passing');
  if (!active) return;
  $('.gm-title').textContent = PHASE_TITLES[p];
  // per-phase widgets
  $('.gm-bars').style.display = p === 'recharge' ? 'flex' : 'none';
  $('.gm-packettrack').style.display = p === 'handshake' ? 'block' : 'none';
  $('.gm-lamps').style.display = p === 'handshake' ? 'flex' : 'none';
  $('.gm-flash').style.display = p === 'simon' ? 'block' : 'none';
  $('.gm-dots').style.display = p === 'simon' ? 'flex' : 'none';
  $('.gm-count').textContent = '';
  $('.gm-sub').textContent = p === 'recharge' ? 'Houd geel en rood ingedrukt — laat de stromen elkaar raken!' : '';
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
    case 'surge': root.classList.add('surging'); $('.gm-prompt').textContent = '⚡ LOSLATEN!'; break;
    case 'overload': root.classList.add('surging'); $('.gm-prompt').textContent = '🔥 OVERBELAST! LAAT LOS!'; break;
    case 'surge_end': root.classList.remove('surging'); break;
    case 'gate': {
      if (d.state === 'count') { $('.gm-count').textContent = d.n; $('.gm-sub').textContent = ''; }
      else if (d.state === 'run') { $('.gm-count').textContent = ''; }
      else { $('.gm-count').textContent = ''; $('.gm-sub').textContent = d.state === 'key' ? 'De sleutel gaat om…' : 'Klaar voor de start…'; }
      break;
    }
    case 'fans': $('.gm-count').textContent = (d.rpm | 0) + '%'; $('.gm-sub').textContent = 'Tik om de beurt: geel — rood — geel — rood!'; break;
    case 'packet': {
      $('.gm-dot').style.left = Math.max(0, Math.min(100, d.p | 0)) + '%';
      break;
    }
    case 'handshake': {
      root.querySelectorAll('.gm-lamp').forEach((el, i) => el.classList.toggle('lit', i < (d.catches | 0)));
      $('.gm-packettrack').className = 'gm-packettrack turn-' + d.turn;
      $('.gm-sub').textContent = (d.turn === 'y' ? 'GEEL' : 'ROOD') + ' moet hem vangen!';
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
    case 'check_passed': root.classList.add('passing'); break;
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
