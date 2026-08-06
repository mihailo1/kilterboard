# Progress & knowledge log — Kilterboard

**Standing rule for agents and humans:** after meaningful work (features, decisions, gotchas, defaults), **update the `.md` docs in this repo** so the next session does not rediscover everything from chat.

| File | When to update |
|------|----------------|
| `PROGRESS.md` | This log — ship notes, decisions, open questions |
| `ARCHITECTURE.md` | Design, data contracts, filters, frame format, API |
| `COPILOT.md` | Agent orientation, layout map, product defaults, coding rules |
| `AI.md` | Local boulder AI — pipeline, remix rules, feedback roadmap |
| `COMPACTION.md` | Compact paste block + product snapshot table |
| `README.md` | Human setup only when install/run steps change |

**Always do this** when finishing a task that changes behavior or encoding knowledge (not for pure typo fixes).

---

## 2026-08-06 — Prod 503 /api/climbs (Vercel)

- **Cause:** `data/boardsesh/*.db` gitignored → no catalog on deploy → API returned 503
- **Fix:** slim DB (~120MB) + `.gz` (~37MB) from `sync-boardsesh.mjs`; `ensure-boardsesh-db.mjs` on `npm run build` (Vercel); runtime gunzip to `/tmp`; `outputFileTracingIncludes` for API routes
- Optional `BOARDSESH_DB_URL` for hosted db/gz

## 2026-08-06 — v1.1.0 PWA polish

- Floating glass **dock** (Climbs / Set / Hold AR) + safe-area insets
- Install chip (`beforeinstallprompt` + iOS tip), standalone CSS
- Manifest: shortcuts, maskable icons, categories; new icon art
- Footer above dock with version **1.1.0**; sticky Set palette clears dock
- Home header app-style title; mobile mode switch hidden (dock is primary)

## 2026-08-06 — Remove Approve/tags from playground

- Playground is gen + paint only (Hold AR); no feedback labels UI
- `lib/ai/feedback.ts` / `apply-feedback` left as legacy (unused by UI)

## 2026-08-06 — Transformer HoldAR + remix removed

- **Arch:** causal Transformer (d=384, 4 layers, 6 heads, ~8.7M params) + BOS/grade
- **Train complete (12 ep, ~2.9h MPS):** best **epoch 8** val_acc **19.9%** / top-5 **44.8%** (GRU was 17.6%)
- **ONNX** `public/ai/boulder/hold-ar-v1.onnx` (~33MB fp32) from best ckpt; parity ok
- **UI:** remix removed; Set + Playground = Hold AR only
- **Worker:** reach/foot masks + polishClimb

## 2026-08-06 — Plan B4: Hold-AR in browser Worker

- `public/ai/boulder/hold-ar-worker.js` — onnxruntime-web WASM, AR decode, illegal mask, polishClimb
- `public/ai/ort/*` — ORT wasm assets; dep `onnxruntime-web`
- `lib/ai/boulder-ai.ts` — dual worker: remix + `hold-ar` (`loadHoldArAi`)
- UI toggle **Grade remix | Hold AR (NN)** in Set + Playground
- Default remains remix; Hold AR loads ONNX on demand / prefetch
- Next: B5 human A/B + optional eval script for hold-ar

## 2026-08-06 — Plan B3: ONNX export (no quant)

- `ml/hold-ar/export_onnx.py` — fp32 ONNX, TorchScript exporter (`dynamo=False`)
- Forward made ONNX-friendly (no `pack_padded_sequence`)
- Parity: max_abs **~5e-6**, argmax **32/32**
- Artifacts: `artifacts/hold-ar-v1.onnx` (~2.7MB) → `public/ai/boulder/hold-ar-v1.onnx` + `hold-ar-v1.meta.json`
- `npm run ml:export-onnx`
- Next: **B4 Worker + decode**

## 2026-08-05 — Plan B2: train hold-ar (MPS)

- Full train: **87 877** climbs → **1.13M** train prefixes, 8 epochs, batch 512, **MPS**
- Params ~**708k**; best **val_loss 3.65**, **val_acc 0.176** (next-token / STOP)
- Checkpoint: `ml/hold-ar/artifacts/hold-ar-v1.pt` + `metrics.json`
- Fixed batched GRU (`pack_padded_sequence`); device `auto|mps|cuda|cpu`
- Next: **B3 ONNX export** + Worker inference

