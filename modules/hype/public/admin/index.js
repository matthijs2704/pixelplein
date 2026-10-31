// Hype admin tab. Dynamically imported by /admin/modules-loader.js.
// Single tab, six sections in operator-priority order:
//   1. Showtime         — current phase + lifecycle buttons + plot triggers
//   2. Platform account — Kamp Live identity + manual activity item
//   3. Stream           — fullscreen broadcast settings
//   4. Channels         — per-channel card (meta + featured days + followers + comments)
//   5. Photo tagging    — assign photos to influencers
//   6. Live monitor     — read-only engine activity feed

import { registerAdminTab, registerAdminWsHandler, registerSlideFormExtension } from '/admin/module-registry.js';

const API = '/api/modules/hype';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let _ctx = null;

function _loadStyle() {
  if (document.getElementById('hype-admin-style')) return;
  const link = document.createElement('link');
  link.id = 'hype-admin-style';
  link.rel = 'stylesheet';
  link.href = '/modules/hype/admin/style.css';
  document.head.appendChild(link);
}

async function _fetchJson(url, opts) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function _toast(msg, err = false) {
  if (typeof window.showToast === 'function') return window.showToast(msg, err);
  const t = document.getElementById('toast');
  if (!t) { console.log('[hype]', msg); return; }
  t.textContent = msg;
  t.className = 'toast' + (err ? ' toast-err' : ' toast-ok');
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 2500);
}

/* ─── Section 1: Showtime ─────────────────────────────────────────────────
 * Three layers: status row (phase/day/pulse/heat), the "draaiboek" — the
 * story-week steps in chronological order with a live highlight on whatever
 * is on the screens now (settings.nachtspelStage) — and a collapsed
 * manual/emergency block.
 */

const PLOT_TRIGGERS = [
  { id: 'hype-glitch',  cls: 'glitch',  label: 'Glitch',
    desc: 'Korte storing op het scherm. Level 1 = subtiel, level 3 = stevig.', defaultDur: 6, level: true },
];

function _phaseLabel(settings) {
  if (settings.nachtspelStage === 'trace')  return { text: 'TRACE', cls: 'off' };
  if (settings.platformOff)                 return { text: 'OFFLINE', cls: 'off' };
  if (settings.nachtspelStage === 'armed')  return { text: 'ONTHULLING KLAAR', cls: 'launching' };
  if (settings.nachtspelStage === 'reveal') return { text: 'ONTHULLING', cls: 'launching' };
  if (settings.preLaunch)    return { text: 'PRE-LAUNCH', cls: 'idle' };
  if (settings.launchActive) return { text: 'LAUNCHING', cls: 'launching' };
  return { text: 'LIVE', cls: 'live' };
}

