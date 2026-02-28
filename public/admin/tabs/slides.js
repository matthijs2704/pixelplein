// Admin tab: Slides — slide library management and playlist editor

import { icon } from '/shared/icons.js';
import { esc as _esc } from '/shared/utils.js';
import { showToast as _showToast } from '../app.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _slides     = [];
let _playlists  = [];
let _getConfig  = null;
let _onChanged  = null;
let _activePlId = null; // currently selected playlist in editor

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return list of screen names (e.g. ['Screen 1']) that currently use playlistId. */
function _usedByScreens(plId) {
  if (!_getConfig) return [];
  const cfg = _getConfig();
  const used = [];
  for (const [id, screenCfg] of Object.entries(cfg?.screens || {})) {
    if (screenCfg?.playlistId === plId) used.push(`S${id}`);
  }
  return used;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initSlidesTab(getConfig, onChanged) {
  _getConfig = getConfig;
  _onChanged = onChanged;
  _bindUpload();
}

export function refreshSlides(slides, playlists) {
  if (slides    !== null) _slides    = slides    || [];
  if (playlists !== null) _playlists = playlists || [];
  _renderLibrary();
  _renderPlaylistList();
  // Re-render editor for the active playlist (data may have changed)
  if (_activePlId) {
    const pl = _playlists.find(p => p.id === _activePlId);
    _renderPlaylistEditor(pl || null);
  }
}

// ---------------------------------------------------------------------------
// Slide library
// ---------------------------------------------------------------------------

function _renderLibrary() {
  const grid = document.getElementById('slides-library-grid');
  if (!grid) return;

  if (!_slides.length) {
    grid.innerHTML = '<div class="slides-empty">No slides yet. Create one above.</div>';
    return;
  }

  grid.innerHTML = '';
  for (const slide of _slides) {
    grid.appendChild(_makeSlideCard(slide));
  }
}

function _makeSlideCard(slide) {
  const card = document.createElement('div');
  card.className = 'slide-card' + (slide.enabled === false ? ' slide-disabled' : '');
  card.dataset.id = slide.id;

  const typeIconMap = {
    video:       icon('play'),
    'text-card': icon('document-text'),
    qr:          icon('qr-code'),
    webpage:     icon('globe-alt'),
    image:       icon('photo'),
    article:     icon('document-text'),
  };
  const typeIcon = typeIconMap[slide.type] || icon('document');
  const label    = _esc(slide.label || slide.filename || slide.title || slide.url || '(untitled)');

  card.innerHTML = `
    <div class="slide-card-header">
      <span class="slide-type-badge slide-type-${slide.type}">${typeIcon} ${slide.type}</span>
      <div class="slide-card-actions">
        <button class="sc-btn sc-btn-playsoon" title="Play Soon" onclick="slidesPlaySoon('${slide.id}')">${icon('play')} soon</button>
        <button class="sc-btn sc-btn-edit" onclick="slidesEditSlide('${slide.id}')">Edit</button>
        <button class="sc-btn sc-btn-del"  onclick="slidesDeleteSlide('${slide.id}')">${icon('x-mark')}</button>
      </div>
    </div>
    <div class="slide-card-label">${label}</div>
    ${slide.enabled === false ? '<div class="slide-disabled-tag">disabled</div>' : ''}
    ${slide._missing          ? '<div class="slide-missing-tag">file missing</div>' : ''}
  `;
  return card;
}

// ---------------------------------------------------------------------------
// Create slide
// ---------------------------------------------------------------------------

function _bindUpload() {
  document.getElementById('slides-create-btn')?.addEventListener('click', () => {
    const type = document.getElementById('slides-create-type')?.value;
    if (!type) return;
    if (type === 'video') {
      document.getElementById('slides-video-input')?.click();
    } else if (type === 'image') {
      document.getElementById('slides-image-input')?.click();
    } else {
      _createSlide(type, {});
    }
  });

  const videoInput = document.getElementById('slides-video-input');
  videoInput?.addEventListener('change', async () => {
    const file = videoInput.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('video', file);
    const status = document.getElementById('slides-video-status');
    if (status) status.textContent = 'Uploading…';
    try {
      const res  = await fetch('/api/slides/upload-video', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      if (status) status.textContent = `Uploaded: ${data.label}`;
      videoInput.value = '';
      slidesEditSlide(data.id);
    } catch (err) {
      if (status) status.textContent = `Error: ${err.message}`;
    }
  });

  const imageInput = document.getElementById('slides-image-input');
  imageInput?.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    const status = document.getElementById('slides-video-status');
    if (status) status.textContent = 'Uploading…';
    try {
      const res  = await fetch('/api/slides/upload-image', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      if (status) status.textContent = `Uploaded: ${data.label}`;
      imageInput.value = '';
      slidesEditSlide(data.id);
    } catch (err) {
      if (status) status.textContent = `Error: ${err.message}`;
    }
  });
}

async function _createSlide(type, extra) {
  const body = { type, label: `New ${type}`, enabled: true, ...extra };
  try {
    const res = await fetch('/api/slides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    const slide = await res.json();
    slidesEditSlide(slide.id);
  } catch (err) {
    _showToast(`Create failed: ${err.message}`, true);
  }
}

// ---------------------------------------------------------------------------
// Edit slide modal
// ---------------------------------------------------------------------------

window.slidesEditSlide = function(id) {
  const slide = _slides.find(s => s.id === id);
  if (!slide) return;

  const modal = document.getElementById('slides-modal');
  const body  = document.getElementById('slides-modal-body');
  if (!modal || !body) return;

  body.innerHTML = _buildSlideForm(slide);
  modal.classList.add('open');

  // Wire re-upload button for image slides
  if (slide.type === 'image') {
    document.getElementById('sf-reupload-btn')?.addEventListener('click', () => {
      document.getElementById('sf-reupload-input')?.click();
    });
    document.getElementById('sf-reupload-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('image', file);
      const status = document.getElementById('sf-reupload-status');
      if (status) status.textContent = 'Uploading…';
      try {
        // Upload as a new file, then update this slide's filename
        const res  = await fetch('/api/slides/upload-image', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        // We got a new slide created by upload — use its filename but delete that stub
        const newFilename = data.filename;
        // Patch the current slide with the new filename
        await fetch(`/api/slides/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: newFilename }),
        });
        // Delete the stub slide created by upload
        await fetch(`/api/slides/${data.id}`, { method: 'DELETE' });
        if (status) status.textContent = `Updated: ${newFilename}`;
        // Refresh the filename input and preview
        const filenameEl = document.getElementById('sf-filename');
        if (filenameEl) filenameEl.value = newFilename;
      } catch (err) {
        if (status) status.textContent = `Error: ${err.message}`;
      }
    });
  }

  // Wire upload button for article slides
  if (slide.type === 'article') {
    document.getElementById('sf-article-upload-btn')?.addEventListener('click', () => {
      document.getElementById('sf-article-upload-input')?.click();
    });
    document.getElementById('sf-article-upload-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('image', file);
      const status = document.getElementById('sf-article-upload-status');
      if (status) status.textContent = 'Uploading…';
      try {
        const res  = await fetch('/api/slides/upload-article-image', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        if (status) status.textContent = `Uploaded: ${data.filename}`;
        const filenameEl = document.getElementById('sf-image-filename');
        if (filenameEl) filenameEl.value = data.filename;
      } catch (err) {
        if (status) status.textContent = `Error: ${err.message}`;
      }
    });
  }

  // Replace listeners each time to avoid duplicates
  const saveBtn   = document.getElementById('slides-modal-save');
  const cancelBtn = document.getElementById('slides-modal-cancel');

  const newSave   = saveBtn.cloneNode(true);
  const newCancel = cancelBtn.cloneNode(true);
  saveBtn.replaceWith(newSave);
  cancelBtn.replaceWith(newCancel);

  newSave.addEventListener('click', async () => {
    const patch = _readSlideForm(slide.type);
    try {
      const res = await fetch(`/api/slides/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      modal.classList.remove('open');
    } catch (err) {
      _showToast(`Save failed: ${err.message}`, true);
    }
  });

  newCancel.addEventListener('click', () => modal.classList.remove('open'));
};

function _buildSlideForm(slide) {
  const common = `
    <div class="sf-field">
      <label>Label</label>
      <input id="sf-label" type="text" value="${_esc(slide.label || '')}">
    </div>
    <div class="sf-field">
      <label><input id="sf-enabled" type="checkbox" ${slide.enabled !== false ? 'checked' : ''}> Enabled</label>
    </div>
  `;

  if (slide.type === 'video') return common + `
    <div class="sf-field">
      <label>Filename</label>
      <input id="sf-filename" type="text" value="${_esc(slide.filename || '')}" readonly>
    </div>
    <div class="sf-field">
      <label><input id="sf-muted" type="checkbox" ${slide.muted !== false ? 'checked' : ''}> Muted</label>
    </div>
    <div class="sf-field">
      <label>Play count (0 = loop)</label>
      <input id="sf-playcount" type="number" min="0" max="10" value="${slide.playCount ?? 1}">
    </div>
  `;

  if (slide.type === 'text-card') return common + `
    <div class="sf-field">
      <label>Template</label>
      <select id="sf-template">
        ${['dark-center','light-left','gradient','minimal'].map(t =>
          `<option value="${t}" ${slide.template === t ? 'selected' : ''}>${t}</option>`
        ).join('')}
      </select>
    </div>
    <div class="sf-field"><label>Title</label><input id="sf-title" type="text" value="${_esc(slide.title || '')}"></div>
    <div class="sf-field"><label>Body</label><textarea id="sf-body" rows="3">${_esc(slide.body || '')}</textarea></div>
    <div class="sf-field"><label>Bg color (optional)</label><input id="sf-bgcolor" type="text" value="${_esc(slide.bgColor || '')}" placeholder="#rrggbb or CSS"></div>
    <div class="sf-field"><label>Duration (sec)</label><input id="sf-duration" type="number" min="3" max="300" value="${slide.durationSec ?? 10}"></div>
  `;

  if (slide.type === 'qr') return common + `
    <div class="sf-field"><label>Title (optional)</label><input id="sf-title" type="text" value="${_esc(slide.title || '')}" placeholder="Shown above the QR code"></div>
    <div class="sf-field"><label>URL</label><input id="sf-url" type="text" value="${_esc(slide.url || '')}"></div>
    <div class="sf-field"><label>Caption</label><input id="sf-caption" type="text" value="${_esc(slide.caption || '')}"></div>
    <div class="sf-field"><label>Duration (sec)</label><input id="sf-duration" type="number" min="3" max="300" value="${slide.durationSec ?? 10}"></div>
  `;

  if (slide.type === 'webpage') return common + `
    <div class="sf-field"><label>URL or path</label><input id="sf-src" type="text" value="${_esc(slide.src || '')}"></div>
    <div class="sf-field"><label>Duration (sec)</label><input id="sf-duration" type="number" min="3" max="300" value="${slide.durationSec ?? 15}"></div>
  `;

  if (slide.type === 'image') {
    const previewSrc = slide.filename
      ? `/slide-assets/images/${encodeURIComponent(slide.filename)}`
      : '';
    const preview = previewSrc
      ? `<div style="margin-top:6px;border-radius:6px;overflow:hidden;background:#111;max-height:180px;display:flex;align-items:center;justify-content:center;">
           <img src="${_esc(previewSrc)}" alt="preview" style="max-width:100%;max-height:180px;object-fit:contain;">
         </div>`
      : '';
    return common + `
    <div class="sf-field">
      <label>Image file</label>
      <input id="sf-filename" type="text" value="${_esc(slide.filename || '')}" readonly placeholder="Upload an image to set this">
      ${preview}
      <div style="margin-top:6px;display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-secondary btn-sm" id="sf-reupload-btn">Replace image…</button>
        <input type="file" id="sf-reupload-input" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" style="display:none">
        <span id="sf-reupload-status" style="font-size:11px;color:var(--muted)"></span>
      </div>
    </div>
    <div class="sf-field">
      <label>Display mode</label>
      <select id="sf-fit">
        ${[['contain','Contain (letterbox, full image visible)'],['cover','Cover (fill screen, may crop)'],['kenburns','Ken Burns (slow zoom, covers screen)']].map(([v,l]) =>
          `<option value="${v}" ${(slide.fit||'contain') === v ? 'selected' : ''}>${l}</option>`
        ).join('')}
      </select>
    </div>
    <div class="sf-field"><label>Duration (sec)</label><input id="sf-duration" type="number" min="3" max="300" value="${slide.durationSec ?? 10}"></div>
  `;
  }

  if (slide.type === 'article') {
    const previewSrc = slide.imageFilename
      ? `/slide-assets/images/${encodeURIComponent(slide.imageFilename)}`
      : '';
    const preview = previewSrc
      ? `<div style="margin-top:6px;border-radius:6px;overflow:hidden;background:#111;max-height:140px;display:flex;align-items:center;justify-content:center;">
           <img src="${_esc(previewSrc)}" alt="preview" style="max-width:100%;max-height:140px;object-fit:contain;">
         </div>`
      : '';
    return common + `
    <div class="sf-field">
      <label>Layout</label>
      <select id="sf-layout">
        ${[['image-left','Image left + text right'],['image-top','Image top + text below'],['image-bg','Image as full background']].map(([v,l]) =>
          `<option value="${v}" ${(slide.layout||'image-left')===v?'selected':''}>${l}</option>`
        ).join('')}
      </select>
    </div>
    <div class="sf-field"><label>Title</label><input id="sf-title" type="text" value="${_esc(slide.title || '')}"></div>
    <div class="sf-field"><label>Body text</label><textarea id="sf-body" rows="3">${_esc(slide.body || '')}</textarea></div>
    <div class="sf-field">
      <label>Image source</label>
      <select id="sf-image-source" onchange="
        document.getElementById('sf-upload-row').style.display = this.value==='upload' ? '' : 'none';
      ">
        <option value="upload" ${(slide.imageSource||'upload')==='upload'?'selected':''}>Uploaded image</option>
        <option value="pool"   ${slide.imageSource==='pool'?'selected':''}>Random event photo</option>
      </select>
    </div>
    <div id="sf-upload-row" style="${(slide.imageSource||'upload')==='upload'?'':'display:none'}">
      <div class="sf-field">
        <label>Image file</label>
        <input id="sf-image-filename" type="text" value="${_esc(slide.imageFilename || '')}" readonly placeholder="Upload an image below">
        ${preview}
        <div style="margin-top:6px;display:flex;gap:8px;align-items:center">
          <button type="button" class="btn btn-secondary btn-sm" id="sf-article-upload-btn">Upload image…</button>
          <input type="file" id="sf-article-upload-input" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" style="display:none">
          <span id="sf-article-upload-status" style="font-size:11px;color:var(--muted)"></span>
        </div>
      </div>
    </div>
    <div class="sf-field"><label>Bg color (optional)</label><input id="sf-bgcolor" type="text" value="${_esc(slide.bgColor || '')}" placeholder="#rrggbb or CSS"></div>
    <div class="sf-field"><label>Duration (sec)</label><input id="sf-duration" type="number" min="3" max="300" value="${slide.durationSec ?? 12}"></div>
  `;
  }

  return common;
}

function _readSlideForm(type) {
  const g = id => document.getElementById(id);
  const patch = {
    label:   g('sf-label')?.value   || '',
    enabled: g('sf-enabled')?.checked ?? true,
  };
  if (type === 'video') {
    patch.muted      = g('sf-muted')?.checked ?? true;
    patch.playCount  = parseInt(g('sf-playcount')?.value || '1', 10);
  }
  if (type === 'text-card') {
    patch.template    = g('sf-template')?.value || 'dark-center';
    patch.title       = g('sf-title')?.value    || '';
    patch.body        = g('sf-body')?.value     || '';
    patch.bgColor     = g('sf-bgcolor')?.value  || '';
    patch.durationSec = parseInt(g('sf-duration')?.value || '10', 10);
  }
  if (type === 'qr') {
    patch.title       = g('sf-title')?.value   || '';
    patch.url         = g('sf-url')?.value     || '';
    patch.caption     = g('sf-caption')?.value || '';
    patch.durationSec = parseInt(g('sf-duration')?.value || '10', 10);
  }
  if (type === 'webpage') {
    patch.src         = g('sf-src')?.value || '';
    patch.durationSec = parseInt(g('sf-duration')?.value || '15', 10);
  }
  if (type === 'image') {
    patch.fit         = g('sf-fit')?.value || 'contain';
    patch.durationSec = parseInt(g('sf-duration')?.value || '10', 10);
    // filename is read-only (managed via upload), don't overwrite unless changed
    const filenameEl = g('sf-filename');
    if (filenameEl?.value) patch.filename = filenameEl.value;
  }
  if (type === 'article') {
    patch.layout        = g('sf-layout')?.value        || 'image-left';
    patch.title         = g('sf-title')?.value         || '';
    patch.body          = g('sf-body')?.value          || '';
    patch.imageSource   = g('sf-image-source')?.value  || 'upload';
    patch.bgColor       = g('sf-bgcolor')?.value       || '';
    patch.durationSec   = parseInt(g('sf-duration')?.value || '12', 10);
    const imgFilename   = g('sf-image-filename');
    if (imgFilename?.value) patch.imageFilename = imgFilename.value;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Delete / play-soon
// ---------------------------------------------------------------------------

window.slidesDeleteSlide = async function(id) {
  if (!confirm('Delete this slide? It will also be removed from all playlists.')) return;
  try {
    const res = await fetch(`/api/slides/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
  } catch (err) {
    _showToast(`Delete failed: ${err.message}`, true);
  }
};

window.slidesPlaySoon = async function(id) {
  try {
    const res = await fetch(`/api/slides/play-soon/${id}`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error);
    _showToast('Play-soon triggered');
  } catch (err) {
    _showToast(`Error: ${err.message}`, true);
  }
};

// ---------------------------------------------------------------------------
// Playlist list (compact chips at top of right panel)
// ---------------------------------------------------------------------------

function _renderPlaylistList() {
  const container = document.getElementById('playlists-list');
  if (!container) return;

  container.innerHTML = '';

    if (!_playlists.length) {
    container.innerHTML = '<div class="empty-state"><span class="empty-state-icon">▶</span><span>No playlists yet.</span></div>';
    _renderPlaylistEditor(null);
    return;
  }

  for (const pl of _playlists) {
    const item = document.createElement('div');
    item.className = 'pl-chip' + (pl.id === _activePlId ? ' active' : '');
    item.dataset.id = pl.id;

    const usedBy    = _usedByScreens(pl.id);
    const syncBadge = pl.coordinated
      ? `<span class="pl-badge-sync" title="Coordinated — both screens sync">${icon('arrows-right-left', 'icon-xs')} sync</span>`
      : '';
    const usedBadge = usedBy.length
      ? `<span class="pl-badge-sync" title="Used by ${usedBy.join(', ')}" style="background:rgba(62,207,142,0.1);color:var(--green);border-color:rgba(62,207,142,0.3)">${usedBy.join(' ')}</span>`
      : '';
    item.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">
        <div style="display:flex;align-items:center;gap:5px;min-width:0">
          <span class="pl-chip-name">${_esc(pl.name)}</span>
          <div class="pl-chip-badges">${syncBadge}${usedBadge}</div>
        </div>
      </div>
      <span class="pl-chip-count">${pl.slideIds.length} slide${pl.slideIds.length !== 1 ? 's' : ''}</span>
    `;

    item.addEventListener('click', () => {
      _activePlId = pl.id;
      _renderPlaylistList();
      _renderPlaylistEditor(pl);
    });
    container.appendChild(item);
  }

  // Auto-select first if nothing selected
  if (!_activePlId || !_playlists.find(p => p.id === _activePlId)) {
    _activePlId = _playlists[0].id;
  }
  const active = _playlists.find(p => p.id === _activePlId) || _playlists[0];
  _renderPlaylistEditor(active);
}

// ---------------------------------------------------------------------------
// Playlist editor (side-by-side: left = library, right = in playlist)
// ---------------------------------------------------------------------------

function _renderPlaylistEditor(pl) {
  const editor = document.getElementById('playlist-editor');
  if (!editor) return;

  if (!pl) {
    editor.innerHTML = '<div class="slides-empty" style="padding:16px">Select or create a playlist.</div>';
    return;
  }

  const inPlaylist = pl.slideIds.map(id => _slides.find(s => s.id === id)).filter(Boolean);
  const notIn      = _slides.filter(s => !pl.slideIds.includes(s.id));

  editor.innerHTML = `
    <div class="pl-editor-top">
      <div class="pl-editor-name-row">
        <input id="pl-name" type="text" class="pl-name-input" value="${_esc(pl.name)}" placeholder="Playlist name">
        <button class="btn btn-primary btn-sm" id="pl-save-btn">Save</button>
        <button class="btn btn-danger btn-sm"  id="pl-delete-btn">Delete</button>
      </div>
      <div class="pl-meta-row">
        <div class="pl-meta-group">
          <span>Interleave every</span>
          <input id="pl-interleave" type="number" min="0" max="99" value="${pl.interleaveEvery ?? 5}">
          <span>photo cycles</span>
        </div>
        <label class="pl-coord-toggle" title="When enabled, both screens wait for each other before advancing">
          <input id="pl-coordinated" type="checkbox" ${pl.coordinated ? 'checked' : ''}>
          sync screens
        </label>
      </div>
    </div>

    <div class="pl-body-split">
      <!-- Left: slides in this playlist -->
      <div class="pl-col">
        <div class="pl-col-head">
          In playlist <span class="pl-col-cnt">${inPlaylist.length}</span>
        </div>
        <div id="pl-in-list" class="pl-slide-list">
          ${inPlaylist.length ? inPlaylist.map(s => `
            <div class="pl-slide-item" draggable="true" data-id="${s.id}">
              <span class="pl-drag-handle" title="Drag to reorder">${icon('bars-3')}</span>
              <span class="slide-type-badge slide-type-${s.type} pl-item-badge">${s.type}</span>
              <span class="pl-slide-name">${_esc(s.label || s.filename || s.title || s.url || s.type)}</span>
              <button class="sc-btn sc-btn-del pl-remove-btn" data-pl="${pl.id}" data-slide="${s.id}">${icon('x-mark')}</button>
            </div>
          `).join('') : '<div class="empty-state" style="padding:20px 12px;font-size:12px">No slides in this playlist yet.</div>'}
        </div>
      </div>

      <!-- Right: library -->
      <div class="pl-col">
        <div class="pl-col-head">
          Add from library <span class="pl-col-cnt">${notIn.length}</span>
        </div>
        <div id="pl-avail-list" class="pl-slide-list">
          ${notIn.length ? notIn.map(s => `
            <div class="pl-slide-item" data-id="${s.id}">
              <span class="slide-type-badge slide-type-${s.type} pl-item-badge">${s.type}</span>
              <span class="pl-slide-name">${_esc(s.label || s.filename || s.title || s.url || s.type)}</span>
              <button class="sc-btn sc-btn-edit pl-add-btn" data-pl="${pl.id}" data-slide="${s.id}">+ Add</button>
            </div>
          `).join('') : '<div class="empty-state" style="padding:20px 12px;font-size:12px">All slides are in this playlist.</div>'}
        </div>
      </div>
    </div>
  `;

  // Save meta
  document.getElementById('pl-save-btn')?.addEventListener('click', async () => {
    const name          = document.getElementById('pl-name')?.value.trim() || pl.name;
    const interleaveEvery = parseInt(document.getElementById('pl-interleave')?.value || '5', 10);
    const coordinated   = document.getElementById('pl-coordinated')?.checked ?? false;
    await _patchPlaylist(pl.id, { name, interleaveEvery, coordinated });
  });

  // Delete
  document.getElementById('pl-delete-btn')?.addEventListener('click', async () => {
    if (!confirm(`Delete playlist "${pl.name}"? This cannot be undone.`)) return;
    await _deletePlaylist(pl.id);
  });

  // Add buttons
  editor.querySelectorAll('.pl-add-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await _patchPlaylist(btn.dataset.pl, { slideIds: [...pl.slideIds, btn.dataset.slide] });
    });
  });

  // Remove buttons
  editor.querySelectorAll('.pl-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await _patchPlaylist(btn.dataset.pl, {
        slideIds: pl.slideIds.filter(id => id !== btn.dataset.slide),
      });
    });
  });

  // Drag-and-drop reorder
  _initDragReorder(document.getElementById('pl-in-list'), pl);
}

