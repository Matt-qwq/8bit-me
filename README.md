# 8bit-me

A pixel-art blog and 8-bit experiment playground built with Astro: canvas background effects, chip-tune SFX, 13 pixel themes, and a CRT-style page transition. Live site: <https://8bit-me.netlify.app/>

[![CI](https://github.com/Matt-qwq/8bit-me/actions/workflows/ci.yml/badge.svg)](https://github.com/Matt-qwq/8bit-me/actions/workflows/ci.yml)

📖 [中文文档 / Chinese](README.zh-CN.md)

## Features

- **Single-page five-section homepage** (hero / about / projects / skills / contact) with staggered pixel reveals — always visible under reduced motion
- **BgFx canvas background** — "machine core" PCB layer (chip sockets, Manhattan traces, signal packets, boot ceremony), five layout variants that reorganize by section, and a 2D camera with scroll + mouse parallax; sits under a fixed 72% scrim readability contract
- **CRT beam page transition** — single-signature shutter with WAAPI `steps()` integer-teeth animation (0.34 s exit / 0.28 s enter)
- **Chip-tune SFX** — Web Audio synthesized, zero audio files, six role-based sounds (nav / click / toggle / select / game / hover)
- **13 pixel themes** from a single source (`src/lib/themes.ts`), Game-Boy palette family, FOUC-safe preload
- **Custom cursor**, **Konami easter egg**, **404 whack-a-mole mini-game**
- **Accessibility contract** — `prefers-reduced-motion` degrades ambient effects (BgFx keeps running at low rate, cursor falls back to a static reticle); readability scrim is a non-negotiable 72%
- **Zero-backend static site** — Astro `output: 'static'`, Markdown content pipeline, no CMS, no build-time secrets

## Tech stack

Astro 7 · TypeScript canvas (no animation libraries) · Vitest (unit) · Playwright with system Chrome (e2e smoke) · self-hosted Zpix pixel font (subsetted at build)

## Getting started

```bash
# node >= 22 (see .nvmrc)
npm i
npm run dev        # http://localhost:4321
npm run build      # outputs dist/
npm run preview    # preview the built site (port 4322 for e2e)
```

## Customization

- **Posts**: add a `.md` file in `src/content/blog/` with frontmatter `title / date / description / tags / cover? / draft` (`draft: true` is not routed). Schema: `src/content.config.ts`.
- **Site copy & nav**: `src/lib/config.ts`; theme palettes: `src/lib/themes.ts`.
- **Sections**: `src/components/sections/*.astro`.
- **Background animation**: pure functions in `src/lib/bgfx-motion.ts` (machine geometry / camera / glow math, unit-tested); painting in `src/components/BgFx.astro`; runtime scaffold `src/lib/fx-runtime.ts`.
- **Sounds**: mark elements with `data-sfx-role` / `data-sfx-hover`; roles map in `src/lib/sfx.ts`.

## Deployment

`npm run build` produces a fully static `dist/` — deploy to any static host (Netlify, GitHub Pages, Cloudflare Pages, object storage). A `netlify.toml` example is included. Env vars: `ASTRO_SITE` / `ASTRO_BASE` (optional — when unset, canonical/OG URLs are skipped, so it runs standalone anywhere).

## Testing

- `npm run test:unit` — Vitest unit tests for the pure-logic layer (`palette` / `bgfx-motion` / `fx-moment` / `trans-math` / `themes` / `config` / `posts` …)
- `npm run test:e2e` — Playwright smoke after build: four routes render, zero console errors, transition DOM link, interaction assertions. e2e depends on system Chrome and stays a local acceptance step.
- **CI quality gate** (`.github/workflows/ci.yml`): `typecheck` + `test:unit` + `build` on every push and PR.

## Repository layout

```
src/
  components/        # BgFx / CursorFx / PageTrans / Nav / Footer … (incl. sections/)
  content/           # blog posts (Markdown content pipeline)
  layouts/           # BaseLayout: theme injection + fixed mount order
  lib/               # pure-logic layer (vitest targets): palette / bgfx-motion / fx-moment /
                     #   trans-math / themes / config / posts / prefs / sfx
  pages/             # index (five sections) / blog / blog/[slug] / 404
  styles/            # global.css (Zpix pixel-typography scale + :root tokens)
docs/adr/            # architecture decision records (0001 superseded by 0009)
tests/               # unit (vitest) + e2e (playwright)
```

## Update cadence

This repository is a public mirror of the project's working repository and is refreshed periodically; it contains only public content. See `docs/adr/0009-open-source-public-repo.md`.

## License

- Code and docs: **MIT** — see `LICENSE`.
- The **Zpix** pixel font is a third-party font by SolidZORO (free for personal and education use; commercial use requires a paid license from the author) and is **not** covered by the MIT license — see `Zpix-NOTICE.md`.