// Admin entry point: init, page routing, WebSocket, orchestration

import { loadConfig, saveConfig, loadStats, loadSlides, loadPlaylists } from './api.js';
import { extractGroups }                                                  from './health.js';
import { initQuickTab, refreshFromConfig as quickRefresh, updateGroups as quickUpdateGroups } from './tabs/quick.js';
import { initAdvancedTab, refreshFromConfig as advRefresh, updateGroups as advUpdateGroups, applySafeFallback } from './tabs/advanced.js';
import { initPhotosTab, refreshPhotos, onNewPhoto, onRemovePhoto, onPhotoUpdate, updateGroups as photosUpdateGroups } from './tabs/photos.js';
import { initSlidesTab, refreshSlides, createNewPlaylist } from './tabs/slides.js';
import { initOverlaysTab, refreshFromConfig as ovRefresh } from './tabs/overlays.js';
import { initSettingsTab, refreshFromConfig as settingsRefresh } from './tabs/settings.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config         = { screens: {}, screenCount: 2 };
let _playlists     = [];
let pendingChanges = false;

export function getConfig() { return config; }

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export function showToast(msg, isErr = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className   = 'toast' + (isErr ? ' toast-err' : ' toast-ok');
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// ---------------------------------------------------------------------------
// Dirty indicator
// ---------------------------------------------------------------------------

function onChanged() {
  pendingChanges = true;
  _updateDirtyIndicator();
}

function _updateDirtyIndicator() {
  const dirty = document.getElementById('save-dirty');
  const save  = document.getElementById('btn-save');
  if (dirty) dirty.classList.toggle('visible', pendingChanges);
  if (save)  save.classList.toggle('has-changes', pendingChanges);
}

// ---------------------------------------------------------------------------
// Theme dropdown
// ---------------------------------------------------------------------------

let _themes = []; // [{ id, name }]

async function doLoadThemes() {
  try {
    const res = await fetch('/api/themes');
    if (!res.ok) return;
    _themes = await res.json();
    _populateThemeSelect();
  } catch {
    // themes dir may not exist yet — ignore
  }
}

function _populateThemeSelect() {
  const sel = document.getElementById('theme-select');
  if (!sel) return;
  const current = config.theme || '';
  sel.innerHTML = '<option value="">Default (no theme)</option>' +
    _themes.map(t => `<option value="${_esc(t.id)}">${_esc(t.name || t.id)}</option>`).join('');
  sel.value = current;
  _updateThemeHint(current);
}

function _updateThemeHint(themeId) {
  const hint = document.getElementById('theme-hint');
  if (!hint) return;
  if (!themeId) {
    hint.textContent = 'No theme active — screens use default styling.';
  } else {
    const t = _themes.find(t => t.id === themeId);
    hint.textContent = t?.description ? t.description : `Theme "${themeId}" active.`;
  }
}

function _bindThemeSelect() {
  document.getElementById('theme-select')?.addEventListener('change', async (e) => {
    const themeId = e.target.value || null;
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: themeId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      config.theme = themeId;
      _updateThemeHint(themeId || '');
      showToast('Theme applied');
    } catch (err) {
      showToast(`Theme change failed: ${err.message}`, true);
    }
  });
}

// ---------------------------------------------------------------------------
// Config load / save
// ---------------------------------------------------------------------------

async function doLoadConfig() {
  try {
    config = _normalizeConfig(await loadConfig());
    _renderScreenUi();
    _applyScreenCount(config.screenCount || 2);
    quickRefresh();
    advRefresh();
    ovRefresh();
    settingsRefresh();
    _refreshPlaylistSelects();
    _updateScreenHints();
    _populateThemeSelect();
    pendingChanges = false;
    _updateDirtyIndicator();
  } catch (err) {
    showToast(`Config load failed: ${err.message}`, true);
  }
}

async function doSaveConfig() {
  try {
    await saveConfig(config);
    showToast('Saved & applied to screens');
    pendingChanges = false;
    _updateDirtyIndicator();
  } catch (err) {
    showToast(`Save failed: ${err.message}`, true);
  }
}

// ---------------------------------------------------------------------------
// Playlist selects on Screens page
// ---------------------------------------------------------------------------

