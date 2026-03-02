// Centralized fetch wrappers for the admin UI

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);

  if (res.status === 401) {
    location.href = '/login.html';
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
      if (xhr.status === 401) {
        location.href = '/login.html';
        return reject(new Error('Not authenticated'));
      }

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
