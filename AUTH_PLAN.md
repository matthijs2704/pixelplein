# Auth Plan — Session-based login + optional OIDC

Replace the PIN-per-request header scheme with proper server-side sessions and a
standalone login page. Two login paths: local username/password (always available,
works offline) and optional OIDC (any generic OpenID Connect provider).

---

## Design decisions

- **No backwards compatibility** with the old `adminPinHash` / `X-Admin-Pin` approach — rip it out entirely.
- **Separate login page** (`/login.html`) — not an overlay.
- **Local accounts always available** as a fallback even when OIDC is configured (needed for LAN/offline events).
- **OIDC whitelist** by exact email address — any successfully authenticated OIDC user whose email is not in the whitelist is rejected.
- **"Remember me"** checkbox on login: checked → 30-day persistent cookie; unchecked → session cookie (gone on tab close).
- **First-run setup** via CLI command — no auto-migration from old PIN hash.
- **Screen clients** (`screen.html`) remain unauthenticated — they only receive broadcast WS events.
- **No roles/permissions** — any logged-in user is a full admin.
- **In-memory session store** — sessions are lost on server restart, which is acceptable for an event tool.

---

## New dependencies

| Package | Purpose |
|---|---|
| `express-session` | Server-side session middleware |
| `openid-client` | OIDC/OAuth2 — discovery, PKCE, token exchange |

`bcryptjs` is already present.

Install:
```
npm install express-session openid-client
```

---

## New files

| File | Purpose |
|---|---|
| `server/cli.js` | CLI tool: `add-user`, `remove-user`, `list-users` |
| `server/features/auth/users.js` | Pure user management functions (shared by routes + CLI) |
| `public/login.html` | Standalone login page |
| `public/login/app.js` | Login page JS module |

---

## Changed files

### `package.json`
Add `express-session` and `openid-client` to `dependencies`.

---

### `server/config.js`

Remove:
- `adminPinHash` from `defaultConfig`, `sanitizeGlobalConfig`, `getPublicConfig`, and any merge logic

Add to `defaultConfig`:
```js
users: [],   // [{ id, username, passwordHash }]
oidc:  null, // { issuerUrl, clientId, clientSecret, redirectUri, allowedEmails: [] } | null
```

Add to `sanitizeGlobalConfig`:
- `users` — pass through as-is (managed only via CLI and auth routes, not via the main config save endpoint)
- `oidc` — validate shape when not null; strip unknown keys

`getPublicConfig` must **never** include `users` (contains password hashes) or `oidc.clientSecret`.

---

### `server/features/auth/users.js` *(new)*

Pure functions that read/write users via `getConfig`/`saveConfig`. Used by both
`routes.js` and `cli.js` so neither duplicates logic.

```js
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getConfig, saveConfig } = require('../../config');

function listUsers() { /* returns array of { id, username } — no passwordHash */ }
function getUsers()  { /* returns full array including passwordHash — internal only */ }
async function addUser(username, password) { /* validates, hashes, appends, saves */ }
async function removeUser(username) { /* finds and splices, saves */ }
async function verifyUser(username, password) { /* returns { id, username } or null */ }

module.exports = { listUsers, addUser, removeUser, verifyUser };
```

Rules:
- Username: 1–50 chars, alphanumeric + `_` + `-` + `.`
- Password: minimum 8 characters
- Reject duplicate usernames (case-insensitive)
- `id` is a random hex string (`crypto.randomBytes(8).toString('hex')`)

---

### `server/cli.js` *(new)*

```
node server/cli.js add-user <username> <password>
node server/cli.js remove-user <username>
node server/cli.js list-users
```

- Loads config, calls user management functions, saves, prints result, exits.
- Print clear error messages for bad input (duplicate username, user not found, etc.)
- Does **not** start the HTTP server.

Example output:
```
$ node server/cli.js add-user alice hunter2
User 'alice' added.

$ node server/cli.js list-users
Users:
  alice (id: a3f1...)

$ node server/cli.js remove-user alice
User 'alice' removed.
```

---

### `server/features/auth/routes.js` *(full rewrite)*

Exports: `router`, `requireAuth`

#### Routes