function _refreshPlaylistSelects() {
  for (const id of _activeScreenIds()) {
    const sel = document.getElementById(`sc-s${id}-playlist`);
    if (!sel) continue;
    const current = config.screens[id]?.playlistId || '';
    sel.innerHTML = '<option value="">— None (photo-only mode) —</option>' +
      _playlists.map(pl => `<option value="${_esc(pl.id)}">${_esc(pl.name)}</option>`).join('');
    sel.value = current;
  }
  _updateScreenHints();
}

function _updateScreenHints() {
  for (const id of _activeScreenIds()) {
    const hint = document.getElementById(`s${id}-playlist-hint`);
    if (hint) hint.style.display = config.screens[id]?.playlistId ? 'none' : 'block';
  }
}

function _bindPlaylistSelects() {
  for (const id of ['1', '2', '3', '4']) {
    document.getElementById(`sc-s${id}-playlist`)?.addEventListener('change', e => {
      if (!config.screens[id]) config.screens[id] = {};
      config.screens[id].playlistId = e.target.value || null;
      _updateScreenHints();
      onChanged();
    });
  }
}

function _renderScreenUi() {
  const cards = document.getElementById('screens-grid-container');
  const navChips = document.getElementById('nav-screen-chips');
  const links = document.getElementById('sidebar-screen-links');
  if (!cards || !navChips || !links) return;

  cards.innerHTML = ['1', '2', '3', '4'].map(id => _screenCardHtml(id)).join('');
  navChips.innerHTML = ['1', '2', '3', '4'].map(id => `
    <div class="nav-screen-chip" id="nav-s${id}-chip">
      <div class="status-dot" id="nav-s${id}-dot"></div>
      <span>Screen ${id}</span>
    </div>
  `).join('');
  links.innerHTML = ['1', '2', '3', '4'].map(id =>
    `<a class="sidebar-btn" id="sidebar-open-screen-${id}" href="/screen.html?screen=${id}" target="_blank">Open Screen ${id}</a>`
  ).join('');

  _bindPlaylistSelects();
}

