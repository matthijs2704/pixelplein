// Approved submissions registry used by the social-wall layout.

const _items = new Map(); // id -> submission
let _rotationCursor = 0;
let _wallCycle = 0;

const _wall = {
  enabled: true,
  showQr: true,
  hideWhenEmpty: true,
  pageSize: 6,
  maxAgeEnabled: true,
  maxAgeMin: 90,
  repeatAfterCycles: 3,
  minApproved: 2,
  intervalMs: 45_000,
  qrTargetUrl: '',
  qrImageUrl: '',
};

function _normalizeSubmission(item, existing) {
  if (!item?.id) return null;
  return {
    id: String(item.id),
    kind: item.kind === 'kampkrant_tip' ? 'kampkrant_tip' : 'screen',
    message: String(item.message || '').slice(0, 800),
    submitterValue: String(item.submitterValue || '').slice(0, 120),
    submittedAt: Number(item.submittedAt || 0),
    approvedAt: Number(item.approvedAt || 0),
    photoUrl: item.photoUrl || item.photoOriginalUrl || null,
    photoThumbUrl: item.photoThumbUrl || item.photoThumb || item.photoUrl || item.photoOriginalUrl || null,
    lastWallShownAt: Number(existing?.lastWallShownAt || item.lastWallShownAt || 0),
    wallImpressions: Number(existing?.wallImpressions || item.wallImpressions || 0),
    _lastWallCycle: Number(existing?._lastWallCycle || -1000),
  };
}

function _screenItems() {
  return Array.from(_items.values()).filter(item => item.kind === 'screen');
}

function _sortedRecent(maxItems = 120) {
  return _screenItems()
    .sort((a, b) => (b.approvedAt || b.submittedAt || 0) - (a.approvedAt || a.submittedAt || 0))
    .slice(0, Math.max(1, maxItems));
}

export function setApprovedSubmissions(items) {
  const prev = new Map(_items);
  _items.clear();
  for (const raw of Array.isArray(items) ? items : []) {
    const item = _normalizeSubmission(raw, prev.get(String(raw?.id || '')));
    if (!item) continue;
    _items.set(item.id, item);
  }
  _rotationCursor = 0;
}

export function addApprovedSubmission(raw) {
  const item = _normalizeSubmission(raw, _items.get(String(raw?.id || '')));
  if (!item) return;
  _items.set(item.id, item);
  _rotationCursor = 0;
}

export function hasApprovedSubmissions() {
  return _screenItems().length > 0;
}

function _maxAgeCutoff() {
  return Date.now() - Math.max(5, Number(_wall.maxAgeMin || 90)) * 60 * 1000;
}

function _isEligibleForWall(item) {
  if (!_wall.maxAgeEnabled) return true;
  const stamp = Number(item.approvedAt || item.submittedAt || 0);
  return stamp >= _maxAgeCutoff();
}

export function getSubmissionWallState() {
  const items = _screenItems();
  const eligibleCount = items.filter(_isEligibleForWall).length;
  const minApproved = Math.max(1, Number(_wall.minApproved || 2));
  const canShow = _wall.enabled && eligibleCount >= minApproved;
  const intervalMs = Math.max(10_000, _wall.intervalMs || 45_000);

  return {
    totalCount: items.length,
    eligibleCount,
    canShow,
    intervalMs,
  };
}

export function pickSubmissionWindow(count, maxRecent = 40) {
  const pool = _sortedRecent(maxRecent).filter(_isEligibleForWall);
  if (pool.length < Math.max(1, Number(_wall.minApproved || 2))) return [];

  const repeatAfterCycles = Math.max(0, Number(_wall.repeatAfterCycles || 0));
  let available = pool.filter(item => (_wallCycle - Number(item._lastWallCycle || -1000)) > repeatAfterCycles);
  if (!available.length) available = pool.slice();

  available.sort((a, b) => {
    const aImpressions = Number(a.wallImpressions || 0);
    const bImpressions = Number(b.wallImpressions || 0);
    if (aImpressions !== bImpressions) return aImpressions - bImpressions;

    const aCycle = Number(a._lastWallCycle || -1000);
    const bCycle = Number(b._lastWallCycle || -1000);
    if (aCycle !== bCycle) return aCycle - bCycle;

    return (b.approvedAt || b.submittedAt || 0) - (a.approvedAt || a.submittedAt || 0);
  });

  const wanted = Math.max(1, Math.min(count, available.length));
  const start = _rotationCursor % available.length;
  const out = [];
  for (let i = 0; i < wanted; i++) {
    out.push(available[(start + i) % available.length]);
  }

  _rotationCursor = (_rotationCursor + Math.max(1, Math.floor(wanted / 2))) % available.length;
  _wallCycle += 1;

  const shownAt = Date.now();
  return out.map(item => {
    const live = _items.get(item.id);
    if (!live) return item;
    live.lastWallShownAt = shownAt;
    live.wallImpressions = Number(live.wallImpressions || 0) + 1;
    live._lastWallCycle = _wallCycle;
    return live;
  });
}