const HARRY_HEAT_LABELS = ['Rustig', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Gevaarlijk'];

function _renderShowtime() {
  const settings = _ctx.snapshot.settings || {};
  const phase = _phaseLabel(settings);
  const heat  = Math.max(0, Math.min(5, Number(settings.harryHeat) || 0));
  const day   = Number(settings.spotlightDay) || 1;
  const stage = settings.nachtspelStage || null;
  const trace = settings.traceTarget || {};
  return `
    <section class="hype-admin-section showtime">
      <div class="showtime-head">
        <h2>Showtime</h2>
        <span class="phase-pill phase-${phase.cls}">${phase.text}</span>
        <label class="showtime-day-label">Dag
          <input type="number" min="1" max="7" value="${day}" data-showtime-day />
        </label>
        <button class="hype-admin-btn secondary" data-morning-check>Follower pulse</button>
      </div>

      <!-- Harry heat: auto-saves on change -->
      <div class="harry-heat-row">
        <div class="harry-heat-info">
          <span class="harry-heat-name">Harry heat</span>
          <span class="harry-heat-val" id="harry-heat-val">${HARRY_HEAT_LABELS[heat]}</span>
        </div>
        <input type="range" min="0" max="5" step="1" value="${heat}"
               data-harry-heat id="harry-heat-slider" />
        <div class="harry-heat-ticks">
          ${HARRY_HEAT_LABELS.map((_, i) => `<span>${i}</span>`).join('')}
        </div>
        <p class="hype-pool-help">Hoe vaak Harry automatisch glitcht. 0 = stil, 5 = continu.</p>
      </div>

      <!-- Physical button (M5 Atom): arm the next press with one action -->
      <div class="trigger-arm-row">
        <span class="trigger-arm-name">Fysieke knop</span>
        <select data-physical-trigger>
          <option value="" ${!settings.physicalTrigger ? 'selected' : ''}>— uit —</option>
          <option value="launch"  ${settings.physicalTrigger === 'launch' ? 'selected' : ''}>Launch platform</option>
          <option value="reveal"  ${settings.physicalTrigger === 'reveal' ? 'selected' : ''}>Start onthulling</option>
          <option value="trace"   ${settings.physicalTrigger === 'trace' ? 'selected' : ''}>Traceer Harry</option>
          <option value="trace-end" ${settings.physicalTrigger === 'trace-end' ? 'selected' : ''}>Trace klaar → offline</option>
          <option value="restart" ${settings.physicalTrigger === 'restart' ? 'selected' : ''}>Restart</option>
        </select>
        <span class="trigger-arm-state ${settings.physicalTrigger ? 'armed' : ''}">
          ${settings.physicalTrigger ? '● scherp — één druk vuurt' : '○ uit'}
        </span>
        <p class="hype-pool-help">Volgt het draaiboek vanzelf: pre-launch aan → knop = Launch · onthulling klaargezet → knop = Start onthulling → daarna Trace → terug naar offline. Handmatig aanpassen kan altijd; één druk = één actie.</p>
      </div>

      <!-- Draaiboek: the whole story week in chronological order -->
      <h3>Draaiboek</h3>
      <ol class="draaiboek">
        <li class="db-step ${settings.preLaunch ? 'db-active' : ''}">
          <div class="db-num">1</div>
          <div class="db-body">
            <div class="db-info">
              <strong>Pre-launch teaser</strong>
              <span>"binnenkort live" wachtscherm — vóór de launch en voor repetities</span>
            </div>
            <div class="db-actions">
              <button class="hype-admin-btn neutral" data-reset-prelaunch>Zet pre-launch aan</button>
            </div>
          </div>
        </li>

        <li class="db-step ${!settings.preLaunch && !settings.platformOff ? 'db-done' : ''}">
          <div class="db-num">2</div>
          <div class="db-body">
            <div class="db-info">
              <strong>Launch platform</strong>
              <span>dag 1 — eerste keer live, cinematische intro</span>
            </div>
            <div class="db-actions">
              <button class="hype-admin-btn launch" data-launch-platform>Launch</button>
            </div>
          </div>
        </li>

        <li class="db-step ${stage === 'armed' ? 'db-active' : ''}">
          <div class="db-num">3</div>
          <div class="db-body">
            <div class="db-info">
              <strong>Zet onthulling klaar</strong>
              <span>vast wachtscherm "De grote onthulling" — iedereen verzamelt, glitches stoppen</span>
            </div>
            <div class="db-actions">
              <button class="hype-admin-btn" data-reveal-arm>Klaarzetten</button>
            </div>
          </div>
        </li>

        <li class="db-step ${stage === 'reveal' ? 'db-active' : ''}">
          <div class="db-num">4</div>
          <div class="db-body">
            <div class="db-info">
              <strong>Start onthulling</strong>
              <span>aftellen → "winnaar berekenen" loopt vast → glitch → platform crasht vanzelf (shutdown-animatie)</span>
            </div>
            <div class="db-fields">
              <label>Aftellen
                <input type="number" min="3" max="60" value="10" data-reveal-countdown /> sec
              </label>
            </div>
            <div class="db-actions">
              <button class="hype-admin-btn danger" data-start-reveal>Start onthulling</button>
            </div>
          </div>
        </li>

        <li class="db-step ${stage === 'trace' ? 'db-active' : ''}">
          <div class="db-num">5</div>
          <div class="db-body">
            <div class="db-info">
              <strong>Traceer Harry (Mark)</strong>
              <span>trace → radar → kaart-zoom naar de locatie · blijft staan tot "Klaar"</span>
            </div>
            <div class="db-fields">
              <label>Locatie
                <input type="text" placeholder="Parkeerplaats …"
                       value="${esc(trace.location || '')}" data-trace-location />
              </label>
              <label>Coördinaten
                <input type="text" placeholder="52.0836, 5.3717"
                       value="${trace.lat != null && trace.lon != null ? `${trace.lat}, ${trace.lon}` : ''}"
                       data-trace-coords />
              </label>
            </div>
            <div class="db-actions">
              <button class="hype-admin-btn secondary" data-trace-prefetch>Locatie klaarzetten (kaart cachen)</button>
              <button class="hype-admin-btn danger" data-start-trace>Toon locatie op schermen</button>
              <button class="hype-admin-btn" data-end-trace>Klaar → terug naar offline</button>
            </div>
            <img class="trace-preview" data-trace-preview alt="" style="display:none" />
          </div>
        </li>

        <li class="db-step ${stage === 'offline' ? 'db-active' : ''}">
          <div class="db-num">6</div>
          <div class="db-body">
            <div class="db-info">
              <strong>Reboot</strong>
              <span>gebeurt fysiek via de Arduino-console — knop hieronder is de fallback</span>
            </div>
            <div class="db-actions">
              <button class="hype-admin-btn restart" data-restart-platform>Restart (handmatig)</button>
            </div>
          </div>
        </li>
      </ol>

      <!-- Manual / emergency controls, collapsed out of the way -->
      <details class="hype-nood">
        <summary>Handmatig / nood</summary>
        <div class="nood-row">
          <button class="hype-admin-btn danger" data-power-off>Platform offline</button>
          <button class="hype-admin-btn danger" data-power-off-instant>Offline (direct, geen animatie)</button>
          <button class="hype-admin-btn danger" data-reset-camp>🏕 Kampstart-reset (alles naar 0)</button>
        </div>
        <h4>Scherm sluiten</h4>
        <div class="dismiss-row">
          <button class="hype-admin-btn secondary" data-dismiss-alert="hype-prelaunch-active">Pre-launch</button>
          <button class="hype-admin-btn secondary" data-dismiss-alert="hype-launch-active">Launch</button>
          <button class="hype-admin-btn secondary" data-dismiss-alert="hype-reveal-active">Onthulling</button>
          <button class="hype-admin-btn secondary" data-dismiss-alert="hype-trace-active">Trace</button>
          <button class="hype-admin-btn secondary" data-dismiss-alert="hype-restart-active">Restart</button>
          <button class="hype-admin-btn secondary" data-dismiss-dashboard>Dashboard</button>
        </div>
        <h4>Plot triggers</h4>
        <div class="hype-triggers">
          ${PLOT_TRIGGERS.map(t => `
            <div class="hype-trigger-card ${t.cls}">
              <h4>${t.label}</h4>
              <p class="hype-trigger-desc">${esc(t.desc)}</p>
              <label>Duur (sec)
                <input type="number" min="2" max="600" value="${t.defaultDur}"
                       data-trigger-dur="${t.id}" />
              </label>
              <label>Tekst (optioneel)
                <input type="text" placeholder="Eigen boodschap…"
                       data-trigger-msg="${t.id}" />
              </label>
              ${t.level ? `
                <label>Level
                  <select data-trigger-level="${t.id}">
                    <option value="1">1 subtiel</option>
                    <option value="2">2 duidelijk</option>
                    <option value="3">3 zwaar</option>
                  </select>
                </label>
              ` : ''}
              <button class="hype-admin-btn big" data-trigger="${t.id}">Fire</button>
            </div>
          `).join('')}
        </div>
      </details>
    </section>
  `;
}

function _bindShowtime(root) {
  // Harry heat — live label update + auto-save on change
  const heatSlider = root.querySelector('[data-harry-heat]');
  const heatVal    = root.querySelector('#harry-heat-val');
  if (heatSlider) {
    heatSlider.addEventListener('input', () => {
      if (heatVal) heatVal.textContent = HARRY_HEAT_LABELS[heatSlider.value] || heatSlider.value;
    });
    heatSlider.addEventListener('change', async () => {
      try {
        const saved = await _fetchJson(`${API}/settings`, {
          method: 'PATCH', body: JSON.stringify({ harryHeat: Number(heatSlider.value) }),
        });
        _ctx.snapshot.settings = saved;
        _toast(`Harry heat: ${HARRY_HEAT_LABELS[heatSlider.value]}`);
      } catch (err) { _toast(`Save failed: ${err.message}`, true); }
    });
  }

  // Spotlight day — auto-save on change
  const dayEl = root.querySelector('[data-showtime-day]');
  if (dayEl) {
    dayEl.addEventListener('change', async () => {
      try {
        const saved = await _fetchJson(`${API}/settings`, {
          method: 'PATCH', body: JSON.stringify({ spotlightDay: Number(dayEl.value) || 1 }),
        });
        _ctx.snapshot.settings = saved;
        _toast(`Dag ${dayEl.value} ingesteld`);
      } catch (err) { _toast(`Save failed: ${err.message}`, true); }
    });
  }

  // Physical button arming — auto-save on change
  root.querySelector('[data-physical-trigger]')?.addEventListener('change', async (e) => {
    const value = e.target.value || null;
    try {
      const saved = await _fetchJson(`${API}/settings`, {
        method: 'PATCH', body: JSON.stringify({ physicalTrigger: value }),
      });
      _ctx.snapshot.settings = saved;
      _toast(value ? `Knop scherp: ${e.target.selectedOptions[0].textContent}` : 'Knop uit');
      _refreshShowtime();
    } catch (err) { _toast(`Save failed: ${err.message}`, true); }
  });

  root.querySelector('[data-morning-check]')?.addEventListener('click', async () => {
    try {
      await _fetchJson(`${API}/morning-check`, { method: 'POST', body: JSON.stringify({}) });
      _toast('Follower pulse sent');
    } catch (err) { _toast(`Failed: ${err.message}`, true); }
  });

  /* ── Draaiboek: nachtspel steps ── */

  // Parse "52.0836, 5.3717" (Google/OSM copy-paste) into { lat, lon }.
  const parseCoords = () => {
    const raw = String(root.querySelector('[data-trace-coords]')?.value || '');
    const m = raw.match(/(-?\d+(?:\.\d+)?)[ ,;]+(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = Number(m[1]), lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  };
  const traceBody = () => ({
    location: root.querySelector('[data-trace-location]')?.value?.trim() || '',
    ...(parseCoords() || {}),
  });

  root.querySelector('[data-reveal-arm]')?.addEventListener('click', async () => {
    if (!confirm('Onthulling-wachtscherm op alle schermen zetten? Auto-glitches stoppen.')) return;
    try {
      const saved = await _fetchJson(`${API}/reveal-arm`, { method: 'POST', body: JSON.stringify({}) });
      _ctx.snapshot.settings = saved || _ctx.snapshot.settings;
      _toast('Onthulling staat klaar');
      _refreshShowtime();
    } catch (err) { _toast(`Klaarzetten failed: ${err.message}`, true); }
  });

  root.querySelector('[data-start-reveal]')?.addEventListener('click', async () => {
    const countdownSec = Math.max(3, Number(root.querySelector('[data-reveal-countdown]')?.value) || 10);
    const total = countdownSec + 4;
    if (!confirm(`Start de onthulling? Aftellen (${countdownSec}s) → glitch → shutdown-animatie start na ~${total}s (vanzelf).`)) return;
    try {
      const saved = await _fetchJson(`${API}/reveal`, {
        method: 'POST', body: JSON.stringify({ countdownSec }),
      });
      _ctx.snapshot.settings = saved || _ctx.snapshot.settings;
      _toast(`Onthulling gestart — crash over ~${total}s`);
      _refreshShowtime();
    } catch (err) { _toast(`Onthulling failed: ${err.message}`, true); }
  });

  root.querySelector('[data-trace-prefetch]')?.addEventListener('click', async () => {
    const coords = parseCoords();
    if (!coords) return _toast('Vul geldige coördinaten in (bijv. "52.0836, 5.3717")', true);
    const btn = root.querySelector('[data-trace-prefetch]');
    if (btn) { btn.disabled = true; btn.textContent = 'Kaart cachen…'; }
    try {
      const res = await _fetchJson(`${API}/trace-prefetch`, {
        method: 'POST', body: JSON.stringify(traceBody()),
      });
      _ctx.snapshot.settings = res.settings || _ctx.snapshot.settings;
      const img = root.querySelector('[data-trace-preview]');
      if (img && res.previewTile) { img.src = res.previewTile; img.style.display = 'block'; }
      _toast(`Kaart gecachet (${res.ok} tiles${res.failed ? `, ${res.failed} mislukt` : ''}) — check de preview`);
    } catch (err) {
      _toast(`Cachen failed: ${err.message}`, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Locatie klaarzetten (kaart cachen)'; }
    }
  });

  root.querySelector('[data-start-trace]')?.addEventListener('click', async () => {
    const body = traceBody();
    if (!body.location) return _toast('Vul een locatienaam in', true);
    if (!confirm(`Locatie van de hacker op alle schermen tonen? (${body.location})`)) return;
    try {
      const saved = await _fetchJson(`${API}/trace`, { method: 'POST', body: JSON.stringify(body) });
      _ctx.snapshot.settings = saved || _ctx.snapshot.settings;
      _toast('Trace draait op de schermen');
      _refreshShowtime();
    } catch (err) { _toast(`Trace failed: ${err.message}`, true); }
  });

  root.querySelector('[data-end-trace]')?.addEventListener('click', async () => {
    try {
      const saved = await _fetchJson(`${API}/trace-end`, { method: 'POST', body: JSON.stringify({}) });
      _ctx.snapshot.settings = saved || _ctx.snapshot.settings;
      _toast('Terug naar offline-scherm');
      _refreshShowtime();
    } catch (err) { _toast(`Failed: ${err.message}`, true); }
  });

  root.querySelector('[data-launch-platform]')?.addEventListener('click', async () => {
    if (!confirm('Launch the platform now? Plays the full cinematic.')) return;
    try {
      const launched = await _fetchJson(`${API}/launch`, { method: 'POST', body: JSON.stringify({}) });
      _ctx.snapshot.settings = launched.settings || _ctx.snapshot.settings;
      _ctx.snapshot.activity = launched.activity || [];
      _toast('Launch fired');
      _refreshShowtime();
    } catch (err) { _toast(`Launch failed: ${err.message}`, true); }
  });

  root.querySelector('[data-reset-prelaunch]')?.addEventListener('click', async () => {
    if (!confirm('Reset platform to pre-launch idle? Kids will see the "binnenkort live" teaser again.')) return;
    try {
      const saved = await _fetchJson(`${API}/reset-prelaunch`, { method: 'POST', body: JSON.stringify({}) });
      _ctx.snapshot.settings = saved || _ctx.snapshot.settings;
      _toast('Pre-launch teaser armed');
      _refreshShowtime();
    } catch (err) { _toast(`Reset failed: ${err.message}`, true); }
  });

  root.querySelector('[data-reset-camp]')?.addEventListener('click', async () => {
    if (!confirm('KAMPSTART-RESET: alle volgers naar 0, history en activity gewist, dag 1, heat 0, pre-launch aan. Doorgaan?')) return;
    if (!confirm('Zeker weten? Dit wist de hele follower-race van de week.')) return;
    try {
      const saved = await _fetchJson(`${API}/reset-camp`, { method: 'POST', body: JSON.stringify({}) });
      _ctx.snapshot.settings = saved || _ctx.snapshot.settings;
      _ctx.snapshot.followers = {};
      _ctx.snapshot.activity = [];
      _toast('Alles klaargezet voor kampstart 🏕');
      _refreshShowtime();
    } catch (err) { _toast(`Reset failed: ${err.message}`, true); }
  });

  root.querySelector('[data-power-off]')?.addEventListener('click', async () => {
    if (!confirm('Platform offline zetten? Blijft uit tot Restart.')) return;
    try {
      const saved = await _fetchJson(`${API}/power-off`, { method: 'POST', body: JSON.stringify({}) });
      _ctx.snapshot.settings = saved || _ctx.snapshot.settings;
      _toast('Platform offline');
      _refreshShowtime();
    } catch (err) { _toast(`Power-off failed: ${err.message}`, true); }
  });

  root.querySelector('[data-power-off-instant]')?.addEventListener('click', async () => {
    if (!confirm('Platform DIRECT offline zetten (zonder shutdown-animatie)?')) return;
    try {
      const saved = await _fetchJson(`${API}/power-off`, { method: 'POST', body: JSON.stringify({ instant: true }) });
      _ctx.snapshot.settings = saved || _ctx.snapshot.settings;
      _toast('Platform direct offline');
      _refreshShowtime();
    } catch (err) { _toast(`Power-off failed: ${err.message}`, true); }
  });

  root.querySelector('[data-restart-platform]')?.addEventListener('click', async () => {
    if (!confirm('Restart spelen? CRT reboot + confetti finale.')) return;
    try {
      const saved = await _fetchJson(`${API}/restart`, { method: 'POST', body: JSON.stringify({}) });
      _ctx.snapshot.settings = saved?.settings || saved || _ctx.snapshot.settings;
      _toast('Restart fired');
      _refreshShowtime();
    } catch (err) { _toast(`Restart failed: ${err.message}`, true); }
  });

  for (const btn of root.querySelectorAll('[data-dismiss-alert]')) {
    btn.addEventListener('click', async () => {
      const alertId = btn.dataset.dismissAlert;
      try {
        await _fetchJson(`/api/alerts/${encodeURIComponent(alertId)}/dismiss`, { method: 'POST' });
        _toast('Scherm gesloten');
      } catch (err) { _toast(`Dismiss failed: ${err.message}`, true); }
    });
  }

  root.querySelector('[data-dismiss-dashboard]')?.addEventListener('click', async () => {
    try {
      const saved = await _fetchJson(`${API}/settings`, { method: 'PATCH', body: JSON.stringify({ mode: 'normal' }) });
      _ctx.snapshot.settings = saved || _ctx.snapshot.settings;
      _toast('Dashboard gesloten');
      _refreshShowtime();
    } catch (err) { _toast(`Dismiss failed: ${err.message}`, true); }
  });

  for (const btn of root.querySelectorAll('[data-trigger]')) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.trigger;
      const t = PLOT_TRIGGERS.find(x => x.id === id);
      const durEl   = root.querySelector(`[data-trigger-dur="${id}"]`);
      const msgEl   = root.querySelector(`[data-trigger-msg="${id}"]`);
      const levelEl = root.querySelector(`[data-trigger-level="${id}"]`);
      const seconds = Math.max(2, Number(durEl?.value) || t.defaultDur);
      const message = msgEl?.value?.trim() || null;
      const payload = { message, seconds };
      if (levelEl) payload.level = Number(levelEl.value) || 1;
      try {
        await _fetchJson('/api/alerts', {
          method: 'POST',
          body: JSON.stringify({
            type: id, payload, durationSec: seconds,
            message: message || t.label, style: 'popup', active: true,
          }),
        });
        _toast(`${t.label} fired (${seconds}s)`);
      } catch (err) { _toast(`Fire failed: ${err.message}`, true); }
    });
  }
}

function _refreshShowtime() {
  const section = _ctx.root.querySelector('.hype-admin-section.showtime');
  if (!section) return;
  section.outerHTML = _renderShowtime();
  _bindShowtime(_ctx.root);
}

function _refreshPlatform() {
  const section = _ctx.root.querySelector('.hype-admin-section.platform-account');
  if (!section) return;
  section.outerHTML = _renderPlatformSection();
  _bindPlatform(_ctx.root);
}

/* ─── Section 2: Platform account ─────────────────────────────────────── */

function _renderPlatformSection() {
  const settings = _ctx.snapshot.settings || {};
  const account = settings.generalAccount || {};
  return `
    <details class="hype-admin-section platform-account">
      <summary><h2>Platform account</h2></summary>
      <div class="hype-settings-grid">
        <label>Mode
          <select data-hype-setting="mode">
            <option value="normal"${settings.mode !== 'dashboard' && settings.mode !== 'social-only' ? ' selected' : ''}>Photo feed</option>
            <option value="dashboard"${settings.mode === 'dashboard' || settings.mode === 'social-only' ? ' selected' : ''}>Summon dashboard</option>
          </select>
        </label>
        <label>General account name
          <input data-hype-account="name" value="${esc(account.name || 'Kamp Live')}" />
        </label>
        <label>General account handle
          <input data-hype-account="handle" value="${esc(account.handle || '@kamp_live')}" />
        </label>
        <label>General avatar URL
          <input data-hype-account="avatarUrl" value="${esc(account.avatarUrl || '')}" />
        </label>
        <div class="hype-account-avatar-upload">
          ${account.avatarUrl ? `<img src="${esc(account.avatarUrl)}" alt="" class="cc-avatar-preview" />` : ''}
          <input type="file" accept="image/*" data-platform-avatar-file hidden />
          <button class="hype-admin-btn secondary" data-platform-avatar-upload type="button">Upload avatar</button>
        </div>
        <label>General color
          <input type="color" data-hype-account="color" value="${esc(account.color || '#2bc1ff')}" />
        </label>
      </div>
      <button class="hype-admin-btn" data-save-platform>Save platform account</button>

      <h3 style="margin-top:18px;">Manual activity</h3>
      <p class="hype-pool-help">Push een eigen juice/chat item naar het dashboard.</p>
      <div class="hype-activity-compose">
        <select data-activity-kind>
          <option value="juice">Juice</option>
          <option value="chat">Chat</option>
          <option value="platform">Platform</option>
        </select>
        <input data-activity-text placeholder="Bericht…" />
        <button class="hype-admin-btn" data-send-activity>Send</button>
      </div>
    </details>
  `;
}

function _platformFormBody(root) {
  const body = { generalAccount: {} };
  const modeEl = root.querySelector('[data-hype-setting="mode"]');
  if (modeEl) body.mode = modeEl.value;
  for (const el of root.querySelectorAll('[data-hype-account]')) {
    body.generalAccount[el.dataset.hypeAccount] = el.value;
  }
  return body;
}

function _bindPlatform(root) {
  const fileInput = root.querySelector('[data-platform-avatar-file]');
  root.querySelector('[data-platform-avatar-upload]')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch('/api/slides/upload-article-image', { method: 'POST', body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      const { filename } = await res.json();
      const avatarUrl = `/slide-assets/images/${filename}`;
      const avatarEl = root.querySelector('[data-hype-account="avatarUrl"]');
      if (avatarEl) avatarEl.value = avatarUrl;
      const saved = await _fetchJson(`${API}/settings`, {
        method: 'PATCH', body: JSON.stringify(_platformFormBody(root)),
      });
      _ctx.snapshot.settings = saved;
      _toast('Platform avatar saved');
      _refreshPlatform();
    } catch (err) {
      _toast(`Avatar upload failed: ${err.message}`, true);
    } finally {
      fileInput.value = '';
    }
  });

  root.querySelector('[data-save-platform]')?.addEventListener('click', async () => {
    try {
      const saved = await _fetchJson(`${API}/settings`, {
        method: 'PATCH', body: JSON.stringify(_platformFormBody(root)),
      });
      _ctx.snapshot.settings = saved;
      _toast('Platform account saved');
    } catch (err) { _toast(`Save failed: ${err.message}`, true); }
  });

  root.querySelector('[data-send-activity]')?.addEventListener('click', async () => {
    const textEl = root.querySelector('[data-activity-text]');
    const kindEl = root.querySelector('[data-activity-kind]');
    const text = textEl?.value?.trim();
    if (!text) return;
    try {
      await _fetchJson(`${API}/activity`, {
        method: 'POST', body: JSON.stringify({ kind: kindEl?.value || 'juice', text }),
      });
      textEl.value = '';
      _toast('Activity sent');
    } catch (err) { _toast(`Send failed: ${err.message}`, true); }
  });
}

