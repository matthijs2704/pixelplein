# AGENTS.md — Coding Agent Guidelines for PixelPlein (photodisplay)

## Project Overview

PixelPlein is a live event photo display system. It consists of:
- A **Node.js/Express backend** (`server/`) that ingests photos, manages configuration, and serves WebSocket updates
- A **vanilla JS frontend** (`public/`) with no bundler, no framework, and no TypeScript — just native ES modules served directly to browsers

---

## Build / Run Commands

| Command | Purpose |
|---|---|
| `npm start` | Start the server (`node server/index.js`, default port 3000) |
| `PORT=8080 npm start` | Start on a custom port |
| `THUMB_W=400 THUMB_H=400 npm start` | Override thumbnail resolution via env vars |

There is **no build step** — the server runs as-is with `node`, and the frontend is served as native ES modules.

### No Linter or Formatter

There is no ESLint, Prettier, or other code quality tool installed. Adhere strictly to existing conventions (see below) instead.

### No Automated Tests

There is no test framework (Jest, Mocha, Vitest, etc.) and no test files. Validation is done manually via the browser and running server. When making changes, test by starting the server and exercising the affected code paths in the browser.

---

## Repository Structure

```
photodisplay/
├── server/                    # Node.js backend (CommonJS, 'use strict')
│   ├── index.js               # Entry point: Express + WebSocket server
│   ├── config.js              # Config load/save/sanitize/defaults
│   ├── state.js               # Shared in-memory runtime state (Maps)
│   └── features/
│       ├── auth/routes.js
│       ├── ingest/            # Photo ingestion, Sharp processing, watcher
│       ├── photos/            # Photo REST API + serialization
│       ├── screens/routes.js  # Config & stats API
│       ├── slides/            # Slides & playlists (REST + store)
│       ├── themes/
│       └── ws/                # WebSocket server (broadcast, handlers)
├── public/                    # Static frontend (vanilla ES modules)
│   ├── screen/                # Display screen JS
│   ├── admin/                 # Admin UI JS
│   └── shared/                # Shared utilities (utils.js, icons.js)
├── themes/                    # CSS theme packages
└── package.json
```

---

## Language and Runtime

- **Server:** JavaScript, Node.js 20+, CommonJS (`require`/`module.exports`), `'use strict'` in every file
- **Frontend:** JavaScript, native ES Modules (`import`/`export`), no TypeScript, no JSX, no framework
- **CSS:** Plain CSS with custom properties; no preprocessors

---

## Code Style Guidelines

### General

- Use `'use strict'` at the top of every server file (CommonJS).
- Keep files focused: one concern per module (routes, state, processing, etc.).
- Prefer plain functions and plain objects over classes and class instances.
- Avoid adding external dependencies unless absolutely necessary.

### Naming Conventions

- **Variables and functions:** `camelCase`
- **Constants and directory path variables:** `UPPER_SNAKE_CASE`
- **Private/internal functions:** prefix with `_` (e.g., `_savePending`, `_clampScreenCount`)
- **Router exports:** named `router` (or descriptively, e.g., `slidesRouter`, `playlistRouter`)
- **Build/layout return objects:** plain object with keys like `{ el, visibleIds, startMotion, slotEls }`

### Imports

**Server (CommonJS):**
```js
'use strict';

const path    = require('path');
const express = require('express');
const sharp   = require('sharp');

const { state }  = require('../../state');
const { config } = require('../../config');
```
- Group: Node built-ins first, then npm packages, then local modules.
- Align `=` signs with tabs for visual grouping within each group.
- Use destructuring where the module exports a named object.

**Frontend (ES Modules):**
```js
import { apiFetch }        from '../api.js';
import { debounce, fmtAgo } from '../../shared/utils.js';
import { renderPhotoTab }  from './photos.js';
```
- Always use **relative paths** with explicit `.js` extension.
- No barrel/index re-exports on the frontend.

### Formatting

