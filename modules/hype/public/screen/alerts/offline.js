// Alert renderer: hype-offline
// "Platform is down" — full-screen static / noise + apology card. This is
// the climax just before the night game (kids reboot the server).

export function renderOfflineAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-offline';
  root.dataset.alertId = alert.id;

  const title = alert.payload?.title || 'PLATFORM OFFLINE';
  const body  = alert.message || 'Er is iets misgegaan. We werken eraan.';

  root.innerHTML = `
    <div class="hype-offline-noise"></div>
    <div class="hype-offline-card">
      <div class="hype-offline-icon">⚠</div>
      <div class="hype-offline-title">${escape(title)}</div>
      <div class="hype-offline-body">${escape(body)}</div>
      <div class="hype-offline-foot">de hype team — sorry voor het ongemak</div>
    </div>
  `;
  return root;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
