// Centralised fetch wrappers for the admin UI

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text ? ': ' + text : ''}`);
  }
  return res.json();
}

export async function loadConfig() {
  return apiFetch('/api/config');
}

export async function saveConfig(config) {
  return apiFetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function loadStats() {
  return apiFetch('/api/stats');
}

export async function loadPhotos() {
  return apiFetch('/api/photos');
}

/**
 * Toggle heroCandidate on a photo.
 * @param {string}  id
 * @param {boolean} heroCandidate
 */
export async function patchPhoto(id, { heroCandidate }) {
  return apiFetch(`/api/photos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ heroCandidate }),
  });
}

/**
 * Permanently delete a photo (source + cache).
 * @param {string} id
 */
export async function deletePhoto(id) {
  return apiFetch(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function loadSlides() {
  return apiFetch('/api/slides');
}

export async function loadPlaylists() {
  return apiFetch('/api/playlists');
}

export async function setPin(pin) {
  return apiFetch('/api/auth/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
}

export async function loadPinStatus() {
  return apiFetch('/api/auth/status');
}

/**
 * Upload files with an optional group.
 * @param {FileList|File[]} files
 * @param {string}          group
 * @param {Function}        onProgress - called with (loaded, total) per XHR progress
 * @returns {Promise<{ok, uploaded, errors}>}
 */
export function uploadFiles(files, group, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    if (group && group !== 'ungrouped') fd.append('group', group);
    for (const file of files) fd.append('files', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photos/upload');

    if (onProgress) {
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        resolve(data);
      } catch {
        reject(new Error('Invalid server response'));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(fd);
  });
}