/* ─── Section 3: Stream ───────────────────────────────────────────────── */

function _renderStreamSection() {
  const videos = (_ctx.slides || []).filter(s => (s.type === 'video' || s.type === 'pool-video') && s.filename);
  const savedVideos = _ctx.snapshot.videos || [];
  const settings = _ctx.snapshot.settings || {};
  const stream = settings.stream || {};
  const active = savedVideos.find(v => v.id === stream.videoId)
    || savedVideos.find(v => v.active && v.placement === 'stream')
    || null;
  return `
    <details class="hype-admin-section">
      <summary><h2>Fullscreen stream</h2></summary>
      <p class="hype-pool-help">Zet dit aan als het scherm een live-uitzending moet imiteren.</p>
      <div class="hype-stream-grid">
        <label class="hype-check-row">
          <input type="checkbox" data-stream-enabled ${stream.enabled ? 'checked' : ''} />
          Stream live fullscreen
        </label>
        <label>Source
          <select data-stream-source>
            <option value="video"${!['url', 'camera', 'network-camera'].includes(stream.sourceType) ? ' selected' : ''}>Uploaded video</option>
            <option value="url"${stream.sourceType === 'url' ? ' selected' : ''}>Stream URL</option>
            <option value="camera"${stream.sourceType === 'camera' ? ' selected' : ''}>Attached camera</option>
            <option value="network-camera"${stream.sourceType === 'network-camera' ? ' selected' : ''}>Network camera (NUC)</option>
          </select>
        </label>
        <label>Title
          <input data-stream-title value="${esc(stream.title || 'Keuken Live')}" />
        </label>
        <label>Subtitle
          <input data-stream-subtitle value="${esc(stream.subtitle || 'live vanaf het kamp')}" />
        </label>
        <label>Screen
          <select data-stream-screen>
            <option value=""${!stream.screenId ? ' selected' : ''}>Alle schermen</option>
            ${Array.from({ length: _ctx.screenCount || 2 }, (_, i) => String(i + 1))
              .map(id => `<option value="${id}"${stream.screenId === id ? ' selected' : ''}>Scherm ${id}</option>`).join('')}
          </select>
        </label>
        <select data-video-slide>
          <option value="">No stream video</option>
          ${videos.map(v => `<option value="${esc(v.id)}"${active?.slide_id === v.id ? ' selected' : ''} data-filename="${esc(v.filename)}">${esc(v.label || v.filename)}</option>`).join('')}
        </select>
        <input data-stream-url placeholder="https://.../stream.m3u8, .mp4, or http://nuc-ip:3987/camera/stream" value="${esc(stream.url || '')}" />
        <input data-stream-device placeholder="camera device id, optional" value="${esc(stream.deviceId || '')}" />
        <label>Chat-sidecar server
          <input data-stream-chaturl placeholder="http://127.0.0.1:8787" value="${esc(stream.chatUrl || 'http://127.0.0.1:8787')}" />
        </label>
        <button class="hype-admin-btn" data-save-stream>Save stream</button>
      </div>
    </details>
  `;
}

