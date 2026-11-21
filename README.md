# Kilterboard

**v1.1.6** — Web app for the [Kilter Board](https://settercloset.com/pages/kilter-board) (12×12 + kickboard / Aurora).

Browse community climbs, set your own boulders, light a physical board over **Web Bluetooth**, and generate holds with **Hold AR** — a local ONNX transformer that runs entirely in the browser (no cloud AI). Installable as a **PWA** (standalone display, home-screen icons, floating dock nav).

![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![License](https://img.shields.io/badge/license-unofficial-lightgrey)
![AI](https://img.shields.io/badge/AI-local%20ONNX-blue)
![PWA](https://img.shields.io/badge/PWA-standalone-purple)

## Features

- **Climbs** — search Boardsesh catalog (grade, angle, setter, quality, …)
- **Hold search** — `/holds` pick holds on the wall (**boulders only**); same filters minus type
- **Open in Set** — from any climb page, copy boulder/route into Set as a local draft named `{name} (modified)`
- **Set** — paint holds (swipe or palette), multi-frame routes, local drafts
- **Light board** — Web Bluetooth to Aurora / Kilter LEDs (`@hangtime/grip-connect`)
- **Hold AR** — local neural generator (causal Transformer → ONNX → Web Worker)
- **Playground** — `/playground` sandbox to try generation + tweak holds
- **PWA** — installable standalone app, glass dock nav, safe areas, maskable icons

## Requirements

| | |
|--|--|
| Node | **≥ 22** (built-in `node:sqlite`) |
| Browser (app + BLE) | **Chrome** or **Edge** (desktop / Android), or **Safari on iOS / iPadOS 26+** with the [iOSWebBLE](https://apps.apple.com/app/id6761301368) extension |
| Network | `localhost` or HTTPS for Bluetooth |
| Optional hardware | Physical Kilter / Aurora LED board |

**iOS:** Safari has no native Web Bluetooth. The free iOSWebBLE (beacio) Safari extension injects a standard `navigator.bluetooth`; enable it in Settings → Apps → Safari → Extensions and allow it on this site. Does not work in the Home Screen app or in other iOS browsers (Chrome, Firefox…). Desktop Safari and Firefox: not supported.

## Quick start

```bash
git clone https://github.com/mihailo1/kilterboard.git
cd kilterboard
nvm use 22          # or any Node ≥22
npm install
npm run sync:climbs # Boardsesh snapshot → data/boardsesh/ (gitignored)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Mode | URL |
|------|-----|
| Climbs | `/` |
| Hold search (boulders) | `/holds` |
| Set | `/?mode=set` |
| AI playground | `/playground` |
| Climb detail | `/climb/[id]` |

### Climb catalog (Boardsesh)

Climbs come from [Boardsesh board snapshots](https://boardsesh-board-snapshots.t3.tigrisfiles.io/board-snapshots/v1/manifest.json) (Kilter Original layout), filtered to **product size 10**.

```bash
npm run sync:climbs              # stale-aware: skip if builtAt already matches CDN
npm run sync:climbs:force        # always re-download + rebuild slim DB
npm run sync:climbs:check        # exit 0=fresh, 2=stale (for CI)
npm run sync:climbs -- --keep-full
```

`data/boardsesh/*.db` is **gitignored** (too large for the repo). Lightweight `manifest.json` / `manifest-entry.json` **are** committed as a snapshot pin.

**Auto-update**

| Where | How |
|-------|-----|
| **Local** | `predev` → `ensure:climbs` (manifest check; download only if missing/stale) |
| **Vercel build** | same ensure — fresh deploy always can rebuild slim from CDN |
| **Prod (4×/day)** | GitHub Action every **6 hours** compares pin → Vercel Deploy Hook if stale |

Setup prod refresh once:

1. Vercel → Deploy Hooks → create hook for `main`
2. GitHub → Actions secret `VERCEL_DEPLOY_HOOK_URL` = that URL

No always-on backend: serverless cannot hold a shared mutable SQLite. Redeploy = new catalog.

Optional override: set `BOARDSESH_DB_URL` to a public `.db` / `.db.gz` if you host the file yourself.

Requires **Node ≥ 22** (`node:sqlite`). `/api/climbs` returns **503** if the DB is still missing after ensure.

## Hold AR (local AI)

Generation does **not** call OpenAI/Anthropic/etc. **Hold AR v2** is a small transformer trained offline on ~320k real single-frame boulders at every angle, conditioned on grade, angle and how well-rated a climb is. It runs as int8 ONNX with **onnxruntime-web** in a Worker, samples 8 candidates and keeps the one whose predicted grade matches the request.

| Asset | Path |
|-------|------|
| Model | `public/ai/boulder/hold-ar-v2.int8.onnx` (~10 MB) |
| Grade predictor (rerank) | `public/ai/boulder/grade-v2.int8.onnx` (~2.4 MB) |
| Meta + decode defaults | `public/ai/boulder/hold-ar-v2.meta.json` |
| Placement map | `public/ai/boulder/placement_index.json` |
| Worker | `public/ai/boulder/hold-ar-worker.js` |
| Client API | `lib/ai/boulder-ai.ts` |

### Retrain (optional)

```bash
cd ml/hold-ar && python3.12 -m venv .venv && ./.venv/bin/pip install -r requirements.txt && cd ../..
npm run ml:export-v2          # SQLite → data/ml/v2/
npm run ml:train-v2           # grade predictor + AR model (MPS: ~1 h)
npm run ml:eval-v2            # real vs v1 vs v2 generation metrics
npm run ml:export-v2-onnx     # int8 ONNX + meta → public/ai/boulder/
```

See **`AI.md`** (architecture, decode) and **`ml/hold-ar/EVAL.md`** (metrics).

Also useful:

```bash
npm run train:boulder-ai   # rebuild models.json (coords / rules pack)
npm run eval:boulder-ai    # structural eval helpers
```

## Project layout

```
app/                 # Next.js App Router
components/          # UI (SetStudio, ClimbList, PaintBoard, …)
lib/
  ai/boulder-ai.ts   # Hold AR bridge
  aurora/            # board frames + BLE
  boardsesh.ts       # SQLite search
  version.ts         # APP_VERSION (1.1.6)
public/ai/           # ONNX + worker + ort wasm
ml/hold-ar/          # Python train / ONNX export
scripts/             # sync, train pack, ML export
data/kilter/         # layout JSON
docs/                # design notes
```

## Frames format

```
p{placementId}r{roleId}…
```

Multi-frame routes: deltas joined by `,"`.

| Role | Color   | Meaning |
|------|---------|---------|
| 12   | green   | start   |
| 13   | cyan    | hand    |
| 14   | magenta | finish  |
| 15   | orange  | foot    |

## Versions, notices, offline

- **Version** lives in `package.json` only (injected as `NEXT_PUBLIC_APP_VERSION`). `public/sw.js` repeats it in `const VERSION`; the production build fails if they differ, or if the newest `lib/changelog.ts` entry is not that version.
- **Release:** bump `package.json` + `package-lock.json` + `public/sw.js` `VERSION`, add a `lib/changelog.ts` entry (newest first). Users get an "Update / Later" banner, then a "What's new" card once.
- **Silent release** (no banner, auto-reload): `SILENT_UPDATE = true` in `sw.js` **and** `silent: true` on the changelog entry.
- **New climbs:** `/api/climbs/new?since=` → climbs published after the last mark stored in `localStorage`.
- **Offline:** `public/sw.js` caches pages (network-first), `/api/climbs*` answers per query (fallback marked `x-kb-cached`), static chunks, board images and the Hold AR model. Lists show "Climbs will load when you're back online" and reload on reconnect. Service worker runs in production builds only (`npm run build && npm start`).

## Bluetooth (API 3)

Uses Nordic UART-style packets via grip-connect Aurora (same family as Climbest examples). Connect only after a user gesture. Clear LEDs before disconnect when possible.

## Docs

| File | Content |
|------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design |
| [AI.md](./AI.md) | Hold AR pipeline |
| [COPILOT.md](./COPILOT.md) | Agent / contributor map |
| [PROGRESS.md](./PROGRESS.md) | Change log |

## Disclaimer

Unofficial reverse-engineered client. **Not affiliated** with Aurora Climbing, Kilter, or Boardsesh. Use at your own risk; may void warranties. Climb data remains subject to its original sources’ terms.

## Version

**1.3.0** — Hold AR v2: quality/angle-conditioned model with board geometry, best-of-8 by predicted grade, int8 (≈12 MB instead of 33 MB); generated climbs are statistically indistinguishable from well-rated real ones in offline eval (`ml/hold-ar/EVAL.md`).  
**1.2.0** — update prompt (service worker, Update / Later), What's new card per version, "new climbs since your last visit", offline mode (cached pages, Set, drafts, Playground model; climbs reload when back online).  
**1.1.8** — BLE on iPhone/iPad via the iOSWebBLE Safari extension (detection, install steps, Home Screen / other-browser hints).  
**1.1.6** — Open climb in Set (`{name} (modified)` draft); brand icons unified with PWA geometric mark.  
**1.1.5** — Hold search: filters no longer auto-collapse on scroll (manual chip only).  
**1.1.4** — board polish: brand spacing, filter scroll fix, Set/Holds board chrome parity, mobile pan-zoom (`react-zoom-pan-pinch`), touch paint.  
**1.1.3** — hold search (`/holds`, boulders only): wall pick + list filters; compact mobile fields/filter chip; 4-tab dock.  
**1.1.2** — auto Boardsesh catalog refresh (stale-aware sync, `predev`, 4×/day GitHub → Vercel Deploy Hook).  
**1.1.1** — restore climb list filters when leaving climb detail (“All climbs”); AppBrand / dock-only nav.  
**1.1.0** — PWA polish (dock nav, install prompt, safe areas, maskable icons).  
**1.0.0** — first public Hold AR release (local transformer + catalog + Set + BLE).
