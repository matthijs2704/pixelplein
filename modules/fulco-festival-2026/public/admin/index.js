// Fulco Festival 2026 admin tab — presenter remote for the "Van Maarn naar de wereld" display.
// Shows 4 big stop buttons + auto/manual toggle.

import { registerAdminTab, registerAdminWsHandler } from '/admin/module-registry.js';

const API = '/api/modules/fulco-festival-2026';

function _loadStyle() {
  if (document.getElementById('fulco-festival-2026-admin-style')) return;
  const link = document.createElement('link');
  link.id   = 'fulco-festival-2026-admin-style';
  link.rel  = 'stylesheet';
  link.href = '/modules/fulco-festival-2026/admin/style.css';
  document.head.appendChild(link);
}

const LEVELS = [
  { step: 1, icon: '🏕️', naam: 'Scouting Ridder Fulco', laag: 'Eigen groep' },
  { step: 2, icon: '🧭', naam: 'Regio Utrechtse Heuvelrug', laag: 'De regio' },
  { step: 3, icon: '🇳🇱', naam: 'Scouting Nederland', laag: 'Heel Nederland' },
  { step: 4, icon: '🌍', naam: 'Wereldjamboree 2027', laag: 'De hele wereld' },
];

async function _post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok ? res.json() : null;
}

function _render(container, state) {
  const { level, manual } = state || { level: 0, manual: true };

  container.innerHTML = `
    <div class="xpa-wrap">
      <div class="xpa-header">
        <h2 class="xpa-title">Fulco Festival 2026 · Presenter</h2>
        <label class="xpa-toggle">
          <input type="checkbox" id="xpa-manual" ${manual ? 'checked' : ''}>
          <span class="xpa-toggle-track"></span>
          <span class="xpa-toggle-lbl">${manual ? 'Handmatig' : 'Auto-loop'}</span>
        </label>
      </div>
      <div class="xpa-stops">
        ${LEVELS.map((lv, i) => `
          <button class="xpa-stop ${i === level ? 'active' : ''}" data-level="${i}">
            <span class="xpa-stop-icon">${lv.icon}</span>
            <span class="xpa-stop-num">STAP ${lv.step}</span>
            <span class="xpa-stop-naam">${lv.naam}</span>
            <span class="xpa-stop-laag">${lv.laag}</span>
            ${i === level ? '<span class="xpa-stop-live">● LIVE</span>' : ''}
          </button>`).join('')}
      </div>
      <p class="xpa-hint">
        ${manual
          ? 'Klik een stap om het scherm te wisselen. Ga verder met jouw verhaal. 🎙️'
          : 'Auto-loop actief — scherm wisselt vanzelf elke ~40 seconden.'}
      </p>
    </div>`;

  container.querySelectorAll('.xpa-stop').forEach(btn => {
    btn.addEventListener('click', async () => {
      const next = await _post('/level', { level: +btn.dataset.level });
      if (next) _render(container, next);
    });
  });

  container.querySelector('#xpa-manual')?.addEventListener('change', async (e) => {
    const next = await _post('/mode', { manual: e.target.checked });
    if (next) _render(container, next);
  });
}

export function register() {
  _loadStyle();
  let _container = null;

  registerAdminTab({
    id:    'fulco-festival-2026',
    label: 'Fulco Festival 2026',
    icon:  '🧭',
    async mount(container) {
      _container = container;
      try {
        const res = await fetch(`${API}/snapshot`, { credentials: 'include' });
        _render(container, res.ok ? await res.json() : null);
      } catch { _render(container, null); }
    },
  });

  registerAdminWsHandler('fulco-festival-2026', (msg) => {
    if (_container && msg.type === 'fulco-festival-2026:state') _render(_container, msg);
  });
}
