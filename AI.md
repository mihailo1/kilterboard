# AI — Hold AR (local boulder generation)

**Version:** app **1.3.0** · model **hold-ar-v2** (quality-conditioned causal Transformer, int8 ONNX)

Local generation only — **no cloud LLM**. Inference runs in a **Web Worker** via **onnxruntime-web**.

Related: `ARCHITECTURE.md`, `COPILOT.md`, `ml/hold-ar/EVAL.md` (numbers), `docs/AI-PLAN-B-STRUCTURED.md` (v1 history).

---

## Product surface

| Surface | Role |
|---------|------|
| **Set** (`/?mode=set`) | Generate → frames + drafts + BLE |
| **Playground** (`/playground`) | Generate + paint edit (no label UI) |

**UI language: English only.**

---

## What changed in v2 (and why)

| v1 problem | v2 fix |
|------------|--------|
| Trained on 40° only, ~64% of climbs had 0–2 ascents (unvalidated junk weighed like classics) | All angles (319k climb×angle rows); **quality bucket** condition (unverified / few / solid / great); generate with **great** |
| Holds were bare ids — no idea where a hold is | Placement vector = id embedding + **Fourier(x, y)** + bolt/screw type, shared by input and output (role query · placement) |
| One target per training pass (last prefix position) | Full-sequence teacher forcing: every position is a target |
| Heuristic reach/foot mask + `polishClimb` reseating starts/finishes fought the model | Hard constraints only; no polish |
| One temperature sample | **8 candidates** in one batch, pick the one whose **predicted grade** is closest to the request |
| Only metric was next-token accuracy | `eval_gen.py`: generation-level metrics vs held-out great climbs (see below) |

Lesson from the eval: picking the **most likely** candidate (or top-p / min-p truncation) makes climbs generic — a classifier spots them easily (C2ST AUC 0.82). Plain sampling + grade rerank is indistinguishable from real (≈0.49).

---

## Pipeline

```
Boardsesh SQLite (all angles, single-frame boulders)
        │  npm run ml:export-v2
        ▼
data/ml/v2/{climbs.jsonl, layout.json, split.json, stats.json}   (gitignored)
        │  npm run ml:train-v2          (grade predictor, then AR)
        ▼
ml/hold-ar/artifacts/{grade, ar-climb}/model.pt                  (gitignored)
        │  npm run ml:eval-v2           (real vs v1 vs v2)
        │  npm run ml:export-v2-onnx    (plain-op encoder → ONNX → int8, parity checks)
        ▼
public/ai/boulder/{hold-ar-v2.int8.onnx, grade-v2.int8.onnx, hold-ar-v2.meta.json}
        │
        ▼
hold-ar-worker.js (onnxruntime-web WASM) → Set / Playground
```

Python env: `cd ml/hold-ar && python3.12 -m venv .venv && ./.venv/bin/pip install -r requirements.txt`.
Training on Apple M-series (MPS): ~10 min per epoch for the AR model, 6 epochs.

### Runtime files

| Path | Role |
|------|------|
| `public/ai/boulder/hold-ar-v2.int8.onnx` | AR model, 8.3M params, int8 (~9.9 MB) |
| `public/ai/boulder/grade-v2.int8.onnx` | Grade predictor for rerank (~2.4 MB) |
| `public/ai/boulder/hold-ar-v2.meta.json` | Inputs, hold order, decode defaults (`decode`) |
| `public/ai/boulder/placement_index.json` | placementId ↔ class index (unchanged from v1) |
| `public/ai/boulder/models.json` | Coords (worker uses for structure check) |
| `public/ai/boulder/hold-ar-worker.js` | Batched decode + rerank (mirrors `ml/hold-ar/decode.py`) |
| `lib/ai/boulder-ai.ts` | Client bridge (`grade`, `angle`, `seed`, `temperature`) |
| `ml/hold-ar/baseline/hold-ar-v1.onnx` | v1, kept only for comparison in eval |

### Model card (v2)

| | |
|--|--|
| Arch | Causal Transformer, d 384, 4 layers, 6 heads, pre-norm · 8.3M params |
| Tokens | class = placementIndex·4 + role (start, hand, finish, foot) + STOP; 476 placements |
| Order | **climb**: starts, then hands and feet together bottom→top, finishes last |
| Conditions | grade `(d−10)/23`, angle `a/70`, quality bucket (10% dropped to "unknown") |
| Data | 294k train / 26k val rows; split by climb so no angle of a val climb leaks |
| Val (great climbs) | NLL 3.17 / token · acc 25.7% · top-5 51.7% |
| Grade predictor | Set Transformer (d 192), val MAE 1.31 difficulty units on ≥3-ascent climbs |

### Decode (worker = `decode.py` `V2Decoder`)

1. 8 candidates in one batch, quality = great, angle 40 by default
2. Mask: unused hold, ≤2 starts, ≤2 finishes, first hold is a start, STOP only with ≥6 holds incl. a start and a finish, max 22
3. Sample at T = 1.0 (no top-p / min-p)
4. Keep candidates whose finish is >20 above the start; pick min |predicted grade − requested|

~0.2–0.35 s per Generate in desktop Chrome (M5); phones slower.

---

## Evaluation (summary — full table in `ml/hold-ar/EVAL.md`)

600 generated climbs @40° vs 484 held-out **great** climbs. Lower is better except C2ST (0.5 = indistinguishable).

| | real (hold-out) | v1 | **v2 (shipped int8)** |
|--|--|--|--|
| grade error (independent judge) | 1.21 | 1.50 | **0.47** |
| realism distance | 0.073 | 0.246 | **0.091** |
| C2ST AUC | 0.46 | 0.76 | **0.48** |
| copies of a train climb (≥80% overlap) | 6.2% | 0.2% | 0.3% |

---

## Legacy / not product

| Item | Status |
|------|--------|
| v1 (`train.py`, `export_onnx.py`, `export-climb-sequences.mjs`) | Kept for history; not shipped |
| remix / freq / cooccur / spatial UI | Removed from product |
| `boulder-worker.js` | Layout pack helper / offline history |
| `lib/ai/feedback.ts`, `apply-feedback` | Legacy (no UI) |
| Cloud LLM | Out of scope |

## Safety

- Generation is **local**; no API keys for AI
- Do not dump full models / SQLite / datasets into agent chat
- Unofficial app — not affiliated with Aurora / Kilter

## Resume checklist

1. `COPILOT.md` + this file + `ARCHITECTURE.md`
2. Product generator = **hold-ar v2 only**
3. Change decoding in **both** `decode.py` and `hold-ar-worker.js`; re-run `ml:eval-v2` before shipping
4. UI English; chat may be Russian