function _initDragReorder(list, pl) {
  if (!list) return;
  let dragged = null;

  list.querySelectorAll('.pl-slide-item[draggable]').forEach(item => {
    item.addEventListener('dragstart', () => { dragged = item; item.style.opacity = '0.4'; });
    item.addEventListener('dragend',   () => { dragged = null; item.style.opacity = ''; });
    item.addEventListener('dragover',  e => {
      e.preventDefault();
      if (dragged && dragged !== item) list.insertBefore(dragged, item);
    });
  });

  list.addEventListener('drop', async e => {
    e.preventDefault();
    const newOrder = [...list.querySelectorAll('.pl-slide-item[data-id]')].map(el => el.dataset.id);
    if (newOrder.length) await _patchPlaylist(pl.id, { slideIds: newOrder });
  });
}

// ---------------------------------------------------------------------------
// Playlist actions
// ---------------------------------------------------------------------------

async function _patchPlaylist(id, patch) {
  try {
    const res = await fetch(`/api/playlists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error((await res.json()).error);
  } catch (err) {
    _showToast(`Error: ${err.message}`, true);
  }
}

async function _deletePlaylist(id) {
  try {
    const res = await fetch(`/api/playlists/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    _activePlId = null;
  } catch (err) {
    _showToast(`Delete failed: ${err.message}`, true);
  }
}

export async function createNewPlaylist() {
  try {
    const res = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New playlist', interleaveEvery: 5, coordinated: false }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    const pl = await res.json();
    _activePlId = pl.id;
  } catch (err) {
    _showToast(`Error: ${err.message}`, true);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


