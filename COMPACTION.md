# Compaction / resume — Kilterboard v1.1.2

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
Version: 1.1.2 (lib/version.ts + package.json) — AppBrand chip, not footer.

Product
- Kilter 12×12 + kickboard: Boardsesh catalog, Set studio, Aurora BLE, local Hold AR
- UI English only; chat with user in Russian when they write Russian
- PWA: standalone manifest, glass bottom dock (Climbs / Set / Hold AR), InstallPrompt
- No site footer; brand = orb logo + title + v1.1.2 (AppBrand)
- Logo: pure violet radial sphere; glow via filter drop-shadow

AI
- Hold AR only: public/ai/boulder/hold-ar-worker.js + hold-ar-v1.onnx (~33MB)
- lib/ai/boulder-ai.ts bridge; playground has BLE Connect
- No remix / Approve-tags in UI
- Train: ml/hold-ar · npm run ml:export-onnx

Catalog / auto-update (v1.1.2)
- DB gitignored: data/boardsesh/kilter-12x12.db (+ .gz ~37MB slim)
- Stale-aware sync: npm run sync:climbs (skip if builtAt matches CDN)
- Local: predev → ensure-boardsesh-db
- Vercel build: ensure downloads latest if missing/stale on build machine
- GitHub Action boardsesh-refresh.yml every 6h → Deploy Hook if pin stale
- Secret: VERCEL_DEPLOY_HOOK_URL (set once in GitHub Actions)
- /api/climbs 503 if DB missing

List filters
- URL query + sessionStorage kb:climb-list-qs; climb links from=; BackToClimbs

Commands
nvm use 22 && npm install && npm run sync:climbs && npm run dev

Docs: README · ARCHITECTURE · AI.md · COPILOT · PROGRESS · COMPACTION
Scope: only this repo. Prefer small diffs; update .md after meaningful changes.
```

## Snapshot table

| Item | Value |
|------|--------|
| Version | **1.1.2** |
| Framework | Next **16.3** / React 19 |
| AI product | Hold AR ONNX only |
| Nav | Bottom dock; AppBrand version chip |
| Climb back | `from` + sessionStorage |
| Boardsesh | stale-aware sync; ensure on predev/build; GH Action 4×/day |
| Deploy hook | `VERCEL_DEPLOY_HOOK_URL` secret |

## Commands

```bash
cd ~/Documents/reps.nosync/kilterboard
nvm use 22
npm install
npm run sync:climbs   # no-op if already current
npm run dev           # predev ensures catalog
```
