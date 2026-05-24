// Alert renderer: hype-glitch
// Full-screen RGB-split glitch + scanlines + occasional message strip.
// Used as a "platform hiccup" cue; can interrupt mid-rotation.

export function renderGlitchAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-glitch';
  root.dataset.alertId = alert.id;

  root.innerHTML = `
    <div class="hype-glitch-bg"></div>
    <div class="hype-glitch-scan"></div>
    <div class="hype-glitch-text" data-text="${escape(alert.message || 'DE HYPE')}">
      ${escape(alert.message || 'DE HYPE')}
    </div>
    <div class="hype-glitch-sub">${escape(alert.payload?.subtitle || 'signaal verstoord')}</div>
  `;
  return root;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
