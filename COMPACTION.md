# Compaction / resume — Kilterboard v1.1.4

## How to use

1. Paste the **Resume block** below into a new agent session (or after `/compact`).
2. Point at repo: `~/Documents/reps.nosync/kilterboard`
3. Read on demand: `COPILOT.md` → `PROGRESS.md` → `ARCHITECTURE.md` / `AI.md`
4. Do **not** dump DB/ONNX into chat.

## Resume block (paste this)

```
Kilterboard — Next.js 16 App Router, React 19, Tailwind 4, Node ≥22 (node:sqlite).
Path: ~/Documents/reps.nosync/kilterboard
GitHub: https://github.com/mihailo1/kilterboard (main)
Version: 1.1.4 (lib/version.ts + package.json) — AppBrand chip.

Product
- Kilter 12×12 + kickboard: Boardsesh catalog, Set, Aurora BLE, Hold AR
- UI English; chat Russian OK
- PWA dock: Climbs | Holds | Set | Hold AR (4-col)
- Hold search /holds — boulders only; Set-style board chrome; filters chip
- Mobile boards: MobileBoardScroller (react-zoom-pan-pinch) phone only
- Brand: orb fill (no ring gap); v + version spacing; no site footer

AI
- Hold AR only: hold-ar-worker.js + hold-ar-v1.onnx (~33MB); playground BLE

Catalog / auto-update
- Stale-aware sync:climbs; predev + build ensure
- GH Action boardsesh-refresh every 6h → VERCEL_DEPLOY_HOOK_URL if pin stale
- API: /api/climbs?holds=1,2,3 forces boulders

List / filters
- URL + sessionStorage kb:climb-list-qs; from= / view=holds
- filtersPinnedClosed avoids open flash at scroll≈0 after manual close

Commands
nvm use 22 && npm install && npm run sync:climbs && npm run dev

Docs: README · ARCHITECTURE · AI · COPILOT · PROGRESS · COMPACTION
Scope: this repo; small diffs; update .md after meaningful work.
```

## Snapshot table

| Item | Value |
|------|--------|
| Version | **1.1.4** |
| Framework | Next **16.3** / React 19 |
| Nav | Dock 4 tabs |
| Hold search | `/holds`, boulders only |
| Boards phone | pan/zoom via `react-zoom-pan-pinch` |
| Boardsesh | stale-aware; GH 4×/day deploy hook |

## Commands

```bash
cd ~/Documents/reps.nosync/kilterboard
nvm use 22
npm install
npm run sync:climbs
npm run dev
```
