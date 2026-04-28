// Centralized fetch wrappers for the admin UI

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);

  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Not authenticated');
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      const text = await res.text().catch(() => '');
      if (text) message = text;
    }
    throw new Error(message);
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
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

export async function patchPhoto(id, { heroCandidate }) {
  return apiFetch(`/api/photos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ heroCandidate }),
  });
}

export async function deletePhoto(id) {
  return apiFetch(`/api/photos/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function deletePhotoGroup(group) {
  return apiFetch(`/api/photos/group/${encodeURIComponent(group)}`, { method: 'DELETE' });
}

export async function loadSlides() {
  return apiFetch('/api/slides');
}

export async function loadPlaylists() {
  return apiFetch('/api/playlists');
}

export async function loadMe() {
  return apiFetch('/api/auth/me');
}

export async function logout() {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export async function loadUsers() {
  return apiFetch('/api/auth/users');
}

export async function addUser(username, password) {
  return apiFetch('/api/auth/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function removeUser(username) {
  return apiFetch(`/api/auth/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
  });
}

export async function loadOidcConfig() {
  return apiFetch('/api/auth/oidc');
}

export async function saveOidcConfig(payload) {
  return apiFetch('/api/auth/oidc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function disableOidc() {
  return apiFetch('/api/auth/oidc', { method: 'DELETE' });
}

export async function loadScreenDevices() {
  return apiFetch('/api/screens/devices');
}

export async function approveScreenDevice(deviceId, payload) {
  return apiFetch(`/api/screens/devices/${encodeURIComponent(deviceId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function revokeScreenDevice(deviceId) {
  return apiFetch(`/api/screens/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
  });
}

export async function sendScreenDeviceCommand(deviceId, command) {
  return apiFetch(`/api/screens/devices/${encodeURIComponent(deviceId)}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });
}

export async function reloadScreens() {
  return apiFetch('/api/screens/reload', { method: 'POST' });
}

const MAX_UPLOAD_BATCH_FILES = 10;
const MAX_UPLOAD_BATCH_BYTES = 100 * 1024 * 1024;

function splitUploadBatches(files) {
  const batches = [];
  let batch = [];
  let batchBytes = 0;

  for (const file of Array.from(files || [])) {
    const fileSize = Number(file?.size) || 0;
    const wouldOverflow = batch.length > 0 && (
      batch.length >= MAX_UPLOAD_BATCH_FILES ||
      batchBytes + fileSize > MAX_UPLOAD_BATCH_BYTES
    );

    if (wouldOverflow) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }

    batch.push(file);
    batchBytes += fileSize;
  }

  if (batch.length) batches.push(batch);
  return batches;
}

function uploadBatch(files, group, onProgress) {
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
      if (xhr.status === 401) {
        location.href = '/login';
        return reject(new Error('Not authenticated'));
      }

      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        return reject(new Error('Invalid server response'));
      }

      if (xhr.status < 200 || xhr.status >= 300 || data?.ok === false) {
        const message = data?.error || `HTTP ${xhr.status}`;
        return reject(new Error(message));
      }

      resolve(data || { ok: true, uploaded: [], errors: [] });
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(fd);
  });
}

export async function uploadFiles(files, group, onProgress) {
  const batches = splitUploadBatches(files);
  const result = { ok: true, uploaded: [], errors: [] };
  const totalBytes = batches.reduce((sum, batch) => (
    sum + batch.reduce((batchSum, file) => batchSum + (Number(file?.size) || 0), 0)
  ), 0);
  let uploadedBytes = 0;

  for (const batch of batches) {
    const batchBytes = batch.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
    const data = await uploadBatch(batch, group, (loaded, total) => {
      if (!onProgress) return;
      const effectiveTotal = totalBytes || total || 1;
      const effectiveLoaded = Math.min(uploadedBytes + loaded, uploadedBytes + batchBytes);
      onProgress(effectiveLoaded, effectiveTotal);
    });

    uploadedBytes += batchBytes;
    result.uploaded.push(...(data.uploaded || []));
    result.errors.push(...(data.errors || []));
  }

  if (onProgress) onProgress(totalBytes || 1, totalBytes || 1);

  return result;
}
