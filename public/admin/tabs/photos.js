// Photos tab: upload zone, thumbnail grid, delete/hero actions

import { loadPhotos, patchPhoto, deletePhoto, uploadFiles } from '../api.js';
import { icon } from '/shared/icons.js';

let _photos    = [];
let _filter    = 'all';
let _groups    = ['ungrouped'];
let _onReload  = null; // called after a delete so health stats refresh

/**
 * @param {Function} onReload - called after a photo is deleted
 */
export function initPhotosTab(onReload) {
  _onReload = onReload;
  _bindUploadZone();
  _bindFilter();
}

export function updateGroups(groups) {
  _groups = groups;
  _renderFilterBar();
}

export async function refreshPhotos() {
  try {
    _photos = await loadPhotos();
    _renderGrid();
  } catch (err) {
    console.warn('Photos load failed:', err.message);
  }
}

// Handle photo updates from WebSocket
export function onNewPhoto(photo) {
  const idx = _photos.findIndex(p => p.id === photo.id);
  if (idx >= 0) _photos[idx] = photo;
  else _photos.unshift(photo);
  _renderGrid();
}

export function onRemovePhoto(id) {
  _photos = _photos.filter(p => p.id !== id);
  _renderGrid();
}

export function onPhotoUpdate(photo) {
  const idx = _photos.findIndex(p => p.id === photo.id);
  if (idx >= 0) {
    _photos[idx] = photo;
    _renderGrid();
  }
}

// ---------------------------------------------------------------------------
// Upload zone
// ---------------------------------------------------------------------------

function _bindUploadZone() {
  const zone   = document.getElementById('upload-zone');
  const input  = document.getElementById('upload-input');
  const groupEl = document.getElementById('upload-group');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) _handleUpload(files, groupEl?.value?.trim());
  });

  input.addEventListener('change', () => {
    if (input.files.length) _handleUpload(input.files, groupEl?.value?.trim());
    input.value = '';
  });
}

async function _handleUpload(files, group) {
  const progressEl = document.getElementById('upload-progress');
  const statusEl   = document.getElementById('upload-status');

  if (progressEl) { progressEl.style.display = 'block'; progressEl.value = 0; }
  if (statusEl)   statusEl.textContent = `Uploading ${files.length} file(s)…`;

  try {
    const result = await uploadFiles(files, group, (loaded, total) => {
      if (progressEl) progressEl.value = loaded / total;
    });

    const ok  = result.uploaded?.length || 0;
    const err = result.errors?.length   || 0;
    if (statusEl) statusEl.textContent = err
      ? `${ok} uploaded, ${err} failed`
      : `${ok} photo(s) uploaded successfully`;
  } catch (err) {
    if (statusEl) statusEl.textContent = `Upload failed: ${err.message}`;
  } finally {
    if (progressEl) progressEl.style.display = 'none';
    // Photos will arrive via WebSocket new_photo events
  }
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function _bindFilter() {
  _renderFilterBar();
}

function _renderFilterBar() {
  const bar = document.getElementById('photos-filter-bar');
  if (!bar) return;

  const groups = ['all', ..._groups];
  bar.innerHTML = groups.map(g =>
    `<button class="filter-btn ${_filter === g ? 'active' : ''}" data-group="${esc(g)}">${esc(g === 'all' ? 'All' : g)}</button>`
  ).join('');

  bar.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _filter = btn.dataset.group;
      bar.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.group === _filter));
      _renderGrid();
    });
  });
}

// ---------------------------------------------------------------------------
// Photo grid
// ---------------------------------------------------------------------------

function _renderGrid() {
  const grid = document.getElementById('photos-grid');
  if (!grid) return;

  const filtered = _filter === 'all'
    ? _photos
    : _photos.filter(p => p.eventGroup === _filter);

  if (!filtered.length) {
    grid.innerHTML = `<div class="photos-empty">No photos${_filter !== 'all' ? ` in "${_filter}"` : ''}</div>`;
    return;
  }

  grid.innerHTML = filtered.map(photo => _renderPhotoCard(photo)).join('');

  // Bind actions
  grid.querySelectorAll('.photo-hero-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id   = btn.dataset.id;
      const cur  = btn.dataset.hero === 'true';
      btn.disabled = true;
      try {
        await patchPhoto(id, { heroCandidate: !cur });
        // Optimistic update
        const p = _photos.find(p => p.id === id);
        if (p) p.heroCandidate = !cur;
        _renderGrid();
      } catch (err) {
        btn.disabled = false;
        alert(`Failed to update photo: ${err.message}`);
      }
    });
  });

  grid.querySelectorAll('.photo-delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id   = btn.dataset.id;
      const name = btn.dataset.name;
      if (!confirm(`Permanently delete "${name}"?\n\nThis removes the file from disk and cannot be undone.`)) return;

      btn.disabled = true;
      try {
        await deletePhoto(id);
        // Will be removed from grid via remove_photo WS event, but also update locally
        _photos = _photos.filter(p => p.id !== id);
        _renderGrid();
        if (_onReload) _onReload();
      } catch (err) {
        btn.disabled = false;
        alert(`Delete failed: ${err.message}`);
      }
    });
  });
}

function _renderPhotoCard(photo) {
  const statusBadge = photo.status !== 'ready'
    ? `<span class="photo-status-badge status-${esc(photo.status)}">${esc(photo.status)}</span>`
    : '';
  const heroClass = photo.heroCandidate ? 'active' : '';
  const imgSrc    = photo.displayUrl || photo.url || '';

  return `
    <div class="photo-card" data-id="${esc(photo.id)}">
      <div class="photo-thumb">
        ${imgSrc
          ? `<img src="${esc(imgSrc)}" alt="${esc(photo.name)}" loading="lazy">`
          : `<div class="photo-thumb-placeholder">${esc(photo.status)}</div>`}
        ${statusBadge}
        <div class="photo-overlay">
          <button class="photo-hero-btn ${heroClass}" data-id="${esc(photo.id)}" data-hero="${photo.heroCandidate}"
            title="${photo.heroCandidate ? 'Remove hero candidate' : 'Mark as hero candidate'}">
            ${photo.heroCandidate ? icon('star-solid') : icon('star-outline')}
          </button>
          <button class="photo-delete-btn" data-id="${esc(photo.id)}" data-name="${esc(photo.name)}"
            title="Delete permanently">
            ${icon('trash')}
          </button>
        </div>
      </div>
      <div class="photo-info">
        <span class="photo-name">${esc(photo.name)}</span>
        <span class="photo-group">${esc(photo.eventGroup)}</span>
      </div>
    </div>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
