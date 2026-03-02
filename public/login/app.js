function _setError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function _qs(name) {
  return new URLSearchParams(location.search).get(name);
}

async function _apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

function _setSetupMode(on) {
  document.getElementById('login-form').style.display = on ? 'none' : '';
  document.getElementById('setup-form').style.display = on ? '' : 'none';
  document.getElementById('subtitle').textContent = on
    ? 'Create the first admin account for this installation.'
    : 'Sign in to manage screens, photos, and playlists.';
}

async function _boot() {
  const err = _qs('error');
  if (err === 'not_allowed') {
    _setError('Your account is not allowed to access this admin.');
  } else if (err === 'oidc_failed') {
    _setError('SSO login failed. Please try again or use local login.');
  }

  const me = await _apiFetch('/api/auth/me').catch(() => ({ loggedIn: false, setupRequired: false }));
  if (me.loggedIn) {
    location.href = '/admin.html';
    return;
  }

  _setSetupMode(Boolean(me.setupRequired));

  const cfg = await _apiFetch('/api/auth/config').catch(() => ({ oidcEnabled: false }));
  const oidcBtn = document.getElementById('oidc-btn');
  if (cfg.oidcEnabled) {
    oidcBtn.style.display = '';
    oidcBtn.textContent = cfg.providerName ? `Sign in with ${cfg.providerName}` : 'Sign in with SSO';
    oidcBtn.onclick = () => { location.href = '/api/auth/oidc/start'; };
  }
}

document.getElementById('login-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  _setError('');

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const rememberMe = Boolean(document.getElementById('login-remember').checked);

  try {
    await _apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, rememberMe }),
    });
    location.href = '/admin.html';
  } catch (err) {
    _setError(err.message || 'Login failed');
  }
});

document.getElementById('setup-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  _setError('');

  const username = document.getElementById('setup-username').value.trim();
  const password = document.getElementById('setup-password').value;
  const confirm = document.getElementById('setup-password-confirm').value;

  if (password !== confirm) {
    _setError('Passwords do not match');
    return;
  }

  try {
    await _apiFetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    location.href = '/admin.html';
  } catch (err) {
    _setError(err.message || 'Setup failed');
  }
});

_boot();
