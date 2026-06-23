// Hype admin tab. Dynamically imported by /admin/modules-loader.js.
// Single tab, six sections in operator-priority order:
//   1. Showtime         — current phase + lifecycle buttons + plot triggers
//   2. Platform account — Kamp Live identity + manual activity item
//   3. Stream           — fullscreen broadcast settings
//   4. Channels         — per-channel card (meta + featured days + followers + comments)
//   5. Photo tagging    — assign photos to influencers
//   6. Live monitor     — read-only engine activity feed

import { registerAdminTab, registerAdminWsHandler } from '/admin/module-registry.js';

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
 * One section holds every lifecycle control so the operator never has to
 * scroll mid-show: phase pill, lifecycle buttons, follower pulse, plot triggers.
 */

const PLOT_TRIGGERS = [
  { id: 'hype-glitch',  cls: 'glitch',  label: 'Glitch',
    desc: 'Korte storing op het scherm. Level 1 = subtiel, level 3 = stevig.', defaultDur: 6, level: true },
  { id: 'hype-hacker',  cls: 'hacker',  label: 'Hacker',
    desc: 'Harry Ecker neemt even over met een terminal-takeover.', defaultDur: 12 },
];

function _phaseLabel(settings) {
  if (settings.platformOff)  return { text: 'OFFLINE', cls: 'off' };
  if (settings.preLaunch)    return { text: 'PRE-LAUNCH', cls: 'idle' };
  if (settings.launchActive) return { text: 'LAUNCHING', cls: 'launching' };
  return { text: 'LIVE', cls: 'live' };
}

function _renderShowtime() {
  const settings = _ctx.snapshot.settings || {};
  const phase = _phaseLabel(settings);
  return `
    <section class="hype-admin-section showtime">
      <div class="showtime-head">
        <h2>Showtime</h2>
        <span class="phase-pill phase-${phase.cls}">${phase.text}</span>
        <button class="hype-admin-btn secondary" data-morning-check>Follower pulse</button>
      </div>

      <div class="lifecycle-row">
        <button class="hype-admin-btn big launch" data-launch-platform>
          <span class="lc-label">Launch platform</span>
          <span class="lc-sub">Eerste keer live — start cinematische intro</span>
        </button>
        <button class="hype-admin-btn big neutral" data-reset-prelaunch>
          <span class="lc-label">Reset → pre-launch</span>
          <span class="lc-sub">Terug naar idle teaser (repetitie)</span>
        </button>
        <button class="hype-admin-btn big danger" data-power-off>
          <span class="lc-label">Power off</span>
          <span class="lc-sub">Theatraal uitzetten — blijft uit tot Restart</span>
        </button>
        <button class="hype-admin-btn big restart" data-restart-platform>
          <span class="lc-label">Restart</span>
          <span class="lc-sub">CRT-reboot na de redding</span>
        </button>
      </div>

      <h3>Plot triggers</h3>
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
    </section>
  `;
}

