# Kanamiisa Architecture

Static cosplay landing page for kanamiisa.uk — single `index.html` with embedded CSS/JS, no build step.

## Structure

```
index.html          → Main (and only) page: hero, photo bg, links, minigame
gallery/            → 24 cosplay photos (WebP primary + -sm.jpg fallback)
qrcode.js           → QR library (unused on this page, kept for other branches)
wrangler.jsonc      → Cloudflare Workers config (if deployed via CF)
```

## Photo Background

- 24 `<picture>` elements inside `<div id="photoBg">` (absolute, overflow:hidden, z-index:0)
- Each `<picture>`: `<source srcset="*.webp">` + `<img src="*-sm.jpg">` fallback
- Layout computed by `layoutPhotoBg()` — 8×3 grid (desktop) / 6×4 grid (mobile <768px)
- Scale factor `s` makes grid overflow `w*0.1` on both left and right edges (symmetric bleed)
- `<div class="photo-bg__overlay">` gray overlay at 39% opacity
- `.hero-layer` wraps `.hero`, centered via flex inside photo-bg (z-index:2)
- `.content` has `margin-top = targetH` so all sections sit below the gallery

## Hero Card

- `.hero` — white card with gradient opacity background (15→45→60→80→85%)
- Contains: avatar (dark circle, magenta border, cyan glow), KANAMI name (cyan), subtitle (magenta), bio
- `max-width: 520px`, centered

## Palette (Miku theme)

All via CSS custom properties in `:root`:

| Variable | Value | Usage |
|----------|-------|-------|
| `--bg` | `#07070b` | Page background |
| `--bg2` | `#0f0f16` | Card backgrounds |
| `--accent` | `#1fd9e6` | Cyan/turquoise (primary) |
| `--accent2` | `#ff4fa6` | Pink/magenta (secondary) |
| `--glow` | `rgba(31,217,230,0.35)` | Glow effects |
| `--text` | `#f3f8f9` | Primary text (white) |
| `--text-dim` | `#7d8f93` | Secondary text |
| `--card-bg` | `rgba(255,255,255,0.05)` | Glass card fill |
| `--card-border` | `rgba(255,255,255,0.10)` | Glass card border |

## Features

- **Cursor particle trail** — canvas overlay, particles follow mouse
- **Music minigame** — canvas-based, score counter
- **Miku easter egg** — visible ♪ button (bottom-left), 5 clicks → shows `.miku-overlay` + floating notes
- **Animated section titles** — wave-fill animation on scroll

## Image Optimization

- Originals: ~6 MB total (JPG, 1000–2000px)
- Optimized: ~1.5 MB total (WebP 0.65 MB + resized JPG fallback 0.89 MB)
- Resize to max 500px long side via `sharp` (one-time, script removed after use)
- `<picture>` with WebP `<source>` + JPG `<img>` fallback

## Links Section

Social links rendered as `.link-btn` with inline SVG icons:

- Instagram (`kanami_coser`)
- Telegram ЛС (`medik_kgz`)
- TikTok (`@kanashiiookami`)
- Spotify
- Яндекс.Музыка (official logo, monochrome)
- Rin & Len Confession (TG)
- Личный канал (TG invite)
- Приложения (TG)
- Мемы (TG)

## Deployment

- GitHub repo: `Kristy98755/kanamiisa`
- Cloudflare Workers possible via `wrangler.jsonc`
