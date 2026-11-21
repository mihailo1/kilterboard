# COPILOT — Kilterboard

Agent / Copilot instructions for this repo.

**Language**
- **Product UI = English only**
- **Chat with this user:** prefer Russian when they write in Russian
- **Docs:** English (README, ARCHITECTURE, COPILOT); `AI.md` may be bilingual

**Version:** `package.json` is the source (currently **1.2.0**) → `NEXT_PUBLIC_APP_VERSION` → `lib/version.ts`. Bump `public/sw.js` `VERSION` and add a `lib/changelog.ts` entry in the same release (build fails otherwise). See README "Versions, notices, offline".

## Project

**Kilterboard** — Next.js app for Kilter Board 12×12 + kickboard: catalog, **hold search** (boulders), Set editor (**Open in Set** from climb → `{name} (modified)` draft), Aurora BLE, local **Hold AR** (ONNX in Web Worker). Brand mark matches PWA icons (`public/icons/icon-512.png`).

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
npm run ml:export-v2         # Hold AR v2 dataset → data/ml/v2
npm run ml:train-v2          # Python (ml/hold-ar/.venv): grade predictor + AR model
npm run ml:eval-v2           # generation metrics vs real climbs (see ml/hold-ar/EVAL.md)
npm run ml:export-v2-onnx    # → public/ai/boulder/hold-ar-v2.int8.onnx + grade-v2 + meta
npm run dev                  # http://localhost:3000
npm run build
```

## Product defaults

1. Layout: Kilter original, size **10** (12×12 + kickboard)
2. List filters: all angles default; grades Font/V via difficulty 10–33
3. **List filter persistence:** URL query on `/` or `/holds` + `sessionStorage` `kb:climb-list-qs`. Climb links use `from=`; `BackToClimbs` restores Climbs or Hold search (`view=holds`)
4. **Hold search:** dock **Holds** → `/holds`; boulders only; `?holds=` placement AND-match; no kind filter
5. **Mobile boards:** wrap board surfaces in `MobileBoardScroller` (phone only); Set gesture mode uses `disablePan`
6. **Filter scroll (Climbs only):** manual close sets `filtersPinnedClosed` so near-top scroll doesn’t flash filters open. **Hold search:** no scroll auto-collapse
4. BLE: Chrome/Edge or Android Chrome natively; **iOS Safari via iOSWebBLE extension** (injects `navigator.bluetooth`; detection + install hints in `lib/aurora/ble-env.ts` / `BluetoothSet`). No BLE in iOS Home Screen app or non-Safari iOS browsers
5. AI: **Hold AR v2 only** (local int8 ONNX, best-of-8 by grade). Decoding lives in both `ml/hold-ar/decode.py` and `hold-ar-worker.js` — change both and re-run `ml:eval-v2`. No remix in product UI.
6. Playground: gen + paint; no feedback labels UI

## Layout map

```
app/
  page.tsx · playground/page.tsx · climb/[id]/page.tsx
  api/climbs · api/setters · layout.tsx (AppFooter + version)
components/
  HomeShell · ClimbList · SetStudio · OpenInSetButton · AiPlayground
  PaintBoard · KilterBoard · BluetoothSet · AppFooter
lib/
  version.ts · ai/boulder-ai.ts
  aurora/board.ts · aurora/device.ts
  boardsesh.ts · grades.ts · set-rules.ts · set-drafts.ts
  # openClimbInSetDraft → "{name} (modified)" local draft
public/ai/
  boulder/hold-ar-worker.js · hold-ar-v2.int8.onnx · grade-v2.int8.onnx · hold-ar-v2.meta.json · placement_index.json · models.json
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