```
GET  /api/auth/me              — { loggedIn, username?, setupRequired? }
POST /api/auth/login           — { username, password, rememberMe? } → sets session
POST /api/auth/logout          — destroys session, responds { ok: true }
POST /api/auth/setup           — { username, password } — only works when users list is empty
GET  /api/auth/config          — { oidcEnabled, providerName? } — public, used by login page
GET  /api/auth/oidc/start      — redirects to OIDC provider; 404 if OIDC not configured
GET  /api/auth/oidc/callback   — validates response, checks whitelist, sets session, redirects
```

`/api/auth/users` sub-routes (protected by `requireAuth`):
```
GET    /api/auth/users         — list users (no password hashes)
POST   /api/auth/users         — { username, password } — add user
DELETE /api/auth/users/:username — remove user (cannot remove yourself)
```

OIDC config routes (protected by `requireAuth`):
```
POST /api/auth/oidc            — save OIDC config { issuerUrl, clientId, clientSecret, redirectUri, allowedEmails }
DELETE /api/auth/oidc          — disable OIDC (sets config.oidc = null)
```

#### `requireAuth` middleware

```js
function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ ok: false, error: 'Not authenticated' });
}
```

#### Session setup (done in `server/index.js`, not here)

Cookie options:
- `httpOnly: true`
- `sameSite: 'lax'`
- `secure: false` (set to `true` if `NODE_ENV=production` and behind HTTPS)
- `maxAge`: set to 30 days (ms) when `rememberMe` is true; omit for session cookie

#### OIDC flow

Use `openid-client` with provider discovery:

1. `GET /api/auth/oidc/start`:
   - Load OIDC config from `getConfig().oidc`; 404 if null
   - Discover issuer via `Issuer.discover(issuerUrl)`
   - Generate PKCE `code_verifier` + `code_challenge`
   - Generate `state` nonce
   - Store `{ codeVerifier, state }` in `req.session.oidcPending`
   - Redirect to authorization URL

2. `GET /api/auth/oidc/callback`:
   - Read `{ codeVerifier, state }` from `req.session.oidcPending`; reject if missing or state mismatch
   - Exchange code for tokens
   - Extract `email` from ID token claims
   - Check `allowedEmails` whitelist (case-insensitive); redirect to `/login.html?error=not_allowed` if not listed
   - Set `req.session.userId = 'oidc:' + email`, `req.session.username = email`
   - Clear `req.session.oidcPending`
   - Redirect to `/admin.html`

---

### `server/index.js`

Add before routes:
```js
const session = require('express-session');

app.use(session({
  secret: _getOrCreateSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
}));
```

`_getOrCreateSessionSecret()`: reads `config.sessionSecret`; if not set, generates one with
`crypto.randomBytes(32).toString('hex')`, saves it to config, and returns it. This ensures
sessions survive server restarts (the secret is stable).

Add to `server/config.js` `defaultConfig`: `sessionSecret: null`.

Change all `requirePin` → `requireAuth`:
```js
const { requireAuth } = require('./features/auth/routes');

app.use('/api/auth',      authRouter);
app.use('/api/photos',    requireAuth, photosRouter);
app.use('/api/slides',    requireAuth, slidesRouter);
app.use('/api/playlists', requireAuth, playlistRouter);
app.use('/api/themes',    themesRouter);  // still public
app.use('/api',           requireAuth, screensRouter);
```

---

### `public/login.html` *(new)*

Standalone page — same dark colour scheme as `admin.html`, no sidebar.

Sections (conditionally rendered by `login/app.js`):

**Normal state** — login form:
- Username input
- Password input
- "Remember me" checkbox
- "Sign in" button
- Error message area
- "Sign in with [provider]" button (rendered only when `oidcEnabled: true` from `/api/auth/config`)

**Setup state** (`setupRequired: true` from `/api/auth/me`) — first-run form:
- Heading: "Create first admin account"
- Username input
- Password input + confirm password input
- "Create account" button
- Uses `POST /api/auth/setup`

**OIDC error state** (`?error=not_allowed` in URL):
- Show "Your account is not authorised to access this system" message above the form

---

### `public/login/app.js` *(new)*

ES module. On load:
1. Check URL for `?error=not_allowed` — show error if present
2. `GET /api/auth/me` — if `loggedIn: true`, redirect to `/admin.html` immediately
3. If `setupRequired: true`, render setup form; otherwise render login form
4. `GET /api/auth/config` — if `oidcEnabled`, show OIDC button

Login form submit:
- `POST /api/auth/login` with `{ username, password, rememberMe }`
- On `{ ok: true }` → `location.href = '/admin.html'`
- On error → show inline error message

