# Theming

PixelPlein supports optional themes that restyle the screen player without touching application code. A theme is a folder under `themes/<id>/` containing a manifest, a stylesheet, an optional overlay HTML fragment, and any assets (images, fonts).

Themes are global — both screens use the same active theme. The active theme is selected from the admin UI (Screens page → Theme dropdown) and takes effect immediately via WebSocket broadcast, with no page reload required. Setting the theme to "None" reverts all screens to default appearance.

---

## Directory structure

```
themes/
  <id>/
    theme.json       required — manifest
    style.css        recommended — CSS custom property overrides
    frame.html       optional — decorative overlay injected over every slide
    assets/          optional — images, fonts, SVGs, etc.
```

The theme `<id>` is the folder name. It must be a single path segment with no slashes (e.g. `camp`, `corporate`, `retro-80s`).

---

## theme.json

```json
{
  "name":        "Camp",
  "description": "Warm rustic campfire aesthetic.",
  "cssFile":     "style.css",
  "frameFile":   "frame.html",
  "fontFaces": [
    {
      "family": "MyFont",
      "src":    "assets/myfont.woff2"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display name shown in the admin dropdown |
| `description` | string | no | Short description shown as hint text |
| `cssFile` | string | no | Path to the theme stylesheet, relative to the theme folder |
| `frameFile` | string | no | Path to the overlay HTML fragment, relative to the theme folder |
| `fontFaces` | array | no | Local font faces to register (see below) |

### fontFaces

Each entry generates an `@font-face` rule. `src` is relative to the theme folder; absolute `https://` URLs are used as-is. The format (`woff2`, `woff`, `truetype`, `opentype`) is inferred from the file extension.

```json
"fontFaces": [
  { "family": "CampScript", "src": "assets/campscript.woff2" }
]
```

For Google Fonts or other CDN fonts, use `@import` in `style.css` instead.

---

## style.css

The stylesheet is injected as a `<link>` on the `<html>` element and is fully cacheable. Define CSS custom properties on `:root` to override the defaults. Every variable has a fallback value in the layout/overlay code matching the original unstyled appearance, so you only need to set the variables you want to change.

### Layout & background

| Variable | Default | Description |
|---|---|---|
| `--screen-bg` | `#000` | Background colour shown behind all layouts and as the mat when `--screen-padding` is set |
| `--screen-padding` | `0px` | Insets all photo layouts from the screen edge, exposing `--screen-bg` as a border/mat around the content |

### Tiles (mosaic, side-by-side, featured-duo)

| Variable | Default | Description |
|---|---|---|
| `--tile-gap` | `2px` | Gap between tiles in grid layouts |
| `--tile-radius` | `0px` | Border radius on each tile (and on the fullscreen image) |
| `--tile-shadow` | `none` | Box shadow on each tile |
| `--tile-border` | `none` | Border on each tile (e.g. `2px solid rgba(180,130,60,0.35)`) |

### Polaroid layout

| Variable | Default | Description |
|---|---|---|
| `--polaroid-bg` | `#18130e` | Background colour of the polaroid scatter canvas |
| `--polaroid-card-bg` | `#fffef8` | Card face colour (the white/cream polaroid body) |
| `--polaroid-card-radius` | `10px` | Corner radius of each card |
| `--polaroid-card-shadow` | `0 24px 60px rgba(0,0,0,0.65), …` | Drop shadow on each card |

### Text-card slide

| Variable | Default | Description |
|---|---|---|
| `--textcard-bg` | `#111` | Slide background |
| `--textcard-color` | `#fff` | Primary text colour |
| `--textcard-accent` | `#6c63ff` | Accent bar / highlight colour |
| `--textcard-font` | `system-ui, sans-serif` | Font family for headings and body |
| `--textcard-title-size` | `clamp(2rem,5vw,4.5rem)` | Title font size |
| `--textcard-body-size` | `clamp(0.95rem,2vw,1.5rem)` | Body text font size |

### QR slide

| Variable | Default | Description |
|---|---|---|
| `--qr-bg` | `#fff` | Slide background |
| `--qr-color` | `#111` | Primary text and QR module colour |
| `--qr-muted-color` | `#666` | Secondary / caption text colour |

### Ticker overlay

| Variable | Default | Description |
|---|---|---|
| `--ticker-bg` | `rgba(0,0,0,0.75)` | Ticker bar background |
| `--ticker-height` | `38px` | Height of the ticker bar |
| `--ticker-radius` | `0px` | Border radius of the ticker bar |
| `--ticker-color` | `#fff` | Text colour |
| `--ticker-font-size` | `18px` | Text size |
| `--ticker-font-weight` | `600` | Text weight |
| `--ticker-font-family` | `'Segoe UI', system-ui, sans-serif` | Font family |
| `--ticker-letter-spacing` | `0.02em` | Letter spacing |
| `--ticker-offset-y` | `0px` | Nudge the ticker away from its screen edge (positive = inward) |

