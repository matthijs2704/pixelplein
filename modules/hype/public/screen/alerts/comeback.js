// Alert renderer: hype-comeback
// Plays a short scripted sequence: noise → logo → channel grid → "WE ZIJN
// TERUG". payload.script can override the steps; each step is one of:
//   { at: msFromStart, type: 'noise' | 'logo' | 'channels' | 'message', text?: string }
//
// The renderer fires steps via setTimeout. Animation is mostly CSS.

import { getChannels } from '../state-client.js';

const DEFAULT_SCRIPT = [
  { at:     0, type: 'noise' },
  { at:  2000, type: 'logo' },
  { at:  4500, type: 'channels' },
  { at:  7500, type: 'message', text: 'WE ZIJN TERUG' },
];

export function renderComebackAlert(alert) {
  const root = document.createElement('div');
  root.className = 'hype-alert hype-alert-comeback';
  root.dataset.alertId = alert.id;

  const stage = document.createElement('div');
  stage.className = 'hype-comeback-stage';
  root.appendChild(stage);

  const script = Array.isArray(alert.payload?.script) && alert.payload.script.length
    ? alert.payload.script
    : DEFAULT_SCRIPT;

  for (const step of script) {
    setTimeout(() => _runStep(stage, step), Math.max(0, step.at | 0));
  }

  return root;
}

function _runStep(stage, step) {
  stage.innerHTML = '';
  switch (step.type) {
    case 'noise': {
      const n = document.createElement('div');
      n.className = 'hype-comeback-noise';
      stage.appendChild(n);
      break;
    }
    case 'logo': {
      const w = document.createElement('div');
      w.className = 'hype-comeback-logo-wrap';
      w.innerHTML = '<div class="hype-comeback-logo">De Hype</div>';
      stage.appendChild(w);
      break;
    }
    case 'channels': {
      const grid = document.createElement('div');
      grid.className = 'hype-comeback-channels';
      for (const ch of getChannels()) {
        const card = document.createElement('div');
        card.className = 'hype-comeback-ch';
        card.style.setProperty('--ch-color', ch.color || '#7c5cff');
        card.innerHTML = `<div class="hype-comeback-ch-emoji">${ch.emoji || '✨'}</div>` +
                         `<div class="hype-comeback-ch-handle">${escape(ch.handle)}</div>`;
        grid.appendChild(card);
      }
      stage.appendChild(grid);
      break;
    }
    case 'message': {
      const m = document.createElement('div');
      m.className = 'hype-comeback-message';
      m.textContent = step.text || 'WE ZIJN TERUG';
      stage.appendChild(m);
      break;
    }
  }
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
