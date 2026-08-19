# Compaction / resume — Kilterboard v1.1.6

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
Version: 1.1.6 (lib/version.ts + package.json) — AppBrand chip.

Product
- Kilter 12×12 + kickboard: Boardsesh catalog, Set, Aurora BLE, Hold AR
- UI English only; chat with user in Russian when they write Russian
- PWA dock: Climbs | Holds | Set | Hold AR (4-col)
- Climb detail: Open in Set → draft "{name} (modified)" then /?mode=set
- Hold search /holds — boulders only; Set-style board chrome; filter chip (manual open/close, NO scroll auto-collapse)
- Climbs list: filters still auto-collapse on scroll
- Mobile boards: MobileBoardScroller (react-zoom-pan-pinch) phone only; Set gesture mode disablePan
- Brand: same geometric mark as PWA (icon.svg / favicon / apple-touch from icon-512.png); no site footer
- Unofficial, not affiliated with Aurora/Kilter/Boardsesh

AI
- Hold AR only: public/ai/boulder/hold-ar-worker.js + hold-ar-v1.onnx (~33MB)
- playground has BLE Connect; no remix / Approve-tags UI
- Train: ml/hold-ar · npm run ml:export-onnx

Catalog / auto-update
- DB gitignored: data/boardsesh/kilter-12x12.db (+ .gz ~37MB slim)
- Pin committed: manifest.json + manifest-entry.json (builtAt)
- Stale-aware: npm run sync:climbs (skip if current); :force / :check
- Local: predev → ensure-boardsesh-db
- Vercel build: ensure on build
- GH Action .github/workflows/boardsesh-refresh.yml every 6h → secret VERCEL_DEPLOY_HOOK_URL if pin stale
- API: /api/climbs?holds=1,2,3 forces kind=boulders (AND match p{id}r in frames)
- /api/climbs 503 if DB missing

List state
- URL query + sessionStorage kb:climb-list-qs
- Climb links from=; BackToClimbs; view=holds restores /holds

Commands
nvm use 22 && npm install && npm run sync:climbs && npm run dev
# http://localhost:3000 · /holds · /?mode=set · /playground

Docs: README · ARCHITECTURE · AI.md · COPILOT · PROGRESS · COMPACTION
Scope: only this repo. Prefer small diffs; update .md after meaningful changes.
```

## Snapshot table

| Item | Value |
|------|--------|
| Version | **1.1.6** |
| Open in Set | Climb page → draft `{name} (modified)` |
| Brand icons | UI + favicon + apple = PWA geometric mark |
| Framework | Next **16.3** / React 19 |
| Nav | Dock: Climbs · Holds · Set · Hold AR |
| Hold search | `/holds`, boulders only, `?holds=` AND |
| Hold filters | Manual chip only (no scroll collapse) |
| Climbs filters | Scroll auto-collapse on |
| Boards phone | pan/zoom `react-zoom-pan-pinch` |
| Boardsesh | stale-aware; GH Action 4×/day + Deploy Hook |

## Commands

```bash
cd ~/Documents/reps.nosync/kilterboard
nvm use 22
npm install
npm run sync:climbs   # no-op if already current
npm run dev           # http://localhost:3000
```
