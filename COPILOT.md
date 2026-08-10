# COPILOT — Kilterboard

Agent / Copilot instructions for this repo.

**Language**
- **Product UI = English only**
- **Chat with this user:** prefer Russian when they write in Russian
- **Docs:** English (README, ARCHITECTURE, COPILOT); `AI.md` may be bilingual

**Version:** `lib/version.ts` → `APP_VERSION` (currently **1.1.4**). Keep in sync with `package.json`.

## Project

**Kilterboard** — Next.js app for Kilter Board 12×12 + kickboard: catalog, **hold search** (boulders), Set editor, Aurora BLE, local **Hold AR** (ONNX in Web Worker).

Path: `~/Documents/reps.nosync/kilterboard`

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 App Router, React 19, TypeScript |
| Styles | Tailwind CSS 4 — warm dark + violet accent |
| Climb DB | Local SQLite (`node:sqlite`) from Boardsesh CDN |
| Board layout | BoardLib-style JSON (`data/kilter/*`) |
| BLE | `@hangtime/grip-connect` AuroraBoard |
| AI | Hold AR ONNX transformer · `onnxruntime-web` · no cloud LLM |
| Node | **≥ 22** (`nvm use 22`) |

## Commands

```bash
nvm use 22
npm install
npm run sync:climbs          # Boardsesh DB (stale-aware)
npm run sync:climbs:force    # always rebuild slim DB
npm run ensure:climbs        # same as predev / build gate
npm run train:boulder-ai     # rebuild models.json (coords/rules pack)
npm run ml:export-sequences  # Plan B dataset for train
# Python: ml/hold-ar train + export_onnx
npm run ml:export-onnx       # → public/ai/boulder/hold-ar-v1.onnx
npm run dev                  # http://localhost:3000
npm run build
```

## Product defaults

1. Layout: Kilter original, size **10** (12×12 + kickboard)
2. List filters: all angles default; grades Font/V via difficulty 10–33
3. **List filter persistence:** URL query on `/` or `/holds` + `sessionStorage` `kb:climb-list-qs`. Climb links use `from=`; `BackToClimbs` restores Climbs or Hold search (`view=holds`)
4. **Hold search:** dock **Holds** → `/holds`; boulders only; `?holds=` placement AND-match; no kind filter
5. **Mobile boards:** wrap board surfaces in `MobileBoardScroller` (phone only); Set gesture mode uses `disablePan`
6. **Filter scroll:** manual close sets `filtersPinnedClosed` so near-top scroll doesn’t flash filters open
4. BLE: Chrome/Edge or Android Chrome only — **no Safari/iOS**
5. AI: **Hold AR only** (local ONNX). No remix in product UI.
6. Playground: gen + paint; no feedback labels UI

## Layout map

```
app/
  page.tsx · playground/page.tsx · climb/[id]/page.tsx
  api/climbs · api/setters · layout.tsx (AppFooter + version)
components/
  HomeShell · ClimbList · SetStudio · AiPlayground
  PaintBoard · KilterBoard · BluetoothSet · AppFooter
lib/
  version.ts · ai/boulder-ai.ts
  aurora/board.ts · aurora/device.ts
  boardsesh.ts · grades.ts · set-rules.ts · set-drafts.ts
public/ai/
  boulder/hold-ar-worker.js · hold-ar-v1.onnx · placement_index.json · models.json
  ort/   # onnxruntime-web wasm
ml/hold-ar/   # Python train + export
scripts/      # sync, train-boulder-ai, eval, ml export
docs/AI-PLAN-B-STRUCTURED.md
```

## Coding rules

- Small focused diffs; English UI strings only
- `lib/boardsesh.ts` server-only; list via `search_rows`
- BLE after user gesture
- Update docs after meaningful work
- Do not dump full DB / models / feedback into agent chat

## Docs

| File | Purpose |
|------|---------|
| `README.md` | GitHub setup |
| `ARCHITECTURE.md` | System design |
| `AI.md` | Hold AR + training pipeline |
| `COPILOT.md` | This file |
| `PROGRESS.md` | Change log |
| `docs/AI-PLAN-B-STRUCTURED.md` | ML plan history |
