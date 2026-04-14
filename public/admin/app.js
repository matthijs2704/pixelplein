// Admin entry point: init, page routing, WebSocket, orchestration

import { loadConfig, saveConfig, loadStats, loadSlides, loadPlaylists, loadMe, logout } from './api.js';
import { extractGroups }                                                  from './health.js';
import { esc as _esc, fmtAgo as _fmtAgo, activeScreenIds as _activeScreenIds } from '/shared/utils.js';
import { initQuickTab, refreshFromConfig as quickRefresh, updateGroups as quickUpdateGroups } from './tabs/quick.js';
import { initAdvancedTab, refreshFromConfig as advRefresh, updateGroups as advUpdateGroups, applySafeFallback } from './tabs/advanced.js';
import { initPhotosTab, refreshPhotos, onNewPhoto, onRemovePhoto, onPhotoUpdate, updateGroups as photosUpdateGroups } from './tabs/photos.js';
import { initSlidesTab, refreshSlides, createNewPlaylist, onTranscodeProgress } from './tabs/slides.js';
import { initOverlaysTab, refreshFromConfig as ovRefresh } from './tabs/overlays.js';
import { initSettingsTab, refreshFromConfig as settingsRefresh } from './tabs/settings.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config         = { screens: {}, screenCount: 2 };
let _playlists     = [];
let pendingChanges = false;

/** @type {Object.<string, { filename: string, pct: number }>} */
let _transcodings  = {}; // slideId → { filename, pct }

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
// Auto-save (for quick control sliders)
// ---------------------------------------------------------------------------

let _autoSaveTimer = null;
export function scheduleAutoSave() {
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    doSaveConfig().catch(err => showToast(`Auto-save failed: ${err.message}`, true));
  }, 800);
}

// ---------------------------------------------------------------------------
// Confirm modal
// ---------------------------------------------------------------------------

