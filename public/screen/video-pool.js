// Video pool — parallel to photos.js, feeds layout-based video selection.

let _pool    = [];  // enabled video slides with a filename
let _pointer = 0;   // round-robin index

export function updateVideoPool(slides) {
  _pool = (slides || []).filter(s => s.type === 'pool-video' && s.enabled !== false && s.filename);
  _pointer = _pool.length ? _pointer % _pool.length : 0;
}

export function getVideoPool() { return _pool; }

// Round-robin pick, skipping excludeId when pool has more than one entry.
export function pickVideo(excludeId = null) {
  if (!_pool.length) return null;
  for (let i = 0; i < _pool.length; i++) {
    const idx = (_pointer + i) % _pool.length;
    if (_pool[idx].id !== excludeId) {
      _pointer = (idx + 1) % _pool.length;
      return _pool[idx];
    }
  }
  return _pool[_pointer % _pool.length]; // all same id — just return it
}
