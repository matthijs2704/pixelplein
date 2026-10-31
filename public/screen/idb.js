// IndexedDB persistence for the screen player.
// Stores photo metadata and config/slides/playlists so the screen can boot
// and keep cycling when the server is temporarily unreachable.

const DB_NAME    = 'pixelplein-screen';
const DB_VERSION = 1;

let _db = null;

function _open() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
    req.onerror    = e => reject(e.target.error);
  });
}

function _tx(storeName, mode, fn) {
  return _open().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req   = fn(store);
    tx.oncomplete = () => resolve(req?.result ?? undefined);
    tx.onerror    = e => reject(e.target.error);
    tx.onabort    = e => reject(e.target.error);
  }));
}

// ---------------------------------------------------------------------------
// Photos store
// ---------------------------------------------------------------------------

/**
 * Upsert an array of photo objects into the photos store.
 * @param {object[]} photos
 */
export function savePhotos(photos) {
  if (!photos?.length) return Promise.resolve();
  return _open().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    for (const photo of photos) store.put(photo);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  }));
}

/**
 * Load all photos from the store.
 * @returns {Promise<object[]>}
 */
export function loadPhotos() {
  return _open().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const req   = store.getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  }));
}

/**
 * Remove photos by id array.
 * @param {string[]} ids
 */
export function removePhotos(ids) {
  if (!ids?.length) return Promise.resolve();
  return _open().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    for (const id of ids) store.delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  }));
}

export function clearAllData() {
  return _open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(['photos', 'meta'], 'readwrite');
    tx.objectStore('photos').clear();
    tx.objectStore('meta').clear();
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
    tx.onabort    = e => reject(e.target.error);
  }));
}

// ---------------------------------------------------------------------------
// Meta store  (config, slides, playlists, etc.)
// ---------------------------------------------------------------------------

/**
 * @param {string} key
 * @param {*} value  Must be structuredClone-able
 */
export function saveMeta(key, value) {
  return _tx('meta', 'readwrite', store => store.put({ key, value }));
}

/**
 * @param {string} key
 * @returns {Promise<*>}
 */
export function loadMeta(key) {
  return _open().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction('meta', 'readonly');
    const store = tx.objectStore('meta');
    const req   = store.get(key);
    req.onsuccess = e => resolve(e.target.result?.value ?? null);
    req.onerror   = e => reject(e.target.error);
  }));
}