function _bindStream(root) {
  root.querySelector('[data-save-stream]')?.addEventListener('click', async () => {
    const sel = root.querySelector('[data-video-slide]');
    const opt = sel?.selectedOptions?.[0];
    const slideId = sel?.value || '';
    const filename = opt?.dataset?.filename || '';
    const enabled = root.querySelector('[data-stream-enabled]')?.checked || false;
    let savedVideo = null;
    try {
      if (slideId && filename) {
        savedVideo = await _fetchJson(`${API}/videos`, {
          method: 'PUT',
          body: JSON.stringify({ slideId, filename, label: opt.textContent, placement: 'stream', active: true }),
        });
      }
      const settings = await _fetchJson(`${API}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          stream: {
            enabled,
            videoId: savedVideo?.id || _ctx.snapshot.settings?.stream?.videoId || null,
            sourceType: root.querySelector('[data-stream-source]')?.value || 'video',
            url: root.querySelector('[data-stream-url]')?.value || '',
            deviceId: root.querySelector('[data-stream-device]')?.value || '',
            title: root.querySelector('[data-stream-title]')?.value || 'Keuken Live',
            subtitle: root.querySelector('[data-stream-subtitle]')?.value || '',
            screenId: root.querySelector('[data-stream-screen]')?.value || '',
            chatUrl: root.querySelector('[data-stream-chaturl]')?.value?.trim() || 'http://127.0.0.1:8787',
          },
        }),
      });
      _ctx.snapshot.settings = settings;
      _toast('Stream settings saved');
    } catch (err) { _toast(`Stream save failed: ${err.message}`, true); }
  });
}

/* ─── Section 3b: Stream-chat regie (fake-chat sidecar) ─────────────────── */

const _regie = { tail: [], timer: null, photo: null };

function _renderRegieSection() {
  return `
    <section class="hype-admin-section" data-regie>
      <h2>Stream-chat regie</h2>
      <p class="hype-pool-help">
        Bestuurt de fake-chat sidecar (los proces). Start = tokens; Stop of
        30 min zonder update = engine automatisch uit.
      </p>
      <div class="hype-regie-status" data-regie-status>sidecar: …</div>
      <div class="hype-regie-grid">
        <input data-regie-opening placeholder="Opening — wat is er op beeld? (bv. Jochem gaat pannenkoeken bakken)" />
        <textarea data-regie-context rows="2" placeholder="Extra context voor vanavond (optioneel — gaat mee in de system prompt)"></textarea>
        <div class="hype-regie-btnrow">
          <button class="hype-admin-btn" data-regie-start>▶ Start chat</button>
          <button class="hype-admin-btn" data-regie-stop>■ Stop</button>
          <button class="hype-admin-btn secondary" data-regie-reset title="Wist de chat op alle schermen (sidecar blijft draaien)">↺ Reset chat</button>
        </div>
        <div class="hype-regie-leader">
          <button class="hype-admin-btn secondary" data-regie-mic title="Inspreken (Nederlands)">🎤</button>
          <input data-regie-leader placeholder="Leader-update… (ook: @user: bericht · chat: regie · leermoment · '250 kijkers')" />
          <button class="hype-admin-btn" data-regie-send>Stuur</button>
        </div>
        <div class="hype-regie-btnrow">
          <button class="hype-admin-btn" data-regie-quick="leermoment">Leermoment</button>
          <button class="hype-admin-btn" data-regie-quick="het gaat hard, we gaan viral! 500 kijkers">Viral · 500 kijkers</button>
          <button class="hype-admin-btn" data-regie-quick="de stream loopt op zijn einde, de streamer gaat zo afronden en zwaaien">Afronden</button>
        </div>
        <div class="hype-regie-btnrow hype-regie-photo-row">
          <label class="hype-admin-btn secondary" style="cursor:pointer">
            📷 Foto kiezen<input type="file" accept="image/*" capture="environment" data-regie-photo hidden />
          </label>
          <button class="hype-admin-btn secondary" data-regie-snapshot>📸 Snapshot van stream</button>
          <img data-regie-photo-preview hidden style="height:44px;border-radius:6px" alt="" />
          <button class="hype-admin-btn" data-regie-send-photo disabled>Stuur foto als update</button>
        </div>
        <p class="hype-pool-help">Foto = momentopname van wat er nu op beeld is; de chat gaat op zichtbare
        details reageren. Tekst in het update-veld gaat mee als toelichting. (~$0.002 per foto)</p>
        <div class="hype-regie-tail" data-regie-tail></div>
      </div>
    </section>
  `;
}

function _renderRegieTail() {
  const box = document.querySelector('[data-regie-tail]');
  if (!box) return;
  box.innerHTML = _regie.tail.slice(-14).map(m => m.type === 'join'
    ? `<div class="hype-regie-row join">👋 ${esc(m.username)} kijkt nu mee</div>`
    : `<div class="hype-regie-row"><b style="color:${esc(m.color || '#ccc')}">${esc(m.username)}</b> ${esc(m.text)}</div>`
  ).join('');
  box.scrollTop = box.scrollHeight;
}

function _bindRegie(root) {
  const api = (path, opts) => _fetchJson(`${API}/stream-chat/${path}`, opts);
  const statusBox = () => root.querySelector('[data-regie-status]');

  async function refreshStatus() {
    const box = statusBox();
    if (!box) { clearInterval(_regie.timer); _regie.timer = null; return; }
    try {
      const s = await api('status');
      if (!s.running) {
        box.className = 'hype-regie-status idle';
        box.textContent = `sidecar bereikbaar — engine uit${s.reason ? ` (${s.reason})` : ''}`;
      } else {
        box.className = 'hype-regie-status live';
        box.innerHTML = `LIVE — ${s.viewers | 0} kijkers · ${esc(s.phase)}/${esc(s.mood)} · `
          + `$${s.costUsd} (${s.calls} calls) · auto-stop over ${Math.max(1, Math.round((s.deadmanInSec | 0) / 60))}m`
          + `<br><span class="hype-regie-scene">${esc(s.title || '')}${s.scene ? ` — ${esc(s.scene)}` : ''}</span>`;
      }
    } catch (err) {
      box.className = 'hype-regie-status off';
      box.textContent = `sidecar niet bereikbaar (${err.message})`;
    }
  }

  async function sendLeader(text, image = null) {
    if (!text && !image) return;
    try {
      await api('leader', { method: 'POST', body: JSON.stringify({ text: text || '', image: image || '' }) });
      _toast(image ? 'Foto-update verstuurd' : 'Update verstuurd');
      refreshStatus();
    } catch (err) { _toast(`Versturen mislukt: ${err.message}`, true); }
  }

  root.querySelector('[data-regie-start]')?.addEventListener('click', async () => {
    const opening = root.querySelector('[data-regie-opening]')?.value?.trim();
    if (!opening) return _toast('Vul een opening in (wat is er op beeld?)', true);
    try {
      await api('start', {
        method: 'POST',
        body: JSON.stringify({ opening, context: root.querySelector('[data-regie-context]')?.value || '' }),
      });
      _toast('Chat gestart');
      refreshStatus();
    } catch (err) { _toast(`Start mislukt: ${err.message}`, true); }
  });

  root.querySelector('[data-regie-stop]')?.addEventListener('click', async () => {
    try { await api('stop', { method: 'POST', body: '{}' }); _toast('Chat gestopt'); refreshStatus(); }
    catch (err) { _toast(`Stop mislukt: ${err.message}`, true); }
  });

  root.querySelector('[data-regie-reset]')?.addEventListener('click', async () => {
    try {
      await api('reset', { method: 'POST', body: '{}' });
      _regie.tail = [];
      _renderRegieTail();
      _toast('Chat gereset');
    } catch (err) { _toast(`Reset mislukt: ${err.message}`, true); }
  });

  const leaderInput = root.querySelector('[data-regie-leader]');
  const fireLeader = () => { sendLeader(leaderInput?.value?.trim()); if (leaderInput) leaderInput.value = ''; };
  root.querySelector('[data-regie-send]')?.addEventListener('click', fireLeader);
  leaderInput?.addEventListener('keydown', e => { if (e.key === 'Enter') fireLeader(); });

  for (const btn of root.querySelectorAll('[data-regie-quick]')) {
    btn.addEventListener('click', () => sendLeader(btn.dataset.regieQuick));
  }

  /* Foto: client-side verkleinen naar max 1024px JPEG en meesturen. */
  const photoInput = root.querySelector('[data-regie-photo]');
  const photoPreview = root.querySelector('[data-regie-photo-preview]');
  const photoSend = root.querySelector('[data-regie-send-photo]');
  const photoSnapshot = root.querySelector('[data-regie-snapshot]');

  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    try {
      _regie.photo = await _resizeToDataUrl(file, 1024);
      photoPreview.src = _regie.photo;
      photoPreview.hidden = false;
      photoSend.disabled = false;
    } catch (err) { _toast(`Foto lezen mislukt: ${err.message}`, true); }
  });

  photoSnapshot?.addEventListener('click', async () => {
    const streamUrl = _ctx.snapshot.settings?.stream?.url || '';
    if (_ctx.snapshot.settings?.stream?.sourceType !== 'network-camera' || !streamUrl.includes('/camera/stream')) {
      return _toast('Zet Source op "Network camera (NUC)" om een snapshot te pakken', true);
    }
    try {
      const res = await fetch(streamUrl.replace('/camera/stream', '/camera/snapshot'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _regie.photo = await _resizeToDataUrl(await res.blob(), 1024);
      photoPreview.src = _regie.photo;
      photoPreview.hidden = false;
      photoSend.disabled = false;
    } catch (err) { _toast(`Snapshot mislukt: ${err.message}`, true); }
  });

  photoSend?.addEventListener('click', async () => {
    if (!_regie.photo) return;
    await sendLeader(leaderInput?.value?.trim() || '', _regie.photo);
    _regie.photo = null;
    photoPreview.hidden = true;
    photoSend.disabled = true;
    photoInput.value = '';
    if (leaderInput) leaderInput.value = '';
  });

  /* Spraak: Web Speech API (Chrome), Nederlands, vult het update-veld. */
  const micBtn = root.querySelector('[data-regie-mic]');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    if (micBtn) micBtn.hidden = true;
  } else {
    let rec = null;
    micBtn?.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = 'nl-NL';
      rec.interimResults = true;
      micBtn.classList.add('is-recording');
      rec.onresult = e => {
        if (leaderInput) leaderInput.value = Array.from(e.results).map(r => r[0].transcript).join('');
      };
      rec.onend = () => { micBtn.classList.remove('is-recording'); rec = null; leaderInput?.focus(); };
      rec.onerror = () => { micBtn.classList.remove('is-recording'); rec = null; };
      rec.start();
    });
  }

  if (_regie.timer) clearInterval(_regie.timer);
  _regie.timer = setInterval(refreshStatus, 5000);
  refreshStatus();
  _renderRegieTail();
}

function _resizeToDataUrl(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('geen geldige afbeelding'));
    img.src = URL.createObjectURL(file);
  });
}

/* De Regie-tab staat los van de hoofdtab: eigen mount, eigen container. */
async function _mountRegie(container) {
  _loadStyle();
  container.innerHTML = `<div class="hype-admin">${_renderRegieSection()}</div>`;
  _bindRegie(container);
  try {
    const tail = await _fetchJson(`${API}/stream-chat/tail`);
    _regie.tail = Array.isArray(tail.streamChat) ? tail.streamChat.slice(-30) : [];
    _renderRegieTail();
  } catch { /* sidecar/tail niet beschikbaar — tail blijft leeg */ }
}

/* ─── Section 4: Channels (meta + followers + comments per card) ───────── */

function _renderChannelsSection() {
  const channels = _ctx.snapshot.channels || [];
  const pools = _ctx.snapshot.pools || {};
  const followers = _ctx.snapshot.followers || {};
  return `
    <details class="hype-admin-section">
      <summary><h2>Channels</h2></summary>
      <p class="hype-pool-help">Eén kaart per influencer: profiel, follower-controls en comment-pool.</p>
      <div class="hype-channel-cards">
        ${channels.map(ch => _channelCardHtml(ch, pools[ch.id] || [], followers[ch.id])).join('')}
      </div>
    </details>
  `;
}

function _channelCardHtml(ch, items, followers) {
  const cur = (followers ?? ch.follower_base) | 0;
  const text = items.map(it => it.weight && it.weight !== 1 ? `${it.text}|${it.weight}` : it.text).join('\n');
  return `
    <div class="hype-channel-card" data-channel="${esc(ch.id)}" style="--ch-color:${esc(ch.color)}">
      <div class="cc-head">
        <input data-f="color" type="color" value="${esc(ch.color)}" title="Kleur" />
        <div class="cc-titles">
          <input data-f="name"   value="${esc(ch.name)}"   placeholder="Naam" />
          <input data-f="handle" value="${esc(ch.handle)}" placeholder="@handle" />
        </div>
      </div>
      <label class="cc-row">Avatar URL
        <input data-f="avatar_url" value="${esc(ch.avatar_url || '')}" placeholder="https://…" />
      </label>
      <div class="cc-row cc-avatar-upload">
        ${ch.avatar_url ? `<img src="${esc(ch.avatar_url)}" alt="" class="cc-avatar-preview" />` : ''}
        <input type="file" accept="image/*" data-avatar-file hidden />
        <button class="hype-admin-btn secondary" data-avatar-upload type="button">Upload avatar</button>
      </div>
      <label class="cc-row">Base followers
        <input data-f="follower_base" type="number" min="0" value="${ch.follower_base | 0}" />
      </label>
      <label class="cc-row">Spotlight days
        <input data-f="featured_days" value="${esc((ch.featured_days || []).join(','))}" placeholder="1,3,5" />
      </label>
      <label class="cc-row">
        <span>Follower race</span>
        <input data-f="race_participant" type="checkbox"${ch.race_participant !== false ? ' checked' : ''} />
      </label>
      <div class="cc-row foll-row">
        <span>Followers nu: <strong class="hype-foll-cur" data-foll-cur="${esc(ch.id)}">${cur.toLocaleString()}</strong></span>
        <input type="number" placeholder="set" data-foll-set />
        <button class="hype-admin-btn secondary" data-foll-act="set">Set</button>
        <input type="number" placeholder="±bump" data-foll-bump />
        <button class="hype-admin-btn secondary" data-foll-act="bump">Bump</button>
      </div>
      <details class="cc-pool">
        <summary>Comment pool (${items.length})</summary>
        <p class="hype-pool-help">Eén comment per regel. Optioneel achteraan <code>|weight</code> (default 1).</p>
        <textarea data-pool-text>${esc(text)}</textarea>
        <button class="hype-admin-btn secondary" data-save-pool>Save pool</button>
      </details>
      <button class="hype-admin-btn" data-save-channel>Save channel</button>
    </div>
  `;
}

function _channelFormBody(card) {
  const body = {};
  for (const inp of card.querySelectorAll('input[data-f]')) {
    body[inp.dataset.f] = inp.type === 'checkbox'
      ? inp.checked
      : inp.dataset.f === 'featured_days'
      ? inp.value.split(',').map(v => Number(v.trim()) || 0).filter(Boolean)
      : inp.value;
  }
  return body;
}

function _bindChannels(root) {
  for (const card of root.querySelectorAll('.hype-channel-card')) {
    const id = card.dataset.channel;

    const fileInput = card.querySelector('[data-avatar-file]');
    card.querySelector('[data-avatar-upload]')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const form = new FormData();
        form.append('image', file);
        const res = await fetch('/api/slides/upload-article-image', { method: 'POST', body: form });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
        const { filename } = await res.json();
        card.querySelector('[data-f="avatar_url"]').value = `/slide-assets/images/${filename}`;
        await _fetchJson(`${API}/channels/${encodeURIComponent(id)}`, {
          method: 'PUT', body: JSON.stringify(_channelFormBody(card)),
        });
        _toast(`${id} avatar saved`);
      } catch (err) {
        _toast(`Avatar upload failed: ${err.message}`, true);
      } finally {
        fileInput.value = '';
      }
    });

    card.querySelector('[data-save-channel]')?.addEventListener('click', async () => {
      try {
        await _fetchJson(`${API}/channels/${encodeURIComponent(id)}`, {
          method: 'PUT', body: JSON.stringify(_channelFormBody(card)),
        });
        _toast(`${id} saved`);
      } catch (err) { _toast(`Save failed: ${err.message}`, true); }
    });

    card.querySelector('[data-save-pool]')?.addEventListener('click', async () => {
      const text = card.querySelector('[data-pool-text]')?.value || '';
      const items = text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const m = line.match(/^(.*?)\|(\d+(?:\.\d+)?)$/);
        return m ? { text: m[1].trim(), weight: Number(m[2]) } : { text: line, weight: 1 };
      });
      try {
        await _fetchJson(`${API}/channels/${encodeURIComponent(id)}/pool`, {
          method: 'PUT', body: JSON.stringify({ items }),
        });
        _toast(`Pool ${id} saved (${items.length})`);
      } catch (err) { _toast(`Save failed: ${err.message}`, true); }
    });

    for (const btn of card.querySelectorAll('[data-foll-act]')) {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.follAct;
        const body = act === 'set'
          ? { count: Number(card.querySelector('[data-foll-set]').value) }
          : { bump:  Number(card.querySelector('[data-foll-bump]').value) };
        try {
          const out = await _fetchJson(`${API}/channels/${encodeURIComponent(id)}/followers`, {
            method: 'PUT', body: JSON.stringify(body),
          });
          const cur = card.querySelector(`[data-foll-cur="${CSS.escape(id)}"]`);
          if (cur) cur.textContent = (out[id] | 0).toLocaleString();
          _toast(`${id}: ${out[id]} followers`);
        } catch (err) { _toast(`Failed: ${err.message}`, true); }
      });
    }
  }
}

/* ─── Section 5: Photo tagging ────────────────────────────────────────── */

function _renderTaggingSection() {
  const channels = _ctx.snapshot.channels || [];
  const channelByPhotoId = _ctx.snapshot.channelByPhotoId || {};
  const photoStates = new Map((_ctx.snapshot.photoStates || []).map(p => [p.photo_id, p]));
  const photos = _ctx.photos || [];

  const buildOpts = (cur) => {
    const sel = v => v === (cur || '') ? ' selected' : '';
    return `<option value=""${sel('')}>— none —</option>` +
      channels.map(c => `<option value="${esc(c.id)}"${sel(c.id)}>${esc(c.name)}</option>`).join('');
  };

  return `
    <details class="hype-admin-section">
      <summary><h2>Photo tagging <span style="font-weight:400;color:var(--text-muted);font-size:13px;">(${photos.length})</span></h2></summary>
      <p class="hype-pool-help">Wijs foto's toe aan een influencer. Niet-getagde foto's blijven op Kamp Live.</p>
      <div class="hype-tagging-grid">
        ${photos.slice(0, 200).map(p => {
          const cur = channelByPhotoId[p.id] || '';
          const viral = !!photoStates.get(p.id)?.viral;
          const likes = photoStates.get(p.id)?.likes | 0;
          return `
            <div class="hype-tag-card" data-photo="${esc(p.id)}">
              <img src="${esc(p.thumbUrl || p.url || '')}" alt="" loading="lazy" />
              <div class="controls">
                <select data-photo-channel>${buildOpts(cur)}</select>
                <label class="viral-toggle">
                  <input type="checkbox" data-photo-viral ${viral ? 'checked' : ''}/>
                  viral <span style="color:var(--text-muted);margin-left:auto;">${likes} likes</span>
                </label>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </details>
  `;
}

function _bindTagging(root) {
  for (const card of root.querySelectorAll('[data-photo]')) {
    const id = card.dataset.photo;
    card.querySelector('[data-photo-channel]')?.addEventListener('change', async e => {
      try {
        await _fetchJson(`${API}/photos/${encodeURIComponent(id)}/channel`, {
          method: 'PUT', body: JSON.stringify({ channelId: e.target.value || null }),
        });
      } catch (err) { _toast(`Tag failed: ${err.message}`, true); }
    });
    card.querySelector('[data-photo-viral]')?.addEventListener('change', async e => {
      try {
        await _fetchJson(`${API}/photos/${encodeURIComponent(id)}/viral`, {
          method: 'PUT', body: JSON.stringify({ viral: e.target.checked }),
        });
      } catch (err) { _toast(`Viral failed: ${err.message}`, true); }
    });
  }
}

/* ─── Section 6: Live monitor ─────────────────────────────────────────── */

const _monitorRows = [];

function _renderMonitorSection() {
  return `
    <details class="hype-admin-section">
      <summary><h2>Live monitor</h2></summary>
      <p class="hype-pool-help">Live activiteit van de engine (laatste 100 events).</p>
      <div class="hype-monitor" id="hype-monitor"></div>
    </details>
  `;
}

function _appendMonitor(msg) {
  if (msg.type !== 'hype:state_update') return;
  const ch = _ctx.snapshot.channels.find(c => c.id === msg.channelId);
  _monitorRows.unshift({
    ts: Date.now(),
    channelId: msg.channelId,
    channelColor: ch?.color || '#888',
    photoId: msg.photoId,
    likes: msg.likes,
    comment: msg.newComment?.text || '',
  });
  if (_monitorRows.length > 100) _monitorRows.length = 100;
  _renderMonitorRows();
}

function _renderMonitorRows() {
  const box = document.getElementById('hype-monitor');
  if (!box) return;
  box.innerHTML = _monitorRows.map(r => `
    <div class="hype-monitor-row">
      <span class="hype-monitor-time">${new Date(r.ts).toLocaleTimeString()}</span>
      <span class="hype-monitor-ch" style="color:${esc(r.channelColor)}">${esc(r.channelId || 'general')}</span>
      <span class="hype-monitor-likes">${r.likes} likes</span>
      <span class="hype-monitor-text">${esc(r.comment)}</span>
    </div>
  `).join('');
}

/* ─── Mount ───────────────────────────────────────────────────────────── */

async function _hydrate() {
  const [snapshot, photos, slides] = await Promise.all([
    _fetchJson(`${API}/snapshot`),
    _fetchJson('/api/photos').catch(() => []),
    _fetchJson('/api/slides').catch(() => []),
  ]);
  _ctx.snapshot = snapshot;
  _ctx.photos = photos;
  _ctx.slides = slides;
  _regie.tail = Array.isArray(snapshot.streamChat) ? snapshot.streamChat.slice(-30) : [];
}

function _render() {
  _ctx.root.innerHTML = `
    <div class="hype-admin">
      ${_renderShowtime()}
      ${_renderPlatformSection()}
      ${_renderStreamSection()}
      ${_renderChannelsSection()}
      ${_renderTaggingSection()}
      ${_renderMonitorSection()}
    </div>
  `;
  _bindShowtime(_ctx.root);
  _bindPlatform(_ctx.root);
  _bindStream(_ctx.root);
  _bindChannels(_ctx.root);
  _bindTagging(_ctx.root);
}

async function _mount(container) {
  _loadStyle();
  _ctx = {
    root: container,
    snapshot: { settings: {}, channels: [], pools: {}, followers: {}, photoStates: [], channelByPhotoId: {}, videos: [] },
    photos: [], slides: [], screenCount: 2,
  };
  container.innerHTML = `<div class="hype-admin" style="padding:24px;color:var(--text-muted);">Loading…</div>`;
  try {
    await _hydrate();
    _ctx.screenCount = Math.max(1, Math.min(4, Number((await _fetchJson('/api/config').catch(() => null))?.screenCount) || 2));
    _render();
  } catch (err) {
    container.innerHTML = `<div class="hype-admin" style="padding:24px;color:#ff6b6b;">Failed to load Hype: ${esc(err.message)}</div>`;
  }
}

/* ─── WS handler ──────────────────────────────────────────────────────── */

function _onWs(msg) {
  if (!_ctx) return;
  switch (msg.type) {
    case 'hype:state_update': {
      const list = _ctx.snapshot.photoStates;
      const idx = list.findIndex(p => p.photo_id === msg.photoId);
      const row = { photo_id: msg.photoId, likes: msg.likes, viral: msg.viral ? 1 : 0, updated_at: Date.now() };
      if (idx >= 0) list[idx] = { ...list[idx], ...row };
      else list.push(row);
      _appendMonitor(msg);
      break;
    }
    case 'hype:followers_update': {
      Object.assign(_ctx.snapshot.followers, msg.counts || {});
      for (const [id, count] of Object.entries(msg.counts || {})) {
        const el = _ctx.root.querySelector(`[data-foll-cur="${CSS.escape(id)}"]`);
        if (el) el.textContent = (count | 0).toLocaleString();
      }
      break;
    }
    case 'hype:channels_update': {
      _ctx.snapshot.channels = msg.channels || _ctx.snapshot.channels;
      break;
    }
    case 'hype:photo_channel_update': {
      _ctx.snapshot.channelByPhotoId[msg.photoId] = msg.channelId;
      break;
    }
    case 'hype:settings_update': {
      _ctx.snapshot.settings = msg.settings || _ctx.snapshot.settings;
      _refreshShowtime();
      break;
    }
    case 'hype:videos_update': {
      _ctx.snapshot.videos = msg.videos || [];
      break;
    }
    case 'hype:stream_chat': {
      if (msg.item) _regie.tail.push(msg.item);
      if (_regie.tail.length > 30) _regie.tail.shift();
      _renderRegieTail();
      break;
    }
    case 'hype:stream_chat_reset': {
      _regie.tail = [];
      _renderRegieTail();
      break;
    }
  }
}

/* ─── Register ────────────────────────────────────────────────────────── */

export async function register() {
  registerAdminTab({
    id: 'hype',
    label: 'De Hype',
    icon: '',
    mount: _mount,
  });
  registerAdminTab({
    id: 'hype-regie',
    label: 'Regie',
    icon: '',
    mount: _mountRegie,
  });
  registerAdminWsHandler('hype', _onWs);

  // Extend video + pool-video slide forms with hype-specific channel + caption fields.
  let _channels = [];
  fetch(`${API}/channels`).then(r => r.json()).then(ch => { _channels = ch || []; }).catch(() => {});

  const _videoExt = {
    buildExtra(slide) {
      const opts = _channels.map(ch =>
        `<option value="${esc(ch.id)}" ${slide.channelId === ch.id ? 'selected' : ''}>${esc(ch.name)} (${esc(ch.handle)})</option>`
      ).join('');
      return `
        <div class="sf-field" style="border-top:1px solid var(--border,#2a2a36);margin-top:8px;padding-top:8px">
          <label style="font-size:11px;color:var(--muted)">— Hype module —</label>
        </div>
        <div class="sf-field">
          <label>Influencer channel</label>
          <select id="sf-hype-channelid">
            <option value="">— geen (algemeen account) —</option>
            ${opts}
          </select>
        </div>
        <div class="sf-field">
          <label>Caption (reel tekst)</label>
          <input id="sf-hype-caption" type="text" value="${esc(slide.caption || '')}" placeholder="Live vanaf het kamp 🏕️">
        </div>
      `;
    },
    readExtra() {
      return {
        channelId: document.getElementById('sf-hype-channelid')?.value || '',
        caption:   document.getElementById('sf-hype-caption')?.value   || '',
      };
    },
  };

  registerSlideFormExtension('video',      _videoExt);
  registerSlideFormExtension('pool-video', _videoExt);
}