function _screenCardHtml(id) {
  return `
    <div class="screen-card" id="screen-card-${id}">
      <div class="screen-card-header">
        <span class="screen-num s${id}">${id}</span>
        <div>
          <div class="screen-card-name">Screen ${id}</div>
          <div class="screen-card-meta" id="s${id}-layout-meta">–</div>
        </div>
        <div class="screen-status-badge" id="s${id}-status-badge">Offline</div>
      </div>
      <div class="screen-card-body">
        <div class="playlist-assign-box">
          <div class="playlist-assign-label">Playlist</div>
          <div class="playlist-assign-row">
            <select id="sc-s${id}-playlist"><option value="">— None (photo-only mode) —</option></select>
          </div>
          <div class="playlist-none-hint" id="s${id}-playlist-hint" style="display:none">
            No playlist assigned. Slides won't play on this screen.
          </div>
        </div>

        <div class="screen-stats-grid">
          <div class="screen-stat">
            <div class="screen-stat-label">Last seen</div>
            <div class="screen-stat-value" id="s${id}-seen">–</div>
          </div>
          <div class="screen-stat">
            <div class="screen-stat-label">Layout</div>
            <div class="screen-stat-value" id="s${id}-layout">–</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function _applyScreenCount(n) {
  const count = Math.max(1, Math.min(4, Number(n) || 2));
  config.screenCount = count;
  for (let i = 1; i <= count; i++) {
    const id = String(i);
    if (!config.screens[id]) config.screens[id] = {};
  }

  for (let i = 1; i <= 4; i++) {
    const show = i <= count;
    const id = String(i);
    const card = document.getElementById(`screen-card-${id}`);
    const chip = document.getElementById(`nav-s${id}-chip`);
    const link = document.getElementById(`sidebar-open-screen-${id}`);
    if (card) card.style.display = show ? '' : 'none';
    if (chip) chip.style.display = show ? '' : 'none';
    if (link) link.style.display = show ? '' : 'none';
  }

  _refreshPlaylistSelects();
  ovRefresh();
}

// ---------------------------------------------------------------------------
// Slides / Playlists
// ---------------------------------------------------------------------------

async function doLoadSlides() {
  try {
    const [slides, playlists] = await Promise.all([loadSlides(), loadPlaylists()]);
    _playlists = playlists || [];
    refreshSlides(slides, _playlists);
    _refreshPlaylistSelects();
  } catch (err) {
    // silent — WS slides_update is the primary path
  }
}

// ---------------------------------------------------------------------------
// Stats / health
// ---------------------------------------------------------------------------

async function doLoadStats() {
  try {
    const stats = await loadStats();
    _renderHealth(stats);
    const groups = extractGroups(stats);
    quickUpdateGroups(groups);
    advUpdateGroups(groups);
    photosUpdateGroups(groups);
  } catch (err) {
    // silent — WS health_update is the primary path
  }
}

// Render health into the NEW DOM structure (screens page + nav dots)
function _renderHealth(stats) {
  if (!stats) return;
  const photos  = stats.photos  || {};
  const cache   = stats.cache   || {};
  const screens = stats.screens || [];

  // Stat boxes
  _setText('health-total',     photos.total         ?? 0);
  _setText('health-ready',     photos.ready         ?? 0);
  _setText('health-queued',    cache.queueDepth      ?? 0);
  _setText('health-new',       photos.addedLastHour  ?? 0);

  // Cache bar
  const pct = cache.coveragePct ?? 100;
  const bar = document.getElementById('health-cache-bar');
  if (bar) { bar.value = pct; bar.title = `${pct}% cached`; }
  _setText('health-cache-pct', `${pct}%`);

  // Groups card (Screens page)
  const groupList = document.getElementById('health-groups');
  if (groupList) {
    const groups  = photos.groups || {};
    const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    groupList.innerHTML = entries.map(([name, count]) =>
      `<div class="group-row"><span class="group-name">${_esc(name)}</span><span class="group-count">${count}</span></div>`
    ).join('') || '<div class="muted" style="font-size:12px">No groups detected.</div>';
  }

  // Per-screen data — render all known screens dynamically
  const knownIds = new Set(screens.map(s => s.screenId));
  for (const id of Array.from({ length: config.screenCount || 2 }, (_, i) => String(i + 1))) {
    knownIds.add(id);
  }
  for (const id of [...knownIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const data   = screens.find(s => s.screenId === id);
    const prefix = `s${id}`;
    _renderScreenHealth(prefix, data);
  }
}

function _renderScreenHealth(prefix, data) {
  // Nav dot + chip
  const dot  = document.getElementById(`nav-${prefix}-dot`);
  const chip = document.getElementById(`nav-${prefix}-chip`);
  // Screen card elements
  const badge = document.getElementById(`${prefix}-status-badge`);
  const seen  = document.getElementById(`${prefix}-seen`);
  const layout = document.getElementById(`${prefix}-layout`);
  const layoutMeta = document.getElementById(`${prefix}-layout-meta`);

  const online = data?.connected && (data.heartbeatAgeMs == null || data.heartbeatAgeMs < 6000);

  if (dot)  { dot.className  = 'status-dot' + (online ? ' online' : ''); }
  if (chip) { chip.className = 'nav-screen-chip' + (online ? ' online' : ''); }

  if (badge) {
    badge.textContent = online ? 'Online' : 'Offline';
    badge.className   = 'screen-status-badge' + (online ? ' online' : '');
  }

  const agoText = data ? _fmtAgo(data.heartbeatAgeMs) : '–';
  const layoutText = data?.layoutType || '–';

  if (seen)       seen.textContent       = agoText;
  if (layout)     layout.textContent     = layoutText;
  if (layoutMeta) layoutMeta.textContent = layoutText;
}

// ---------------------------------------------------------------------------
// Page routing
// ---------------------------------------------------------------------------

const PAGE_TITLES = {
  screens:   'Screens',
  playlists: 'Playlists',
  content:   'Content',
  photos:    'Photos',
  overlays:  'Overlays',
  advanced:  'Advanced',
  settings:  'Settings',
};

function setPage(page) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.dataset.page === page);
  });

  // Update save-bar title
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = PAGE_TITLES[page] || page;

  // Show/hide Safe Fallback button (Advanced page only)
  const fallbackBtn = document.getElementById('btn-fallback');
  if (fallbackBtn) fallbackBtn.style.display = page === 'advanced' ? '' : 'none';

  // Lazy-load page data
  if (page === 'photos')    refreshPhotos();
  if (page === 'playlists' || page === 'content') doLoadSlides();
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws    = new WebSocket(`${proto}://${location.host}`);

  ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'health_update' && msg.stats) {
      _renderHealth(msg.stats);
      const groups = extractGroups(msg.stats);
      quickUpdateGroups(groups);
      advUpdateGroups(groups);
      photosUpdateGroups(groups);
      return;
    }

    if (msg.type === 'new_photo' && msg.photo) {
      onNewPhoto(msg.photo);
      return;
    }

    if (msg.type === 'remove_photo') {
      onRemovePhoto(msg.id);
      doLoadStats();
      return;
    }

    if (msg.type === 'photo_update' && msg.photo) {
      onPhotoUpdate(msg.photo);
      return;
    }

    if (msg.type === 'slides_update' && msg.slides) {
      refreshSlides(msg.slides, null);
      return;
    }

    if (msg.type === 'playlists_update' && msg.playlists) {
      _playlists = msg.playlists || [];
      refreshSlides(null, _playlists);
      _refreshPlaylistSelects();
      return;
    }

    if (msg.type === 'config_update' && msg.config) {
      // Server sends back the sanitized config after a save — sync admin state
      // to reflect any clamped/corrected values without overwriting pending changes.
      if (!pendingChanges) {
        config = _normalizeConfig(msg.config);
        _renderScreenUi();
        _applyScreenCount(config.screenCount || 2);
        quickRefresh();
        advRefresh();
        ovRefresh();
        settingsRefresh();
        _refreshPlaylistSelects();
        _updateScreenHints();
        _populateThemeSelect();
      }
      return;
    }
  };

  ws.onclose = ws.onerror = () => {
    setTimeout(connectWs, 3000 + Math.random() * 1000);
  };

  window._adminWs = ws;
}

