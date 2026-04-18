// Photos tab: upload zone, group filters, thumbnail grid, delete/hero actions

import { loadPhotos, patchPhoto, deletePhoto, deletePhotoGroup, uploadFiles } from '../api.js';
import { showConfirm, showImageModal, showToast } from '../app.js';
import { icon } from '/shared/icons.js';
import { esc } from '/shared/utils.js';

let _photos    = [];
let _filter    = 'all';
let _groups    = ['ungrouped'];
let _onReload  = null; // called after a delete so health stats refresh

function _sortPhotos() {
  _photos.sort((a, b) => {
    const byCapturedAt = (Number(b?.capturedAt) || 0) - (Number(a?.capturedAt) || 0);
    if (byCapturedAt !== 0) return byCapturedAt;

    const byAddedAt = (Number(b?.addedAt) || 0) - (Number(a?.addedAt) || 0);
    if (byAddedAt !== 0) return byAddedAt;

    const byProcessedAt = (Number(b?.processedAt) || 0) - (Number(a?.processedAt) || 0);
    if (byProcessedAt !== 0) return byProcessedAt;

    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

/**
 * @param {Function} onReload - called after a photo is deleted
 */
export function initPhotosTab(onReload) {
  _onReload = onReload;
  _bindUploadZone();
  _bindFilter();
  _bindGroupDelete();
}

export function updateGroups(groups) {
  _groups = groups;
  if (_filter !== 'all' && !_groups.includes(_filter)) _filter = 'all';
  _renderGroupDatalist();
  _renderFilterBar();
}

export async function refreshPhotos() {
  try {
    _photos = await loadPhotos();
    _sortPhotos();
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
  _sortPhotos();
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
    _sortPhotos();
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
  _renderGroupDatalist();
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
      _renderGroupDeleteButton();
      _renderGrid();
    });
  });

  _renderGroupDeleteButton();
}

function _renderGroupDatalist() {
  const datalist = document.getElementById('groups-datalist');
  if (!datalist) return;

  datalist.innerHTML = _groups
    .filter(group => group !== 'ungrouped')
    .map(group => `<option value="${esc(group)}"></option>`)
    .join('');
}

function _bindGroupDelete() {
  const btn = document.getElementById('photos-delete-group-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const group = btn.dataset.group || '';
    if (!group || group === 'all') return;

    const count = _photos.filter(photo => _photoGroup(photo) === group).length;
    const label = count === 1 ? 'photo' : 'photos';
    const ok = await showConfirm(
      'Delete group',
      `Delete group "${group}" and permanently remove ${count} ${label}? This cannot be undone.`,
      'Delete group',
    );
    if (!ok) return;

    btn.disabled = true;
    try {
      const result = await deletePhotoGroup(group);
      _photos = _photos.filter(photo => _photoGroup(photo) !== group);
      _sortPhotos();
      _groups = _deriveGroupsFromPhotos();
      if (_filter === group) _filter = 'all';
      _renderFilterBar();
      _renderGrid();
      if (_onReload) _onReload();
      showToast(`Deleted ${result?.deleted || count} photo(s) from "${group}"`);
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, true);
    } finally {
      btn.disabled = false;
      _renderGroupDeleteButton();
    }
  });
}

function _renderGroupDeleteButton() {
  const btn = document.getElementById('photos-delete-group-btn');
  if (!btn) return;

  const canDelete = _filter !== 'all' && _groups.includes(_filter);
  btn.style.display = canDelete ? '' : 'none';
  btn.disabled = false;
  btn.dataset.group = canDelete ? _filter : '';
  btn.textContent = canDelete ? `Delete "${_filter}"` : 'Delete group';
}

function _photoGroup(photo) {
  return photo?.eventGroup || 'ungrouped';
}

function _deriveGroupsFromPhotos() {
  const groups = [...new Set(_photos.map(_photoGroup))].sort((a, b) => a.localeCompare(b));
  return groups.length ? groups : ['ungrouped'];
}

// ---------------------------------------------------------------------------
// Photo grid
// ---------------------------------------------------------------------------

function _renderGrid() {
  const grid = document.getElementById('photos-grid');
  if (!grid) return;

  const filtered = _filter === 'all'
    ? _photos
    : _photos.filter(p => _photoGroup(p) === _filter);

  if (!filtered.length) {
    grid.innerHTML = `<div class="photos-empty">No photos${_filter !== 'all' ? ` in "${_filter}"` : ''}</div>`;
    return;
  }

  grid.innerHTML = filtered.map(photo => _renderPhotoCard(photo)).join('');

  grid.querySelectorAll('.photo-thumb[data-full-src]').forEach(thumb => {
    thumb.addEventListener('click', () => {
      showImageModal(thumb.dataset.fullSrc || '', thumb.dataset.title || '');
    });
  });

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
      const ok = await showConfirm('Delete photo', `Delete "${name}"? This removes the file from disk and cannot be undone.`);
      if (!ok) return;

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
  const imgSrc    = photo.thumbUrl || photo.displayUrl || photo.url || '';
  const fullSrc   = photo.displayUrl || photo.url || photo.thumbUrl || '';

  return `
    <div class="photo-card" data-id="${esc(photo.id)}">
      <div class="photo-thumb" data-full-src="${esc(fullSrc)}" data-title="${esc(photo.name)}">
        ${imgSrc
          ? `<img class="photo-preview" src="${esc(imgSrc)}" data-full-src="${esc(fullSrc)}" data-title="${esc(photo.name)}" alt="${esc(photo.name)}" loading="lazy">`
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