Setup form submit:
- Validate passwords match client-side
- `POST /api/auth/setup` with `{ username, password }`
- On `{ ok: true }` → `location.href = '/admin.html'`

---

### `public/admin/api.js`

Remove:
- `getStoredPin`, `storePin`, `setUnauthorizedHandler`
- PIN header injection in `apiFetch`
- `uploadFiles` PIN header injection

Change 401 handling in `apiFetch`:
```js
if (res.status === 401) {
  location.href = '/login.html';
  throw new Error('Not authenticated');
}
```

---

### `public/admin/app.js`

On boot:
```js
// Check session before doing anything else
const me = await fetch('/api/auth/me').then(r => r.json());
if (!me.loggedIn) { location.href = '/login.html'; return; }
```

Remove:
- `_showPinOverlay`, `_hidePinOverlay`, `_setPinOverlayError`, `_submitPinOverlay`, `_bindPinOverlay`
- `setUnauthorizedHandler` import and call
- `storePin`, `getStoredPin` imports

Add logout button to the admin sidebar/header that calls `POST /api/auth/logout` then redirects to `/login.html`.

---

### `public/admin.html`

Remove:
- PIN overlay `<div class="modal-backdrop" id="pin-overlay">` and all its children
- PIN overlay CSS (`.pin-overlay-*` if any was added)
- "Admin PIN" `<details>` block in the Settings page

Add:
- Logout button in the sidebar (near the bottom, or in a top bar)
- "Users" section in Settings page (see below)
- "OIDC / Single Sign-On" section in Settings page (see below)

#### Users section (Settings page)

```
Users
─────────────────────────────────────
alice                        [Remove]
bob                          [Remove]

Add user
  Username: [____________]
  Password: [____________]
            [Add user]
```

#### OIDC / Single Sign-On section (Settings page)

```
Single Sign-On (OIDC)
─────────────────────────────────────
[ ] Enable OIDC login

When enabled:
  Provider (Issuer URL): [________________________________]
  Client ID:             [________________________________]
  Client Secret:         [________________________________]
  Redirect URI:          [________________________________]
    Hint: set this to https://your-server/api/auth/oidc/callback

  Allowed emails (one per line):
  [________________________________]
  [________________________________]

  [Save SSO config]       [Disable SSO]
```

---

### `public/admin/tabs/settings.js`

Remove:
- `setPin`, `loadPinStatus`, `storePin` imports
- All PIN-related functions and bindings

Add:
- `initUsersSection()` — loads user list from `GET /api/auth/users`, renders it, binds add/remove
- `initOidcSection()` — loads current OIDC config (redacted secret) from a new `GET /api/auth/oidc` route, renders form, binds save/disable

`GET /api/auth/oidc` (protected) returns current OIDC config with `clientSecret` replaced by `"••••••••"` if set, or `null` if not configured.

---

## Commit sequence

Each commit covers one logical unit:

1. `add express-session and openid-client dependencies`
2. `replace adminPinHash with users, oidc, and sessionSecret in config`
3. `add user management module (users.js)`
4. `add cli tool for user management`
5. `rewrite auth routes: sessions, local login, oidc flow, user api`
6. `wire requireAuth into server, add session middleware`
7. `add login page`
8. `replace pin auth in admin with session redirect and logout`
9. `replace pin settings with users and oidc config ui`

---

## Testing checklist (manual)

- [ ] Fresh install (no users): visiting `/admin.html` redirects to `/login.html` which shows the "Create first admin" form
- [ ] `node server/cli.js add-user admin password123` creates a user; `list-users` shows it
- [ ] Login with correct credentials → lands on `/admin.html`
- [ ] Login with wrong credentials → shows error, stays on login page
- [ ] "Remember me" checked → cookie survives tab close; unchecked → gone on tab close
- [ ] Logging out → redirected to `/login.html`, session gone
- [ ] Direct access to `/api/photos` without session → 401 → admin JS redirects to `/login.html`
- [ ] OIDC: with provider configured and email in whitelist → login succeeds
- [ ] OIDC: with email NOT in whitelist → redirected to `/login.html?error=not_allowed`
- [ ] OIDC not configured: "Sign in with provider" button not shown on login page
- [ ] Adding a user from Settings UI → appears in user list
- [ ] Removing a user from Settings UI → removed; cannot remove yourself
- [ ] Screen clients (`/screen.html`) are unaffected — no auth required