## 2026-08-05 — Plan B1: export sequences + train scaffold

- `npm run ml:export-sequences` → `data/ml/climbs-40.jsonl` (**97 737** climbs), split train 87 877 / val 9 860
- `placement_index.json`: N=476, vocab=1905; slim in `public/ai/boulder/`
- Scaffold: `ml/hold-ar/train.py` (GRU), `requirements.txt`, README

## 2026-08-05 — Plan B: structured local NN

- Added `docs/AI-PLAN-B-STRUCTURED.md`: autoregressive next-hold policy, ONNX in Worker, phases B0–B7

## 2026-08-04 — Playground edit holds (replaces bad-flag UX)

- **PaintBoard**: add/change/erase holds after gen (palette); yellow ring = changed vs AI
- Feedback: `holds` = final, `originalHolds` = gen, `edited`; reject allowed if only edited
- apply-feedback: removed → downweight, added → boost (legacy holdFlags still supported)
- Still: screw-on rules in genRemix; too-hard + actualGrade

## 2026-08-04 — Hold flags + screw-on rules (partially superseded)

- Tap-to-flag shipped then replaced by full edit; holdFlags kept as legacy in apply-feedback
- genRemix screw-on / setByPlacement still active

## 2026-08-03 — Feedback tags + apply-feedback

- Playground: fixed multi-select tags (`reach`, `feet`, `left-right`, `line`, `grade`, `hold-quality`, `mutation-too-strong`) + optional comment
- Worker meta: `templateId` fingerprint of source remix template
- `scripts/apply-feedback.mjs` + `npm run apply-feedback` → `data/feedback/report.txt` + `patch.json` (no auto-retrain)
- Patch: template/pair/placement weights; report grouped by tag with rule hints

## 2026-08-03 — UI language = English only

- Standing rule: **all product UI English** (labels, buttons, toasts, confirms)
- Chat with user may stay Russian; docs mostly English
- Translated remaining RU copy in Set AI block + `/playground`
- Recorded in COPILOT, ARCHITECTURE, AI.md, COMPACTION

## 2026-08-03 — AI playground → `/playground`

- Moved feedback sandbox **out of Set** into **`/playground`**
  - `app/playground/page.tsx` + `components/AiPlayground.tsx`
  - gen + board preview + Approve / Comment + export / history
- Set keeps product gen only + link to playground
- Home header: link «AI playground»
- `AI.md` rewritten: project context, full AI done, **problem statement**, volumes, roadmap
- **Next:** accumulate ~50–100 labels → `scripts/apply-feedback.mjs` + rule tweaks

## 2026-08-03 — AI feedback playground (v1, later moved)

- First pass: Approve/Comment inside Set (superseded by `/playground`)
- Storage: `lib/ai/feedback.ts` → `kilterboard:ai-feedback:v1`

## 2026-08-03 — Docs: AI.md + COPILOT/ARCHITECTURE/COMPACTION refresh

- Added/expanded **`AI.md`**: done (pipeline, remix-only UI, biomechanics rules, strongMutation) + roadmap (feedback playground, volumes 50–100 / 200–500, export schema)
- Linked from COPILOT / ARCHITECTURE / COMPACTION; PROGRESS docs table includes AI.md

## 2026-08-03 — Local boulder AI

- **4 models** trained offline from ~101k Boardsesh boulders @40° → `public/ai/boulder/models.json` (~3MB, v2)
  1. **freq** — role-wise frequency sampling (UI hidden)  
  2. **cooccur** — pairwise co-occurrence growth (UI hidden)  
  3. **spatial** — bottom-up spatial chain (UI hidden)  
  4. **remix** — grade-band real templates + rule-aware mutation (**only in UI**)  
- Biomechanics rules: L/R, reach, feet under hands, hold quality; toggle **strong mutation** (default off)
- Web Worker: `public/ai/boulder/boulder-worker.js`  
- Client: `lib/ai/boulder-ai.ts` · UI in Set studio  
- Train: `npm run train:boulder-ai` · Eval vs real: `npm run eval:boulder-ai`
- Eval (400×/model): all 4 models pass structural checks vs ~4k real boulders (starts/finishes, vertical flow, size, spanY)
- Feedback playground: **shipped** (see entry above)

