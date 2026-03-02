'use strict';

const express = require('express');
const oidc = require('openid-client');

const { sanitizeOidc } = require('../../config');
const { getSettingJson, setSettingJson } = require('../../db');
const { listUsers, addUser, removeUser, verifyUser } = require('./users');

const router = express.Router();

const REMEMBER_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let _oidcClientCache = null;
let _oidcClientKey = '';

async function _hasUsers() {
  const users = await listUsers();
  return users.length > 0;
}

async function _getOidcConfig() {
  return sanitizeOidc(await getSettingJson('oidc'));
}

function _oidcCacheKey(cfg) {
  if (!cfg) return '';
  return JSON.stringify([
    cfg.issuerUrl,
    cfg.clientId,
    cfg.clientSecret,
    cfg.redirectUri,
  ]);
}

async function _getOidcClient() {
  const cfg = await _getOidcConfig();
  if (!cfg) return null;

  const key = _oidcCacheKey(cfg);
  if (_oidcClientCache && _oidcClientKey === key) return _oidcClientCache;

  _oidcClientKey = key;
  _oidcClientCache = oidc.discovery(
    new URL(cfg.issuerUrl),
    cfg.clientId,
    {
      client_secret: cfg.clientSecret,
      redirect_uris: [cfg.redirectUri],
      response_types: ['code'],
    },
    oidc.ClientSecretPost(cfg.clientSecret),
  );
  return _oidcClientCache;
}

function _safeUsername(value) {
  return String(value || '').trim();
}

function _isAllowedEmail(email, allowedEmails) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return false;
  const allowed = Array.isArray(allowedEmails) ? allowedEmails : [];
  return allowed.map(v => String(v || '').trim().toLowerCase()).includes(target);
}

function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  return res.status(401).json({ ok: false, error: 'Not authenticated' });
}

router.get('/me', async (req, res) => {
  if (req.session?.userId) {
    return res.json({
      loggedIn: true,
      username: req.session.username || null,
      authType: req.session.authType || 'local',
    });
  }

  return res.json({
    loggedIn: false,
    setupRequired: !(await _hasUsers()),
  });
});

router.get('/config', async (_req, res) => {
  const cfg = await _getOidcConfig();
  return res.json({
    oidcEnabled: Boolean(cfg),
    providerName: cfg?.providerName || null,
  });
});

router.post('/setup', async (req, res) => {
  if (await _hasUsers()) {
    return res.status(400).json({ ok: false, error: 'Setup already completed' });
  }

  const username = _safeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  try {
    const user = await addUser(username, password);
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.authType = 'local';
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const username = _safeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const rememberMe = Boolean(req.body?.rememberMe);

  if (!(await _hasUsers())) {
    return res.status(400).json({ ok: false, error: 'No users configured yet. Run setup first.' });
  }

  const user = await verifyUser(username, password);
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.authType = 'local';

  if (rememberMe) {
    req.session.cookie.maxAge = REMEMBER_ME_MAX_AGE_MS;
  } else {
    req.session.cookie.expires = false;
  }

  return res.json({ ok: true, user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('pixelplein.sid');
    res.json({ ok: true });
  });
});

router.get('/oidc/start', async (req, res) => {
  const cfg = await _getOidcConfig();
  if (!cfg) return res.status(404).json({ ok: false, error: 'OIDC is not configured' });

  try {
    const client = await _getOidcClient();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();

    req.session.oidcPending = {
      state,
      codeVerifier,
    };

    const params = {
      scope: 'openid email profile',
      redirect_uri: cfg.redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    };

    const authUrl = oidc.buildAuthorizationUrl(client, params);
    return res.redirect(authUrl.href);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `OIDC start failed: ${err.message}` });
  }
});

router.get('/oidc/callback', async (req, res) => {
  const cfg = await _getOidcConfig();
  if (!cfg) return res.redirect('/login.html?error=oidc_not_configured');

  const pending = req.session?.oidcPending;
  if (!pending?.state || !pending?.codeVerifier) {
    return res.redirect('/login.html?error=oidc_state');
  }

  try {
    const client = await _getOidcClient();
    const currentUrl = new URL(`${req.protocol}://${req.get('host')}${req.originalUrl}`);

    const tokenSet = await oidc.authorizationCodeGrant(
      client,
      currentUrl,
      {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: pending.state,
      },
    );

    const userInfo = await oidc.fetchUserInfo(client, tokenSet.access_token);
    const email = String(userInfo.email || '').trim().toLowerCase();

    if (!_isAllowedEmail(email, cfg.allowedEmails)) {
      delete req.session.oidcPending;
      return res.redirect('/login.html?error=not_allowed');
    }

    req.session.userId = `oidc:${email}`;
    req.session.username = email;
    req.session.authType = 'oidc';
    delete req.session.oidcPending;

    return res.redirect('/admin.html');
  } catch (err) {
    delete req.session.oidcPending;
    return res.redirect('/login.html?error=oidc_failed');
  }
});

router.get('/users', requireAuth, async (_req, res) => {
  return res.json({ ok: true, users: await listUsers() });
});

router.post('/users', requireAuth, async (req, res) => {
  const username = _safeUsername(req.body?.username);
  const password = String(req.body?.password || '');

  try {
    const user = await addUser(username, password);
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/users/:username', requireAuth, async (req, res) => {
  const username = _safeUsername(req.params.username);
  if (!username) {
    return res.status(400).json({ ok: false, error: 'Username is required' });
  }

  if (String(req.session.username || '').toLowerCase() === username.toLowerCase()) {
    return res.status(400).json({ ok: false, error: 'You cannot remove your own account' });
  }

  try {
    const user = await removeUser(username);
    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(404).json({ ok: false, error: err.message });
  }
});

router.get('/oidc', requireAuth, async (_req, res) => {
  const cfg = await _getOidcConfig();
  if (!cfg) return res.json({ ok: true, oidc: null });

  return res.json({
    ok: true,
    oidc: {
      issuerUrl: cfg.issuerUrl,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret ? '********' : '',
      redirectUri: cfg.redirectUri,
      providerName: cfg.providerName || '',
      allowedEmails: cfg.allowedEmails || [],
    },
  });
});

router.post('/oidc', requireAuth, async (req, res) => {
  const raw = req.body || {};
  const existing = await _getOidcConfig();

  const merged = {
    issuerUrl: raw.issuerUrl,
    clientId: raw.clientId,
    clientSecret: raw.clientSecret === '********' ? existing?.clientSecret : raw.clientSecret,
    redirectUri: raw.redirectUri,
    providerName: raw.providerName,
    allowedEmails: raw.allowedEmails,
  };

  const next = sanitizeOidc(merged);
  if (!next) {
    return res.status(400).json({ ok: false, error: 'Invalid OIDC config' });
  }

  await setSettingJson('oidc', next);
  _oidcClientCache = null;
  _oidcClientKey = '';
  return res.json({ ok: true });
});

router.delete('/oidc', requireAuth, async (_req, res) => {
  await setSettingJson('oidc', null);
  _oidcClientCache = null;
  _oidcClientKey = '';
  return res.json({ ok: true });
});

module.exports = { router, requireAuth };
