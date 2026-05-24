// Hype admin tab. Dynamically imported by /admin/modules-loader.js.
// Registers a tab and a hype:* WS handler. All sections live in this file
// to keep the module tightly scoped.

import { registerAdminTab, registerAdminWsHandler } from '/admin/module-registry.js';

const API = '/api/modules/hype';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let _ctx = null; // { root, snapshot, photos, refresh* fns }

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
  // Fall back — admin app exposes showToast via DOM only.
  const t = document.getElementById('toast');
  if (!t) { console.log('[hype]', msg); return; }
  t.textContent = msg;
  t.className = 'toast' + (err ? ' toast-err' : ' toast-ok');
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 2500);
}

// ─── Section: manual plot triggers ──────────────────────────────────────────

const TRIGGERS = [
  { id: 'hype-glitch',  cls: 'glitch',  label: 'GLITCH',   emoji: '⚡',
    desc: 'Korte storing — pixels, beeldruis.', defaultDur: 6 },
  { id: 'hype-hacker',  cls: 'hacker',  label: 'HACKER',   emoji: '💻',
    desc: 'Harry Ecker typt op het scherm.',     defaultDur: 12 },
  { id: 'hype-offline', cls: 'offline', label: 'OFFLINE',  emoji: '📵',
    desc: 'Platform plat — "Reconnecting...".', defaultDur: 30 },
  { id: 'hype-comeback',cls: 'comeback',label: 'COMEBACK', emoji: '🎉',
    desc: 'Gescripte terugkeer-sequence.',       defaultDur: 18 },
];

function _renderTriggers() {
  return `
    <section class="hype-admin-section">
      <h2>Plot triggers</h2>
      <p class="hype-pool-help">Vuren een alert naar alle schermen.</p>
      <div class="hype-triggers">
        ${TRIGGERS.map(t => `
          <div class="hype-trigger-card ${t.cls}">
            <h4>${t.emoji} ${t.label}</h4>
            <p class="hype-trigger-desc">${esc(t.desc)}</p>
            <label>Duur (sec)
              <input type="number" min="2" max="600" value="${t.defaultDur}"
                     data-trigger-dur="${t.id}" />
            </label>
            <label>Tekst (optioneel)
              <input type="text" placeholder="Eigen boodschap…"
                     data-trigger-msg="${t.id}" />
            </label>
            <button class="hype-admin-btn big" data-trigger="${t.id}">Fire</button>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function _bindTriggers(root) {
  for (const btn of root.querySelectorAll('[data-trigger]')) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.trigger;
      const t = TRIGGERS.find(x => x.id === id);
      const durEl = root.querySelector(`[data-trigger-dur="${id}"]`);
      const msgEl = root.querySelector(`[data-trigger-msg="${id}"]`);
      const seconds = Math.max(2, Number(durEl?.value) || t.defaultDur);
      const message = msgEl?.value?.trim() || null;
      const payload = { message, seconds };
      try {
        await _fetchJson('/api/alerts', {
          method: 'POST',
          body: JSON.stringify({
            type: id,
            payload,
            durationSec: seconds,
            message: message || t.label,
            style: 'popup',
            active: true,
          }),
        });
        _toast(`${t.label} fired (${seconds}s)`);
      } catch (err) {
        _toast(`Fire failed: ${err.message}`, true);
      }
    });
  }
}

// ─── Section: channels ──────────────────────────────────────────────────────

function _renderChannelsSection() {
  const channels = _ctx.snapshot.channels || [];
  const followers = _ctx.snapshot.followers || {};
  return `
    <section class="hype-admin-section">
      <h2>Channels</h2>
      <div class="hype-channels-list" id="hype-channels-list">
        <div class="hype-channel-row" style="background:transparent;border-left:0;font-size:11px;color:var(--text-muted);">
          <span></span><span>Name</span><span>Handle</span><span>Color</span>
          <span>Emoji</span><span>Base</span><span>Growth/min</span><span>Followers</span>
        </div>
        ${channels.map(ch => _channelRowHtml(ch, followers[ch.id])).join('')}
      </div>
    </section>
  `;
}