- **Indentation:** 2 spaces (server and frontend).
- **Quotes:** single quotes `'...'` throughout (server and frontend).
- **Semicolons:** always present.
- **Trailing commas:** used in multi-line arrays and objects.
- **Line length:** no strict limit; keep lines readable.

### Types and Documentation

- No TypeScript — use JSDoc `@type` annotations for important module-level state:
  ```js
  /** @type {Map<string, Photo>} */
  const photos = new Map();
  ```
- Use `@param` / `@returns` JSDoc for non-obvious functions.
- Do not add type annotations to trivial local variables.

### Error Handling

**Server routes — always return structured JSON:**
```js
// Success
res.json({ ok: true, data: ... });

// Failure
res.status(400).json({ ok: false, error: 'Descriptive message' });
```

**Server async operations — log warnings, don't crash:**
```js
someAsyncOp().catch(err => console.warn('[module] context:', err.message));
```

**Server file/IO operations — use best-effort empty catch when failure is acceptable:**
```js
try { await fs.unlink(tmpPath); } catch {}
```

**Frontend WebSocket messages — silently discard unparseable messages:**
```js
let msg;
try { msg = JSON.parse(event.data); } catch { return; }
```

**Frontend API calls — use `apiFetch` (throws on non-OK), catch and show toast:**
```js
try {
  await apiFetch('/api/endpoint', { method: 'POST', body: JSON.stringify(payload) });
} catch (err) {
  showToast(err.message, true);
}
```

### State Management

**Server:** All mutable server state lives in `server/state.js` as a plain exported object with `Map`s and primitives. Import and mutate it directly — no events, no pub/sub.

**Frontend:** Module-level `let` variables per module; pass state via function arguments or closures. No global store, no reactive framework.

### Configuration

- All config reads and writes go through `server/config.js`; never access `config.json` directly elsewhere.
- Use `sanitizeScreenConfig()` / `sanitizeGlobalConfig()` to validate before saving.
- Config is persisted with atomic write-through (`.tmp` rename) with debounced flush.

### WebSocket Protocol

All messages are plain JSON with a `type` string discriminator:

```js
// Server → Client examples
{ type: 'init', photos: [...], config: {...} }
{ type: 'new_photo', photo: {...} }
{ type: 'config_update', config: {...} }

// Client → Server examples
{ type: 'screen_heartbeat', screenId: '...' }
{ type: 'hero_claim', photoId: '...', screenId: '...' }
```

When adding a new message type, handle it in both `server/features/ws/handlers.js` (incoming) and the appropriate client `switch(msg.type)` dispatcher.

### REST API Conventions

- Use Express `Router` per feature; mount under `/api/` in `server/index.js`.
- Export the router as `module.exports = { router }` (or a named variant).
- Return `{ ok: true, ... }` on success; `{ ok: false, error: '...' }` on failure.
- Use standard HTTP status codes: 200 OK, 400 Bad Request, 401 Unauthorized, 404 Not Found, 500 Server Error.

---

## Key Patterns to Follow

- **Photo ingestion flow:** `watcher.js` → `ingest/index.js` (queue + upsert) → `process.js` (Sharp resize) → broadcast via `ws/index.js`.
- **Screen layout cycle:** `screen/layouts/index.js` selects a layout, calls its `build()`, then calls `startMotion()` if returned. Layouts return `{ el, visibleIds, startMotion? }`.
- **Admin tabs:** each tab in `public/admin/tabs/` exports an `init(container)` function and optionally an `update(data)` function. Tabs are orchestrated by `public/admin/app.js`.
- **Theme system:** themes are subdirectories under `themes/` with a `theme.css` (CSS custom properties) and optional `frame.html`. See `THEMING.md` for authoring reference.
- **Config schema:** `server/config.js` is the source of truth for all config fields, defaults, and validation. When adding config options, update `defaultConfig`, `sanitizeGlobalConfig`/`sanitizeScreenConfig`, and any relevant admin tab UI.
