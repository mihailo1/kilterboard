# Compaction / resume — Kilterboard v1.1.3

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
Version: 1.1.3 (lib/version.ts + package.json) — AppBrand chip.

Product
- Kilter 12×12 + kickboard: Boardsesh catalog, Set, Aurora BLE, Hold AR
- UI English; chat Russian OK
- PWA dock: Climbs | Holds | Set | Hold AR (4-col)
- Hold search /holds — boulders only; pick holds on Set-style board; same filters minus kind
- Brand: violet orb logo + title + version chip; no site footer

AI
- Hold AR only: public/ai/boulder/hold-ar-worker.js + hold-ar-v1.onnx (~33MB)
- playground BLE Connect; no remix UI

Catalog / auto-update
- DB gitignored slim + .gz; pin: manifest-entry.json
- Stale-aware sync:climbs; predev + build ensure
- GH Action boardsesh-refresh every 6h → VERCEL_DEPLOY_HOOK_URL if pin stale
- API: /api/climbs?holds=1,2,3 forces boulders

List state
- URL + sessionStorage kb:climb-list-qs; from= on climb detail
- view=holds restores /holds

Commands
nvm use 22 && npm install && npm run sync:climbs && npm run dev

Docs: README · ARCHITECTURE · AI · COPILOT · PROGRESS · COMPACTION
Scope: this repo only; small diffs; update .md after meaningful work.
```

## Snapshot table

| Item | Value |
|------|--------|
| Version | **1.1.3** |
| Framework | Next **16.3** / React 19 |
| Nav | Dock 4 tabs: Climbs · Holds · Set · Hold AR |
| Hold search | `/holds`, boulders only, `?holds=` AND |
| Climb back | `from` + sessionStorage |
| Boardsesh | stale-aware; ensure predev/build; GH 4×/day |
| Deploy hook | `VERCEL_DEPLOY_HOOK_URL` |

## Commands

```bash
cd ~/Documents/reps.nosync/kilterboard
nvm use 22
npm install
npm run sync:climbs
npm run dev   # http://localhost:3000 · /holds
```