## 2026-08-03 — Set studio

- Home header: removed Climbs title/blurb; big **Climbs / Set** switch (`?mode=set`)
- **SetStudio**: single board only; Connect + play **above** board
- **Input modes** (persisted): **Swipe** (hold + ↑Start →Hand ↓Finish ←Foot · center/tap erase) or **Palette**
- **Rules**: max 2 starts on first-frame prefix (matching); max 2 finishes on last-frame suffix (matching)
- **Drafts**: localStorage auto-save; restore on return; nameless title `Nameless draft from date time`
- **Multi-frame fix**: encode keeps empty deltas; split no longer drops empty frames (preview was boulder)
- Helpers: `listEditablePlacements`, `encodeFramesFromStates`, `lib/set-rules.ts`, `lib/set-drafts.ts`

## 2026-08-03 (all angles default)

- List / API default angle filter: **All angles** (not 40°). Specific angle only via UI toggle off or `?angle=N`.

## 2026-08-03 (later)

### Filters collapse + header logo

- Header uses circular gradient logo (`/icon.svg`) instead of letter “K”
- List filters: Name/Setter always sticky; Type/Angle/Grade/Sort/Ascents auto-collapse on scroll down, expand near top or via chevron; collapsed summary chips

### Icons + route stats

- **PWA / tab icons:** circular violet mesh gradient — `public/icon.svg`, `favicon.png`, `icons/icon-{16,32,192,512}.png`, `apple-touch-icon.png`; `app/manifest.ts`
- **Route list stats:** not first-frame hold count; instead:
  - **moveCount (перехваты):** hand holds (roles start/middle/finish, not feet); each new hand vs previous frame counts once (adjacent continuity not double-counted)
  - **frameCount:** number of Aurora frames
  - Boulders still show **holdCount** (first/only frame, all roles)
- Implemented in `analyzeClimbFrames` (`lib/aurora/board.ts`)

## 2026-08-03

### UI redesign (Claude-inspired)

- Warm dark canvas (`#14120b`), **violet accent** `#8B5CF6` (hover `#A78BFA`), soft borders, ambient purple glow + grain
- Fonts: **DM Sans** (body) + **Fraunces** (display titles) via `next/font`
- Shared primitives in `app/globals.css`: `.ui-shell`, `.ui-card`, `.ui-chip`, `.ui-btn-*`, `.climb-row`
- Restyled list filters, climb rows, detail, FramePlayer, BluetoothSet, sliders
- Grade badges retuned to warm palette

## 2026-07-31

### Shipped

- **Climb kind filter** on list: **Both / Boulders / Routes**
  - Boulder = single-frame climb (`instr(frames, ',"') = 0`)
  - Route = multi-frame lead/circuit (`instr(frames, ',"') > 0`)
  - API + URL: `?kind=boulders` | `?kind=routes` (omit = both)
  - UI chips + list badge `route` on multi-frame rows
- **Multi-frame player** (`FramePlayer`): Aurora deltas split on `,"`, ops `p…r…` / `x…`, play/scrub, optional BLE auto-update
- **All angles** toggle + **URL query sync** for filters
- **Min ascents** default Any (0); no LED roles on list
- Catalog: **Boardsesh** → `search_rows` SQLite; not Kilter Lookup

### Key knowledge (do not regress)

1. Multi-frame delimiter is literally **`,"`** (comma + quote), not bare comma.
2. Frame deltas are **cumulative**; first frame is absolute-ish start, later frames add/recolor/clear.
3. List hold count uses **first frame only** (not all `p` tokens across deltas).
4. Filters that must stay shareable live in the **URL** (non-default params only).
5. `lib/boardsesh.ts` is **server-only** (`node:sqlite`); client constants in `boardsesh-client.ts`.

### Files touched (kind filter)

- `lib/boardsesh.ts` — `climbKind` SQL
- `lib/boardsesh-client.ts` — `ClimbKind`, `CLIMB_KIND_OPTIONS`
- `app/api/climbs/route.ts` — `kind` query param
- `components/ClimbList.tsx` — Type chips + URL + list badge

### Open / next (optional)

- Other board sizes / Tension
- PWA + offline DB UX
- Official Kilter PowerSync if API stabilizes
- Index on multi-frame expression if routes filter is slow on large DB (currently `instr` on frames text)
