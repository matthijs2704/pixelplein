// Approved submissions registry used by the social-wall layout.

const _items = new Map(); // id -> submission
let _rotationCursor = 0;

const _wall = {
  showQr: true,
  hideWhenEmpty: true,
  qrTargetUrl: '',
  qrImageUrl: '',
};

function _normalizeSubmission(item) {
  if (!item?.id) return null;
  return {
    id: String(item.id),
    message: String(item.message || '').slice(0, 800),
    submitterValue: String(item.submitterValue || '').slice(0, 120),
    submittedAt: Number(item.submittedAt || 0),
    photoUrl: item.photoUrl || item.photoOriginalUrl || null,
    photoThumbUrl: item.photoThumbUrl || item.photoThumb || item.photoUrl || item.photoOriginalUrl || null,
  };
}

function _sortedRecent(maxItems = 120) {
  return Array.from(_items.values())
    .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))
    .slice(0, Math.max(1, maxItems));
}

export function setApprovedSubmissions(items) {
  _items.clear();
  for (const raw of Array.isArray(items) ? items : []) {
    const item = _normalizeSubmission(raw);
    if (!item) continue;
    _items.set(item.id, item);
  }
  _rotationCursor = 0;
}

export function addApprovedSubmission(raw) {
  const item = _normalizeSubmission(raw);
  if (!item) return;
  _items.set(item.id, item);
  _rotationCursor = 0;
}

export function hasApprovedSubmissions() {
  return _items.size > 0;
}

export function pickSubmissionWindow(count, maxRecent = 40) {
  const recent = _sortedRecent(maxRecent);
  if (!recent.length) return [];

  const wanted = Math.max(1, Math.min(count, recent.length));
  const start = _rotationCursor % recent.length;
  const out = [];
  for (let i = 0; i < wanted; i++) {
    out.push(recent[(start + i) % recent.length]);
  }

  _rotationCursor = (_rotationCursor + Math.max(1, Math.floor(wanted / 2))) % recent.length;
  return out;
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
  const showQr = config?.submissionWallShowQr !== false;
  const hideWhenEmpty = config?.submissionWallHideWhenEmpty !== false;
  const publicBaseUrl = _resolveBaseUrl(config?.publicBaseUrl);
  const qrTargetUrl = `${publicBaseUrl}/submit`;

  const needsQrRefresh = showQr && (qrTargetUrl !== _wall.qrTargetUrl || !(_wall.qrImageUrl || '').length);

  _wall.showQr = showQr;
  _wall.hideWhenEmpty = hideWhenEmpty;
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
    showQr: _wall.showQr,
    hideWhenEmpty: _wall.hideWhenEmpty,
    qrImageUrl: _wall.qrImageUrl,
    qrTargetUrl: _wall.qrTargetUrl,
  };
}