// ---------------------------------------------------------------------------
// Button wiring
// ---------------------------------------------------------------------------

function bindButtons() {
  document.getElementById('btn-save')?.addEventListener('click', doSaveConfig);
  document.getElementById('btn-revert')?.addEventListener('click', doLoadConfig);

  document.getElementById('btn-fallback')?.addEventListener('click', () => {
    applySafeFallback(getConfig, onChanged);
    quickRefresh();
    advRefresh();
    showToast('Safe fallback loaded — click Save & Apply');
  });

  document.getElementById('btn-reload-screens')?.addEventListener('click', () => {
    if (!window._adminWs || window._adminWs.readyState !== 1) {
      showToast('Not connected', true);
      return;
    }
    window._adminWs.send(JSON.stringify({ type: 'admin_reload_screens' }));
    showToast('Reloading screens…');
  });

  document.getElementById('btn-new-playlist')?.addEventListener('click', async () => {
    await createNewPlaylist();
    doLoadSlides();
  });

  // Nav items
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => setPage(btn.dataset.page));
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _normalizeConfig(raw) {
  const next = raw && typeof raw === 'object' ? raw : {};
  if (!next.screens || typeof next.screens !== 'object') next.screens = {};
  const count = Math.max(1, Math.min(4, Number(next.screenCount || 2)));
  next.screenCount = count;
  for (let i = 1; i <= count; i++) {
    const id = String(i);
    if (!next.screens[id]) next.screens[id] = {};
  }
  return next;
}

function _activeScreenIds() {
  const count = Math.max(1, Math.min(4, Number(config?.screenCount || 2)));
  const ids = Object.keys(config?.screens || {})
    .filter(id => Number(id) >= 1 && Number(id) <= 4)
    .sort((a, b) => Number(a) - Number(b));
  for (let i = 1; i <= count; i++) {
    const id = String(i);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, count).sort((a, b) => Number(a) - Number(b));
}

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _fmtAgo(ms) {
  if (ms == null) return '–';
  if (ms < 2000)  return 'just now';
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60000)}m ago`;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  window._applyScreenCount = _applyScreenCount;

  initQuickTab(getConfig, onChanged);
  initAdvancedTab(getConfig, onChanged);
  initPhotosTab(doLoadStats);
  initSlidesTab(getConfig, onChanged);
  initOverlaysTab(getConfig, onChanged);
  initSettingsTab(getConfig, onChanged);

  _bindThemeSelect();
  bindButtons();
  connectWs();

  await doLoadConfig();
  await doLoadStats();
  await doLoadSlides();
  await doLoadThemes();

  // Fallback polling
  setInterval(doLoadStats, 30_000);
}

boot();