### Corner bug overlay

| Variable | Default | Description |
|---|---|---|
| `--bug-bg` | `rgba(0,0,0,0.55)` | Pill background |
| `--bug-radius` | `6px` | Pill border radius |
| `--bug-padding` | `5px 10px` | Pill padding |
| `--bug-color` | `#fff` | Text colour |
| `--bug-font-size` | `15px` | Text size |
| `--bug-font-weight` | `700` | Text weight |
| `--bug-font-family` | `'Segoe UI', system-ui, sans-serif` | Font family |
| `--bug-offset-x` | `0px` | Nudge horizontally from the chosen corner (positive = inward) |
| `--bug-offset-y` | `0px` | Nudge vertically from the chosen corner (positive = inward) |

### QR bug overlay

| Variable | Default | Description |
|---|---|---|
| `--qr-bug-bg` | `rgba(0,0,0,0.65)` | Pill background |
| `--qr-bug-radius` | `10px` | Pill border radius |
| `--qr-bug-padding` | `8px` | Pill padding |
| `--qr-bug-size` | `min(10vw, 100px)` | Width of the QR image |
| `--qr-bug-label-color` | `#fff` | Caption text colour |
| `--qr-bug-label-size` | `11px` | Caption font size |
| `--qr-bug-label-font-family` | `'Segoe UI', system-ui, sans-serif` | Caption font family |
| `--qr-bug-offset-x` | `0px` | Nudge horizontally from the chosen corner (positive = inward) |
| `--qr-bug-offset-y` | `0px` | Nudge vertically from the chosen corner (positive = inward) |

---

## frame.html

An optional HTML fragment injected as a `position:fixed; inset:0; pointer-events:none` overlay that sits above every slide (`z-index: 100`) but below any UI chrome. Use it for decorative elements that should appear on every slide — corner accents, vignettes, watermarks, etc.

The fragment is wrapped in a `<div id="theme-frame">` which you can target in the fragment's own `<style>` block.

**Rules:**
- `pointer-events` is `none` on the wrapper — the frame must never be interactive.
- Any `<style>` blocks inside the fragment are scoped to `#theme-frame` by convention. Use `#theme-frame .my-element` selectors to avoid leaking styles.
- Paths to assets (images, SVGs) inside the fragment must be absolute from the server root: `/themes/<id>/assets/file.png`. Relative paths will break because the fragment is injected into `screen.html`, not served from the theme folder.

**Example** (`frame.html` from the camp theme):

```html
<style>
  #theme-frame .corner-tl,
  #theme-frame .corner-tr,
  #theme-frame .corner-bl,
  #theme-frame .corner-br {
    position: absolute;
    width: 54px; height: 54px;
    background-image: url("/themes/camp/assets/corner.svg");
    background-size: 54px 54px;
  }
  #theme-frame .corner-tl { top: 12px; left: 12px; }
  #theme-frame .corner-tr { top: 12px; right: 12px; transform: scaleX(-1); }
  #theme-frame .corner-bl { bottom: 12px; left: 12px; transform: scaleY(-1); }
  #theme-frame .corner-br { bottom: 12px; right: 12px; transform: scale(-1); }
</style>

<div class="corner-tl"></div>
<div class="corner-tr"></div>
<div class="corner-bl"></div>
<div class="corner-br"></div>
```

---

## How themes are loaded

1. The admin UI calls `POST /api/config` with `{ theme: "<id>" }`.
2. The server validates the id against the `themes/` directory, persists it to `config.json`, and broadcasts a `config_update` WebSocket message to all connected screens.
3. Each screen player receives the message and calls `applyTheme(id)` in `public/screen/theme.js`.
4. `applyTheme` fetches `theme.json`, then:
   - Injects any `fontFaces` as a `<style id="theme-fonts">` block.
   - Injects `cssFile` as a `<link id="theme-stylesheet">` element on `<head>`.
   - Fetches `frameFile` and injects its content into a `<div id="theme-frame">` appended to `<body>`.
5. When the theme changes again or is set to `null`, all three injected elements are removed before the new theme is applied.

The `style.css` is loaded as a standard stylesheet — CSS custom properties defined on `:root` cascade to every layout, slide, and overlay on the page.

---

## Creating a new theme

```
themes/
  mytheme/
    theme.json
    style.css
    assets/
```

Minimal `theme.json`:

```json
{
  "name": "My Theme",
  "description": "One-line description.",
  "cssFile": "style.css"
}
```

Minimal `style.css` — only override what you need:

```css
:root {
  --screen-bg: #0d0d1a;
  --screen-padding: 24px;
  --tile-gap: 4px;
  --tile-radius: 8px;
  --tile-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
```

The theme will appear in the admin dropdown automatically once the server is (re)started or the page is refreshed — no code changes required.