function _bindShowtime(root) {
  root.querySelector('[data-morning-check]')?.addEventListener('click', async () => {
    try {
      await _fetchJson(`${API}/morning-check`, { method: 'POST', body: JSON.stringify({}) });
      _toast('Follower pulse sent');
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

  root.querySelector('[data-power-off]')?.addEventListener('click', async () => {
    if (!confirm('Trigger a theatrical power-off? Stays offline until you hit Restart.')) return;
    try {
      const saved = await _fetchJson(`${API}/power-off`, { method: 'POST', body: JSON.stringify({}) });
      _ctx.snapshot.settings = saved || _ctx.snapshot.settings;
      _toast('Platform offline');
      _refreshShowtime();
    } catch (err) { _toast(`Power-off failed: ${err.message}`, true); }
  });

  root.querySelector('[data-restart-platform]')?.addEventListener('click', async () => {
    if (!confirm('Play the restart sequence? CRT reboot + confetti finale.')) return;
    try {
      const saved = await _fetchJson(`${API}/restart`, { method: 'POST', body: JSON.stringify({}) });
      _ctx.snapshot.settings = saved?.settings || saved || _ctx.snapshot.settings;
      _toast('Restart fired');
      _refreshShowtime();
    } catch (err) { _toast(`Restart failed: ${err.message}`, true); }
  });

  for (const btn of root.querySelectorAll('[data-trigger]')) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.trigger;
      const t = PLOT_TRIGGERS.find(x => x.id === id);
      const durEl = root.querySelector(`[data-trigger-dur="${id}"]`);
      const msgEl = root.querySelector(`[data-trigger-msg="${id}"]`);
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

/* ─── Section 2: Platform account ─────────────────────────────────────── */

function _renderPlatformSection() {
  const settings = _ctx.snapshot.settings || {};
  const account = settings.generalAccount || {};
  return `
    <section class="hype-admin-section">
      <h2>Platform account</h2>
      <div class="hype-settings-grid">
        <label>Mode
          <select data-hype-setting="mode">
            <option value="normal"${settings.mode !== 'dashboard' && settings.mode !== 'social-only' ? ' selected' : ''}>Photo feed</option>
            <option value="dashboard"${settings.mode === 'dashboard' || settings.mode === 'social-only' ? ' selected' : ''}>Summon dashboard</option>
          </select>
        </label>
        <label>Spotlight day
          <input data-hype-setting="spotlightDay" type="number" min="1" max="6" value="${Number(settings.spotlightDay) || 1}" />
        </label>
        <label>Harry heat
          <input data-hype-setting="harryHeat" type="range" min="0" max="5" step="1" value="${Number(settings.harryHeat) || 0}" />
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
    </section>
  `;
}

function _bindPlatform(root) {
  root.querySelector('[data-save-platform]')?.addEventListener('click', async () => {
    const body = { generalAccount: {} };
    const modeEl = root.querySelector('[data-hype-setting="mode"]');
    if (modeEl) body.mode = modeEl.value;
    const heatEl = root.querySelector('[data-hype-setting="harryHeat"]');
    if (heatEl) body.harryHeat = Number(heatEl.value) || 0;
    const dayEl = root.querySelector('[data-hype-setting="spotlightDay"]');
    if (dayEl) body.spotlightDay = Number(dayEl.value) || 1;
    for (const el of root.querySelectorAll('[data-hype-account]')) {
      body.generalAccount[el.dataset.hypeAccount] = el.value;
    }
    try {
      const saved = await _fetchJson(`${API}/settings`, {
        method: 'PATCH', body: JSON.stringify(body),
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
  const videos = (_ctx.slides || []).filter(s => s.type === 'video' && s.filename);
  const savedVideos = _ctx.snapshot.videos || [];
  const settings = _ctx.snapshot.settings || {};
  const stream = settings.stream || {};
  const active = savedVideos.find(v => v.id === stream.videoId)
    || savedVideos.find(v => v.active && v.placement === 'stream')
    || null;
  return `
    <section class="hype-admin-section">
      <h2>Fullscreen stream</h2>
      <p class="hype-pool-help">Zet dit aan als het scherm een live-uitzending moet imiteren.</p>
      <div class="hype-stream-grid">
        <label class="hype-check-row">
          <input type="checkbox" data-stream-enabled ${stream.enabled ? 'checked' : ''} />
          Stream live fullscreen
        </label>
        <label>Source
          <select data-stream-source>
            <option value="video"${stream.sourceType !== 'url' && stream.sourceType !== 'camera' ? ' selected' : ''}>Uploaded video</option>
            <option value="url"${stream.sourceType === 'url' ? ' selected' : ''}>Stream URL</option>
            <option value="camera"${stream.sourceType === 'camera' ? ' selected' : ''}>Attached camera</option>
          </select>
        </label>
        <label>Title
          <input data-stream-title value="${esc(stream.title || 'Keuken Live')}" />
        </label>
        <label>Subtitle
          <input data-stream-subtitle value="${esc(stream.subtitle || 'live vanaf het kamp')}" />
        </label>
        <select data-video-slide>
          <option value="">No stream video</option>
          ${videos.map(v => `<option value="${esc(v.id)}"${active?.slide_id === v.id ? ' selected' : ''} data-filename="${esc(v.filename)}">${esc(v.label || v.filename)}</option>`).join('')}
        </select>
        <input data-stream-url placeholder="https://.../stream.m3u8 or .mp4" value="${esc(stream.url || '')}" />
        <input data-stream-device placeholder="camera device id, optional" value="${esc(stream.deviceId || '')}" />
        <button class="hype-admin-btn" data-save-stream>Save stream</button>
      </div>
    </section>
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
          },
        }),
      });
      _ctx.snapshot.settings = settings;
      _toast('Stream settings saved');
    } catch (err) { _toast(`Stream save failed: ${err.message}`, true); }
  });
}

/* ─── Section 4: Channels (meta + followers + comments per card) ───────── */

function _renderChannelsSection() {
  const channels = _ctx.snapshot.channels || [];
  const pools = _ctx.snapshot.pools || {};
  const followers = _ctx.snapshot.followers || {};
  return `
    <section class="hype-admin-section">
      <h2>Channels</h2>
      <p class="hype-pool-help">Eén kaart per influencer: profiel, follower-controls en comment-pool.</p>
      <div class="hype-channel-cards">
        ${channels.map(ch => _channelCardHtml(ch, pools[ch.id] || [], followers[ch.id])).join('')}
      </div>
    </section>
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

function _bindChannels(root) {
  for (const card of root.querySelectorAll('.hype-channel-card')) {
    const id = card.dataset.channel;

    card.querySelector('[data-save-channel]')?.addEventListener('click', async () => {
      const body = {};
      for (const inp of card.querySelectorAll('input[data-f]')) {
        body[inp.dataset.f] = inp.type === 'checkbox'
          ? inp.checked
          : inp.dataset.f === 'featured_days'
          ? inp.value.split(',').map(v => Number(v.trim()) || 0).filter(Boolean)
          : inp.value;
      }
      try {
        await _fetchJson(`${API}/channels/${encodeURIComponent(id)}`, {
          method: 'PUT', body: JSON.stringify(body),
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
    <section class="hype-admin-section">
      <h2>Photo tagging <span style="font-weight:400;color:var(--text-muted);font-size:13px;">(${photos.length})</span></h2>
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
    </section>
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
    <section class="hype-admin-section">
      <h2>Live monitor</h2>
      <p class="hype-pool-help">Live activiteit van de engine (laatste 100 events).</p>
      <div class="hype-monitor" id="hype-monitor"></div>
    </section>
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
    photos: [], slides: [],
  };
  container.innerHTML = `<div class="hype-admin" style="padding:24px;color:var(--text-muted);">Loading…</div>`;
  try {
    await _hydrate();
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
  registerAdminWsHandler('hype', _onWs);
}