function _resolveBaseUrl(rawBaseUrl) {
  const raw = String(rawBaseUrl || '').trim();
  if (!raw) return location.origin;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  if (raw.startsWith('/')) return `${location.origin}${raw}`.replace(/\/+$/, '');
  return `https://${raw.replace(/^\/+/, '')}`.replace(/\/+$/, '');
}

async function _refreshQrImage() {
  if (!_wall.showQr || !_wall.qrTargetUrl) {
    _wall.qrImageUrl = '';
    return;
  }

  try {
    const res = await fetch(`/api/slides/qr?url=${encodeURIComponent(_wall.qrTargetUrl)}`);
    if (!res.ok) return;
    const data = await res.json();
    _wall.qrImageUrl = data?.url || '';
  } catch {
    // ignore transient network issues
  }
}

export function updateSubmissionWallSettings(config) {
  const enabled = config?.submissionWallEnabled !== false;
  const showQr = config?.submissionWallShowQr !== false;
  const hideWhenEmpty = config?.submissionWallHideWhenEmpty !== false;
  const pageSize = Math.max(3, Math.min(12, Math.floor(Number(config?.submissionGridCount) || 6)));
  const maxAgeEnabled = config?.submissionWallMaxAgeEnabled !== false;
  const maxAgeMin = Math.max(5, Math.min(24 * 60, Math.floor(Number(config?.submissionWallMaxAgeMin) || 90)));
  const repeatAfterCycles = Math.max(0, Math.min(20, Math.floor(Number(config?.submissionWallRepeatAfterCycles) || 3)));
  const minApproved = Math.max(1, Math.min(20, Math.floor(Number(config?.submissionWallMinApproved) || 2)));
  const intervalMs = Math.max(10_000, Math.floor(Number(config?.submissionDisplayIntervalSec || 45) * 1000));
  const publicBaseUrl = _resolveBaseUrl(config?.publicBaseUrl);
  const qrTargetUrl = `${publicBaseUrl}/submit?kind=screen`;

  const needsQrRefresh = showQr && (qrTargetUrl !== _wall.qrTargetUrl || !(_wall.qrImageUrl || '').length);

  _wall.enabled = enabled;
  _wall.showQr = showQr;
  _wall.hideWhenEmpty = hideWhenEmpty;
  _wall.pageSize = pageSize;
  _wall.maxAgeEnabled = maxAgeEnabled;
  _wall.maxAgeMin = maxAgeMin;
  _wall.repeatAfterCycles = repeatAfterCycles;
  _wall.minApproved = minApproved;
  _wall.intervalMs = intervalMs;
  _wall.qrTargetUrl = qrTargetUrl;

  if (needsQrRefresh) {
    _refreshQrImage();
  }

  if (!showQr) {
    _wall.qrImageUrl = '';
  }
}

export function getSubmissionWallOptions() {
  return {
    enabled: _wall.enabled,
    showQr: _wall.showQr,
    hideWhenEmpty: _wall.hideWhenEmpty,
    pageSize: _wall.pageSize,
    maxAgeEnabled: _wall.maxAgeEnabled,
    maxAgeMin: _wall.maxAgeMin,
    repeatAfterCycles: _wall.repeatAfterCycles,
    minApproved: _wall.minApproved,
    qrImageUrl: _wall.qrImageUrl,
    qrTargetUrl: _wall.qrTargetUrl,
  };
}
