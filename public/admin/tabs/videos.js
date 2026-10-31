// Videos tab — pool management for layout-based video rotation.
// Videos are backed by type:'video' slides; this tab presents them as a pool
// (enable = in pool, disable = out of pool) similar to the photos tab.

import { esc } from '/shared/utils.js';
import { icon } from '/shared/icons.js';

let _videos = [];

export function initVideosTab() {
  _bindUploadZone();
  _bindPlayNow();
}

async function _playVideosNow(body, label) {
  const status = document.getElementById('videos-play-status');
  try {
    const res = await fetch('/api/slides/play-videos-now', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    if (status) status.textContent = label;
  } catch (err) {
    if (status) status.textContent = `Failed: ${err.message}`;
  }
}

function _bindPlayNow() {
  document.getElementById('videos-play-batch')?.addEventListener('click', () =>
    _playVideosNow({ count: 'batch' }, 'Playing a batch…'));
  document.getElementById('videos-play-all')?.addEventListener('click', () =>
    _playVideosNow({ count: 'all' }, 'Playing all videos…'));
  document.getElementById('videos-play-count-btn')?.addEventListener('click', () => {
    const n = Math.max(1, parseInt(document.getElementById('videos-play-count')?.value || '1', 10));
    _playVideosNow({ count: n }, `Playing ${n} video${n === 1 ? '' : 's'}…`);
  });
}

// Called whenever slides are refreshed (same event that updates the slides tab).
export function refreshVideos(slides) {
  _videos = (slides || []).filter(s => s.type === 'pool-video');
  _renderGrid();
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

function _bindUploadZone() {
  const zone  = document.getElementById('videos-upload-zone');
  const input = document.getElementById('videos-upload-input');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('video/'));
    if (files.length) _uploadFiles(files);
  });
  input.addEventListener('change', () => {
    if (input.files?.length) _uploadFiles([...input.files]);
    input.value = '';
  });
}

async function _uploadFiles(files) {
  const status = document.getElementById('videos-upload-status');
  for (const file of files) {
    if (status) status.textContent = `Uploading ${file.name}…`;
    try {
      const fd = new FormData();
      fd.append('video', file);
      const res  = await fetch('/api/slides/upload-pool-video', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      if (status) status.textContent = `Uploaded: ${data.label || file.name}`;
    } catch (err) {
      if (status) status.textContent = `Error: ${err.message}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function _renderGrid() {
  const grid = document.getElementById('videos-grid');
  if (!grid) return;
  if (!_videos.length) {
    grid.innerHTML = '<div class="photos-empty">No videos yet. Upload one above.</div>';
    return;
  }
  grid.innerHTML = '';
  for (const v of _videos) {
    grid.appendChild(_makeCard(v));
  }
}

function _makeCard(v) {
  const inPool = v.enabled !== false;
  const src    = v.filename ? `/slide-assets/videos/${encodeURIComponent(v.filename)}` : '';

  const card = document.createElement('div');
  card.className = 'video-card' + (inPool ? ' video-card-active' : '');
  card.dataset.id = v.id;

  card.innerHTML = `
    <div class="video-card-thumb">
      ${src ? `<video src="${esc(src)}" preload="metadata" muted></video>` : `<div class="video-card-nothumb">${icon('play')}</div>`}
      <span class="video-card-pool-badge ${inPool ? 'in-pool' : 'out-pool'}">${inPool ? 'in pool' : 'off'}</span>
    </div>
    <div class="video-card-body">
      <div class="video-card-label" title="${esc(v.label || v.filename || '')}">${esc(v.label || v.filename || '(untitled)')}</div>
      <div class="video-card-actions">
        <label class="video-pool-toggle" title="${inPool ? 'Remove from pool' : 'Add to pool'}">
          <input type="checkbox" ${inPool ? 'checked' : ''}>
          <span class="video-pool-slider"></span>
        </label>
        <button class="sc-btn sc-btn-play" title="Play now">${icon('play')}</button>
        <button class="sc-btn sc-btn-edit" title="Edit">Edit</button>
        <button class="sc-btn sc-btn-del" title="Delete">${icon('x-mark')}</button>
      </div>
    </div>
  `;

  card.querySelector('.sc-btn-play').addEventListener('click', () =>
    _playVideosNow({ count: 'batch', videoId: v.id }, `Playing "${v.label || v.filename}"…`));

  card.querySelector('input[type=checkbox]').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    try {
      await fetch(`/api/slides/${v.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ enabled }),
      });
    } catch {
      e.target.checked = !enabled; // revert
    }
  });

  card.querySelector('.sc-btn-edit').addEventListener('click', () => {
    // Delegate to the slides tab modal (already globally exposed)
    if (typeof window.slidesEditSlide === 'function') window.slidesEditSlide(v.id);
  });

  card.querySelector('.sc-btn-del').addEventListener('click', async () => {
    if (!confirm(`Delete video "${v.label || v.filename}"?`)) return;
    try {
      await fetch(`/api/slides/${v.id}`, { method: 'DELETE' });
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  });

  return card;
}
