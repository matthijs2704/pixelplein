const formEl = document.getElementById('submit-form');
const submitBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');
const eventTitleEl = document.getElementById('event-title');
const submitterLabelEl = document.getElementById('submitter-label');
const photoInputEl = document.getElementById('photo');
const photoPreviewEl = document.getElementById('photo-preview');
const clearPhotoBtn = document.getElementById('clear-photo');
const submitCardEl = document.getElementById('submit-card');
const closedMessageEl = document.getElementById('closed-message');

let _settings = {
  submissionEnabled: true,
  submissionFieldLabel: 'Naam',
  submissionRequirePhoto: false,
  eventName: '',
};

function setStatus(msg, cls = '') {
  statusEl.textContent = msg || '';
  statusEl.className = `status ${cls}`.trim();
}

function applySettings() {
  eventTitleEl.textContent = _settings.eventName || 'Deel jouw moment';
  submitterLabelEl.textContent = _settings.submissionFieldLabel || 'Naam';
  photoInputEl.required = Boolean(_settings.submissionRequirePhoto);

  const open = _settings.submissionEnabled !== false;
  submitCardEl.classList.toggle('hidden', !open);
  closedMessageEl.classList.toggle('hidden', open);
}

function applyTheme(themeId) {
  const current = document.getElementById('submit-theme-css');
  if (!themeId) {
    if (current) current.remove();
    return;
  }

  const href = `/themes/${encodeURIComponent(themeId)}/style.css`;
  if (current) {
    if (current.getAttribute('href') !== href) current.setAttribute('href', href);
    return;
  }

  const link = document.createElement('link');
  link.id = 'submit-theme-css';
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

async function loadSettings() {
  try {
    const res = await fetch('/api/submissions/public-config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _settings = { ..._settings, ...(data || {}) };
    applyTheme(_settings.theme);
    applySettings();
  } catch {
    setStatus('Inzending laden niet gelukt. Vernieuw de pagina.', 'err');
  }
}

function resetForm() {
  formEl.reset();
  photoPreviewEl.removeAttribute('src');
  photoPreviewEl.style.display = 'none';
  clearPhotoBtn.classList.add('hidden');
}

photoInputEl.addEventListener('change', () => {
  const file = photoInputEl.files?.[0];
  if (!file) {
    resetForm();
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    photoPreviewEl.src = reader.result;
    photoPreviewEl.style.display = 'block';
    clearPhotoBtn.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

clearPhotoBtn.addEventListener('click', () => {
  photoInputEl.value = '';
  photoPreviewEl.removeAttribute('src');
  photoPreviewEl.style.display = 'none';
  clearPhotoBtn.classList.add('hidden');
});

formEl.addEventListener('submit', async e => {
  e.preventDefault();
  setStatus('Verzenden...');
  submitBtn.disabled = true;

  const fd = new FormData();
  fd.append('submitterValue', document.getElementById('submitter-value').value || '');
  fd.append('message', document.getElementById('message').value || '');
  const file = photoInputEl.files?.[0];
  if (file) fd.append('photo', file);

  try {
    const res = await fetch('/api/submissions', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    setStatus('Bedankt! Je inzending wordt beoordeeld.', 'ok');
    resetForm();
  } catch (err) {
    setStatus(err.message || 'Verzenden mislukt', 'err');
  } finally {
    submitBtn.disabled = false;
  }
});

loadSettings();
