// Small number / time formatters that mimic how IG / TikTok display counts
// and timestamps. Used across slides + chrome overlay.

export function fmtCount(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return (m >= 10 ? m.toFixed(0) : m.toFixed(1)) + 'M';
  }
  if (v >= 10_000) return (v / 1000).toFixed(0) + 'K';
  if (v >= 1_000)  return (v / 1000).toFixed(1) + 'K';
  return v.toLocaleString('nl-NL');
}

export function fmtCountFull(n) {
  return (Number(n) || 0).toLocaleString('nl-NL');
}

const _RTF = new Intl.RelativeTimeFormat('nl', { numeric: 'auto' });

export function fmtAgo(ts) {
  const diff = (Date.now() - Number(ts)) / 1000;
  if (!Number.isFinite(diff) || diff < 0) return 'nu';
  if (diff < 60)     return _RTF.format(-Math.floor(diff), 'second').replace(/seconden? geleden/, 's');
  if (diff < 3600)   return Math.floor(diff / 60)  + 'm';
  if (diff < 86_400) return Math.floor(diff / 3600) + 'u';
  return Math.floor(diff / 86_400) + 'd';
}