function _channelRowHtml(ch, followers) {
  return `
    <div class="hype-channel-row" data-channel="${esc(ch.id)}" style="--ch-color:${esc(ch.color)}">
      <span class="emoji">${esc(ch.emoji || '')}</span>
      <input data-f="name"          value="${esc(ch.name)}" />
      <input data-f="handle"        value="${esc(ch.handle)}" />
      <input data-f="color"         value="${esc(ch.color)}" type="color" />
      <input data-f="emoji"         value="${esc(ch.emoji || '')}" maxlength="4" />
      <input data-f="follower_base" value="${ch.follower_base | 0}" type="number" min="0" />
      <input data-f="growth_rate"   value="${Number(ch.growth_rate || 0)}" type="number" step="0.1" min="0" />
      <span class="hype-foll-cur">${(followers ?? ch.follower_base) | 0}</span>
      <button class="hype-admin-btn" data-save-channel="${esc(ch.id)}">Save</button>
    </div>
  `;
}

function _bindChannels(root) {
  for (const btn of root.querySelectorAll('[data-save-channel]')) {
    btn.addEventListener('click', () => _saveChannel(btn.dataset.saveChannel));
  }
}

async function _saveChannel(id) {
  const row = _ctx.root.querySelector(`[data-channel="${CSS.escape(id)}"]`);
  if (!row) return;
  const body = {};
  for (const inp of row.querySelectorAll('input[data-f]')) {
    body[inp.dataset.f] = inp.value;
  }
  try {
    await _fetchJson(`${API}/channels/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    _toast(`${id} saved`);
  } catch (err) {
    _toast(`Save failed: ${err.message}`, true);
  }
}

// ─── Section: comment pools ─────────────────────────────────────────────────

function _renderPoolsSection() {
  const channels = _ctx.snapshot.channels || [];
  const pools = _ctx.snapshot.pools || {};
  return `
    <section class="hype-admin-section">
      <h2>Comment pools</h2>
      <p class="hype-pool-help">Eén comment per regel. Optioneel achteraan <code>|weight</code> (default 1).</p>
      ${channels.map(ch => {
        const items = pools[ch.id] || [];
        const text = items.map(it => it.weight && it.weight !== 1 ? `${it.text}|${it.weight}` : it.text).join('\n');
        return `
          <div class="hype-pool-row" data-pool="${esc(ch.id)}" style="--ch-color:${esc(ch.color)}">
            <h4>${esc(ch.emoji || '')} ${esc(ch.name)} <span style="color:var(--text-muted);font-weight:400;">(${items.length})</span></h4>
            <textarea data-pool-text>${esc(text)}</textarea>
            <button class="hype-admin-btn" data-save-pool="${esc(ch.id)}">Save pool</button>
          </div>
        `;
      }).join('')}
    </section>
  `;
}

function _bindPools(root) {
  for (const btn of root.querySelectorAll('[data-save-pool]')) {
    btn.addEventListener('click', () => _savePool(btn.dataset.savePool));
  }
}

async function _savePool(id) {
  const row = _ctx.root.querySelector(`[data-pool="${CSS.escape(id)}"]`);
  const text = row?.querySelector('[data-pool-text]')?.value || '';
  const items = text.split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^(.*?)\|(\d+(?:\.\d+)?)$/);
      return m ? { text: m[1].trim(), weight: Number(m[2]) } : { text: line, weight: 1 };
    });
  try {
    await _fetchJson(`${API}/channels/${encodeURIComponent(id)}/pool`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    });
    _toast(`Pool ${id} saved (${items.length})`);
  } catch (err) {
    _toast(`Save failed: ${err.message}`, true);
  }
}

// ─── Section: followers override ────────────────────────────────────────────

function _renderFollowersSection() {
  const channels = _ctx.snapshot.channels || [];
  const followers = _ctx.snapshot.followers || {};
  return `
    <section class="hype-admin-section">
      <h2>Followers override</h2>
      <div class="hype-channels-list">
        ${channels.map(ch => `
          <div class="hype-channel-row" data-foll="${esc(ch.id)}" style="--ch-color:${esc(ch.color)};grid-template-columns:24px 1.5fr 100px 80px 80px 80px;">
            <span class="emoji">${esc(ch.emoji || '')}</span>
            <span><strong>${esc(ch.name)}</strong> <span class="hype-foll-cur" data-foll-cur="${esc(ch.id)}">${(followers[ch.id] ?? ch.follower_base) | 0}</span></span>
            <input type="number" placeholder="set absolute" data-foll-set />
            <button class="hype-admin-btn secondary" data-foll-act="set">Set</button>
            <input type="number" placeholder="±bump" data-foll-bump />
            <button class="hype-admin-btn secondary" data-foll-act="bump">Bump</button>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function _bindFollowers(root) {
  for (const btn of root.querySelectorAll('[data-foll-act]')) {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-foll]');
      const id = row.dataset.foll;
      const act = btn.dataset.follAct;
      const body = act === 'set'
        ? { count: Number(row.querySelector('[data-foll-set]').value) }
        : { bump:  Number(row.querySelector('[data-foll-bump]').value) };
      try {
        const out = await _fetchJson(`${API}/channels/${encodeURIComponent(id)}/followers`, {
          method: 'PUT', body: JSON.stringify(body),
        });
        const cur = row.querySelector(`[data-foll-cur="${CSS.escape(id)}"]`);
        if (cur) cur.textContent = (out[id] | 0).toLocaleString();
        _toast(`${id}: ${out[id]} followers`);
      } catch (err) {
        _toast(`Failed: ${err.message}`, true);
      }
    });
  }
}

// ─── Section: photo tagging ─────────────────────────────────────────────────

function _renderTaggingSection() {
  const channels = _ctx.snapshot.channels || [];
  const channelByPhotoId = _ctx.snapshot.channelByPhotoId || {};
  const photoStates = new Map((_ctx.snapshot.photoStates || []).map(p => [p.photo_id, p]));
  const photos = _ctx.photos || [];

  const buildOpts = (cur) => {
    const sel = v => v === (cur || '') ? ' selected' : '';
    return `<option value=""${sel('')}>— none —</option>` +
      channels.map(c => `<option value="${esc(c.id)}"${sel(c.id)}>${esc(c.emoji || '')} ${esc(c.name)}</option>`).join('');
  };

  return `
    <section class="hype-admin-section">
      <h2>Photo tagging <span style="font-weight:400;color:var(--text-muted);font-size:13px;">(${photos.length})</span></h2>
      <p class="hype-pool-help">Wijs elke foto toe aan een channel. Markeer als 🔥 viral voor extra likes.</p>
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
                  🔥 viral <span style="color:var(--text-muted);margin-left:auto;">${likes} ♥</span>
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

// ─── Section: live monitor ──────────────────────────────────────────────────

const _monitorRows = []; // {ts, channelId, photoId, likes, comment}

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
    channelEmoji: ch?.emoji || '',
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
      <span class="hype-monitor-ch" style="color:${esc(r.channelColor)}">${esc(r.channelEmoji)} ${esc(r.channelId || '—')}</span>
      <span class="hype-monitor-likes">${r.likes} ♥</span>
      <span class="hype-monitor-text">${esc(r.comment)}</span>
    </div>
  `).join('');
}

// ─── Mount ──────────────────────────────────────────────────────────────────

async function _hydrate() {
  const [snapshot, photos] = await Promise.all([
    _fetchJson(`${API}/snapshot`),
    _fetchJson('/api/photos').catch(() => []),
  ]);
  _ctx.snapshot = snapshot;
  _ctx.photos = photos;
}

function _render() {
  _ctx.root.innerHTML = `
    <div class="hype-admin">
      ${_renderTriggers()}
      ${_renderChannelsSection()}
      ${_renderFollowersSection()}
      ${_renderPoolsSection()}
      ${_renderTaggingSection()}
      ${_renderMonitorSection()}
    </div>
  `;
  _bindTriggers(_ctx.root);
  _bindChannels(_ctx.root);
  _bindPools(_ctx.root);
  _bindFollowers(_ctx.root);
  _bindTagging(_ctx.root);
}

async function _mount(container) {
  _loadStyle();
  _ctx = { root: container, snapshot: { channels: [], pools: {}, followers: {}, photoStates: [], channelByPhotoId: {} }, photos: [] };
  container.innerHTML = `<div class="hype-admin" style="padding:24px;color:var(--text-muted);">Loading…</div>`;
  try {
    await _hydrate();
    _render();
  } catch (err) {
    container.innerHTML = `<div class="hype-admin" style="padding:24px;color:#ff6b6b;">Failed to load Hype: ${esc(err.message)}</div>`;
  }
}

// ─── WS handler ─────────────────────────────────────────────────────────────

function _onWs(msg) {
  if (!_ctx) return;
  switch (msg.type) {
    case 'hype:state_update': {
      // Update photoStates cache + bump cards
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
        const row = _ctx.root.querySelector(`[data-channel="${CSS.escape(id)}"] .hype-foll-cur`);
        if (row) row.textContent = (count | 0).toLocaleString();
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
  }
}

// ─── Register ───────────────────────────────────────────────────────────────

export async function register() {
  registerAdminTab({
    id: 'hype',
    label: 'De Hype',
    icon: '📱',
    mount: _mount,
  });
  registerAdminWsHandler('hype', _onWs);
}