export function showConfirm(title, body, okLabel = 'Delete') {
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-body').textContent  = body;
  document.getElementById('confirm-modal-ok').textContent    = okLabel;
  document.getElementById('confirm-modal').classList.add('open');
  return new Promise(resolve => {
    const ok     = document.getElementById('confirm-modal-ok');
    const cancel = document.getElementById('confirm-modal-cancel');
    function cleanup(result) {
      document.getElementById('confirm-modal').classList.remove('open');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    const onOk     = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onKey    = e => { if (e.key === 'Escape') cleanup(false); };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
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
      await saveConfig({ theme: themeId });
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
    refreshSlides(null, _playlists);
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
  for (const id of _activeScreenIds(config)) {
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
  for (const id of _activeScreenIds(config)) {
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
    <div class="screen-card compact" id="screen-card-${id}">
      <div class="screen-card-header">
        <div class="status-dot" id="s${id}-card-dot"></div>
        <span class="screen-num s${id}">${id}</span>
        <div class="screen-card-info">
          <span class="screen-card-layout" id="s${id}-layout">–</span>
          <span class="screen-card-sep">·</span>
          <span class="screen-card-seen" id="s${id}-seen">–</span>
        </div>
        <div class="screen-status-badge" id="s${id}-status-badge">Offline</div>
      </div>
      <div class="screen-card-compact-body">
        <div class="playlist-assign-row">
          <span class="playlist-assign-label">Playlist</span>
          <select id="sc-s${id}-playlist"><option value="">— None —</option></select>
        </div>
        <div class="playlist-none-hint" id="s${id}-playlist-hint" style="display:none">
          No playlist — slides won't play on this screen.
        </div>
        <div class="screen-card-meta" id="s${id}-layout-meta" style="display:none"></div>
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

// ---------------------------------------------------------------------------
// Transcoding progress
// ---------------------------------------------------------------------------

function _handleTranscodeProgress(msg) {
  const { slideId, filename, pct } = msg;
  if (!slideId) return;

  if (pct >= 100) {
    delete _transcodings[slideId];
  } else {
    _transcodings[slideId] = { filename: filename || slideId, pct: pct || 0 };
  }

  onTranscodeProgress(slideId, pct); // update slide card live
  _renderTranscodingSection();
}

function _renderTranscodingSection() {
  const section = document.getElementById('transcoding-section');
  const jobs    = document.getElementById('transcoding-jobs');
  if (!section || !jobs) return;

  const entries = Object.entries(_transcodings);
  section.style.display = entries.length ? '' : 'none';

  jobs.innerHTML = entries.map(([, job]) => `
    <div class="transcode-job">
      <div class="transcode-job-name">${_esc(job.filename)}</div>
      <div class="transcode-job-pct">${job.pct}%</div>
      <div class="transcode-job-track">
        <div class="transcode-job-fill" style="width:${job.pct}%"></div>
      </div>
    </div>
  `).join('');
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
  const cardDot = document.getElementById(`${prefix}-card-dot`);
  const badge = document.getElementById(`${prefix}-status-badge`);
  const seen  = document.getElementById(`${prefix}-seen`);
  const layout = document.getElementById(`${prefix}-layout`);
  const layoutMeta = document.getElementById(`${prefix}-layout-meta`);

  const online = data?.connected && (data.heartbeatAgeMs == null || data.heartbeatAgeMs < 6000);

  if (dot)     { dot.className     = 'status-dot' + (online ? ' online' : ''); }
  if (cardDot) { cardDot.className = 'status-dot' + (online ? ' online' : ''); }
  if (chip)    { chip.className    = 'nav-screen-chip' + (online ? ' online' : ''); }

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
  control:     'Control Room',
  slides:      'Slides',
  photos:      'Photos',
  signage:     'Signage',
  schedule:    'Schedule',
  submissions: 'Submissions',
  overlays:    'Overlays',
  display:     'Display',
  settings:    'Settings',
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

  // Show/hide Safe Fallback button (Display page only)
  const fallbackBtn = document.getElementById('btn-fallback');
  if (fallbackBtn) fallbackBtn.style.display = page === 'display' ? '' : 'none';

  // Show/hide save bar buttons on runtime-only pages
  const CONFIG_PAGES = new Set(['control', 'slides', 'overlays', 'signage', 'schedule', 'display', 'settings']);
  const saveBarBtns = document.getElementById('save-bar-buttons');
  if (saveBarBtns) saveBarBtns.style.display = CONFIG_PAGES.has(page) ? '' : 'none';
  if (!CONFIG_PAGES.has(page)) {
    const dirty = document.getElementById('save-dirty');
    if (dirty) dirty.style.display = 'none';
  }

  // Lazy-load page data
  if (page === 'photos') refreshPhotos();
  if (page === 'slides') doLoadSlides();
  if (page === 'signage' || page === 'schedule') window._loadAlertsAndSchedule?.().catch(() => {});
  if (page === 'submissions') window._loadSubmissions?.().catch(() => {});
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

let _ws = null; // module-level reference used by the reload-screens button

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws    = new WebSocket(`${proto}://${location.host}`);
  _ws = ws;

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

    if (msg.type === 'transcode_progress') {
      _handleTranscodeProgress(msg);
      return;
    }

    if (msg.type === 'slides_update' && msg.slides) {
      // Remove finished jobs from the dashboard transcoding section
      const transcodingIds = new Set(msg.slides.filter(s => s._transcoding).map(s => s.id));
      for (const id of Object.keys(_transcodings)) {
        if (!transcodingIds.has(id)) delete _transcodings[id];
      }
      _renderTranscodingSection();
      refreshSlides(msg.slides, null);
      return;
    }

    if (msg.type === 'playlists_update' && msg.playlists) {
      _playlists = msg.playlists || [];
      refreshSlides(null, _playlists);
      _refreshPlaylistSelects();
      return;
    }

    if (msg.type === 'alert_fire' || msg.type === 'alert_dismiss' || msg.type === 'schedule_update') {
      window._loadAlertsAndSchedule?.().catch(() => {});
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
        refreshSlides(null, _playlists);
        _updateScreenHints();
        _populateThemeSelect();
      }
      return;
    }
  };

  ws.onerror = () => {};  // 'close' always follows an error; handle there

  ws.onclose = () => {
    _ws = null;
    setTimeout(async () => {
      connectWs();
      // Re-fetch state that may have changed while disconnected
      await doLoadConfig();
      await doLoadStats();
      await doLoadSlides();
    }, 3000 + Math.random() * 1000);
  };
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
    if (!_ws || _ws.readyState !== 1) {
      showToast('Not connected', true);
      return;
    }
    _ws.send(JSON.stringify({ type: 'admin_reload_screens' }));
    showToast('Reloading screens…');
  });

  document.getElementById('btn-new-playlist')?.addEventListener('click', async () => {
    await createNewPlaylist();
    doLoadSlides();
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    try {
      await logout();
    } catch {}
    location.href = '/login.html';
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

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}



// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  try {
    const me = await loadMe();
    if (!me?.loggedIn) {
      location.href = '/login.html';
      return;
    }
  } catch {
    location.href = '/login.html';
    return;
  }

  window._applyScreenCount = _applyScreenCount;
  window._refreshScreenPlaylistSelects = _refreshPlaylistSelects;

  initQuickTab(getConfig, onChanged, scheduleAutoSave);
  initAdvancedTab(getConfig, onChanged);
  initPhotosTab(doLoadStats);
  initSlidesTab(getConfig, onChanged);
  initOverlaysTab(getConfig, onChanged);
  initSettingsTab(getConfig, onChanged);

  _bindThemeSelect();
  bindButtons();
  setPage('control');
  connectWs();

  await doLoadConfig();
  await doLoadStats();
  await doLoadSlides();
  await doLoadThemes();

  // Fallback polling
  setInterval(doLoadStats, 30_000);
}

boot();
