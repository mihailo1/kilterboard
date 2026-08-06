# Plan B — Structured local model for boulder generation

**Goal:** train a **small structured neural model** offline on Boardsesh boulders, export to **ONNX**, run in the **browser Web Worker** next to (or instead of) rule-based `remix`.

**Not this plan:** cloud LLM, WebLLM chat models, multi-frame routes (later).

**Related:** `AI.md` (current remix), `/playground` feedback, `scripts/train-boulder-ai.mjs`.

---

## 0. Why B (not LLM)

| Constraint | Implication |
|------------|-------------|
| Output must be **valid placementIds** (≈476 on size 10) | Classification / sequential policy over discrete IDs |
| Roles 12–15 only | Small action space |
| ~100k single-frame climbs @40° | Enough for a compact supervised model |
| Browser | ONNX Runtime Web / WASM; target **&lt; 20–40 MB** pack |
| Existing polish | Keep `polishClimb` + biomechanics as safety net |

**Chosen architecture (recommended):**  
**Autoregressive next-hold policy** conditioned on grade + partial climb.

```
input:  grade, partial holds (ordered)
output: next action = (placement_id, role)  OR  STOP
decode: start empty → sample until STOP → polishClimb
```

Alternative (phase 2 if AR underperforms): **template-index classifier + mutation residual** (closer to remix).

---

## 1. Problem formalization

### Board

- Layout Kilter original, size **10**, sets **1** (bolt-on) + **20** (screw-on).
- `N ≈ 476` valid placements (from `models.json` / train `validPlacements`).
- Roles: `R = {12 start, 13 hand, 14 finish, 15 foot}`.

### Climb representation

Sort holds into a **canonical sequence** for training (must be deterministic):

1. All **starts** (role 12), order by `(y asc, x asc)`.
2. All **hands** (13), by `(y asc, x asc)`.
3. All **finishes** (14), by `(y asc, x asc)`.
4. All **feet** (15), by `(y asc, x asc)`.

(Or: spatial bottom→top interleaved — pick one and freeze it.)

Each climb → token sequence:

```
BOS, (p1,r1), (p2,r2), …, (pk,rk), STOP
```

### Model head

At each step, logits over:

```
|vocab| = N * 4 + 1   # placement×role + STOP
       ≈ 476 * 4 + 1 ≈ 1905
```

Optional: two heads `(placement, role)` to shrink last layer — same idea.

Conditioning vector:

- `grade` normalized `(d - 10) / 23`
- optional: `strongMutation` flag later (inference only)
- optional: angle fixed 40° for v1

---

## 2. Model architecture (v1 — keep tiny)

**Name:** `hold-ar-v1`

```
grade_emb     : Linear(1 → 32) or Embedding(24 grades → 32)
placement_emb : Embedding(N+1, 64)   # + PAD
role_emb      : Embedding(5, 16)     # 4 roles + PAD
step_emb      : Embedding(max_len, 16)

token = concat(placement_emb, role_emb) + step_emb
seq   = TransformerEncoder OR GRU/LSTM over tokens
       (prefer 2-layer Transformer, d=128, 4 heads, max_len=24)

pooled / last hidden + grade_emb
  → Linear → logits |vocab|
```

**Budget:**

| Piece | Rough size |
|-------|------------|
| Embeddings | ~476×64 + small |
| 2× Transformer d=128 | ~0.5–2M params |
| Head 1905 | small |
| **Total** | **~1–5 MB** fp32; **&lt;2 MB** int8 ONNX |

**max_len:** 22 holds + BOS/STOP (match remix template cap).

**Baseline to beat:** current `remix` on human playground labels + structural eval.

---

## 3. Data pipeline

### Source

Same as remix train:

```sql
search_rows
  angle = 40
  single-frame (no `,"`)
  difficulty 10–33
  size 10 placements only
```

Filters (recommended):

- hold count 6–22  
- 1–2 starts, 1–2 finishes  
- optional: min ascents ≥ 1 or ≥ 5 for cleaner set  

### Export script (new)

`scripts/ml/export-climb-sequences.mjs` (or `.py`):

**Output:** `data/ml/climbs-40.npz` or parquet/jsonl:

```json
{
  "grade": 16,
  "tokens": [[placementId, roleId], ...],  // canonical order
  "setIds": [1, 1, 20, ...]                 // optional aux
}
```

Also write:

- `data/ml/placement_index.json` — `{ "idToIndex": {...}, "indexToId": [...] }`  
  **Freeze this file**; ONNX vocab depends on it.

### Train / val split

- 90% / 10% by climb hash  
- Stratify by grade band (10–15, 16–20, 21–25, 26–33)

### Supervision

For each prefix `tokens[0:t]`, target = `tokens[t]` or STOP if done.

Loss: cross-entropy (optionally label-smooth 0.05).

**Optional multi-task:** predict set_id (bolt/screw) aux loss — helps avoid junk screw-on feet.

---

## 4. Training (offline Python)

### Environment

```bash
# suggested layout (outside Next bundle)
mkdir -p ml/hold-ar
cd ml/hold-ar
python3 -m venv .venv
source .venv/bin/activate
pip install torch numpy onnx onnxruntime onnxscript
# optional: onnxruntime-web convert helpers
```

Node ≥22 still for export from SQLite; train in Python.

### Script

`ml/hold-ar/train.py`:

1. Load sequences + placement_index  
2. Dataset of (prefix, grade) → target class  
3. Train 10–30 epochs, AdamW, lr 3e-4, batch 256–1024  
4. Early stop on val CE / top-1 next-token accuracy  
5. Export:

```text
ml/hold-ar/artifacts/hold-ar-v1.onnx
ml/hold-ar/artifacts/placement_index.json  # copy into public/
ml/hold-ar/artifacts/metrics.json
```

### Export ONNX checklist

- Input names fixed: `grade` float `[B,1]`, `placement_ids` int64 `[B,L]`, `role_ids` int64 `[B,L]`, `attn_mask` `[B,L]`  
- Output: `logits` float `[B, vocab]`  
- Dynamic axes on batch & length  
- Opset ≥ 17  
- Validate: `onnxruntime` Python session == torch on 20 samples  

### Quantization (phase 1.5)

```bash
# dynamic int8 if quality holds
python -m onnxruntime.quantization.quantize ...
```

Target browser download **&lt; 5 MB**.

---

## 5. Browser runtime

### New files

| Path | Role |
|------|------|
| `public/ai/boulder/hold-ar-v1.onnx` | weights |
| `public/ai/boulder/placement_index.json` | id maps |
| `public/ai/boulder/hold-ar-worker.js` **or** extend `boulder-worker.js` | inference |
| `lib/ai/boulder-ai.ts` | `model: 'remix' \| 'hold-ar'` |
| `package.json` | optional dep `onnxruntime-web` |

### Dependency

```bash
npm i onnxruntime-web
```

Load in Worker (not main thread):

```js
import * as ort from 'onnxruntime-web'
ort.env.wasm.wasmPaths = '/ai/ort/'  // copy wasm assets to public
session = await ort.InferenceSession.create('/ai/boulder/hold-ar-v1.onnx', {
  executionProviders: ['wasm'], // later: webgpu if available
})
```

### Decode (`genHoldAr`)

```
holds = []
for step in 1..max_len:
  logits = session.run(grade, holds_as_tensors)
  # mask illegal actions (occupied placement, >2 starts, etc.)
  # temperature sample or top-k
  if STOP: break
  append (placement, role)
holds = polishClimb(holds, coords)  // REUSE existing rules
// optional: screw-on foot cleanup already in worker
```

**Illegal action mask (must):**

- placement already used  
- start count would exceed 2  
- finish before any start (soft)  
- finish count > 2  
- placement not in valid set  

### UI

- Set + Playground: model toggle **Grade remix** | **Hold AR (local NN)**  
- Default remains **remix** until eval + human sample pass  
- Same feedback loop works for both (`model` field already stored)

---

## 6. Evaluation

### Structural (extend `eval-boulder-ai.mjs`)

Same metrics as remix vs real:

- starts/finishes counts  
- finish above start  
- size, spanY  
- optional: screw-on-as-foot rate  

### Predictive (ML)

- Val next-token accuracy / perplexity  
- Teacher-forcing vs free-run structural  

### Human

- `/playground` side-by-side remix vs hold-ar  
- Prefer **edits rate** and approve rate as true metric  

**Ship criterion:** free-run structural ≈ remix **and** playground approve↑ or edit distance↓.

---

## 7. Feedback → model (later, plan B.2)

Playground already stores:

- `originalHolds` (gen)  
- `holds` (user edit)  
- `verdict`, `tags`, `actualGrade`  

Use as:

1. **Preference:** DPO-style or simple: upweight edited climbs as extra train sequences  
2. **Negative:** removed placements → mask or penalty in loss  
3. **Grade calibration:** when `too-hard` + `actualGrade`, train with `actualGrade` as condition target  

Do **not** wait for this to train v1 — v1 = Boardsesh only.

---

## 8. Phased delivery

| Phase | Deliverable | Exit criteria |
|-------|-------------|----------------|
| **B0** | This doc + freeze placement_index export | ✅ doc |
| **B1** | `export-climb-sequences` + dataset stats | ✅ `npm run ml:export-sequences` |
| **B2** | `train.py` scaffold + metrics.json | ✅ scaffold (run train for full metrics) |
| **B3** | ONNX + Python parity test | ✅ fp32, max_abs ~5e-6, no quant |
| **B4** | Worker `genHoldAr` + mask + polish | ✅ hold-ar-worker + dual bridge |
| **B5** | UI toggle + eval vs remix | ✅ UI toggle; eval script optional |
| **B6** | Playground A/B + optional quant | human preference |
| **B7** | (Optional) finetune on feedback edits | improved edit rate |

**Do not** delete remix until B6 positive.

---

## 9. Repo layout (proposed)

```
kilterboard/
  docs/AI-PLAN-B-STRUCTURED.md     # this file
  scripts/
    ml/
      export-climb-sequences.mjs   # Node: SQLite → data/ml/*
  ml/
    hold-ar/
      train.py
      export_onnx.py
      requirements.txt
      README.md
  data/ml/                         # gitignored large artifacts
    placement_index.json           # CAN commit (small)
    climbs-40.jsonl                # gitignore
  public/ai/boulder/
    hold-ar-v1.onnx                # optional git-lfs / download script
    placement_index.json
    ort/                           # onnxruntime wasm bits
  public/ai/boulder/boulder-worker.js  # + genHoldAr
  lib/ai/boulder-ai.ts
```

`.gitignore`:

```
data/ml/climbs*
ml/hold-ar/.venv/
ml/hold-ar/artifacts/
public/ai/boulder/*.onnx
```

---

## 10. Commands (target UX when implemented)

```bash
# 1) data
nvm use 22
npm run sync:climbs                 # if DB missing
npm run ml:export-sequences         # → data/ml/

# 2) train (Python)
cd ml/hold-ar && source .venv/bin/activate
python train.py --data ../../data/ml --out artifacts/

# 3) copy into app
cp artifacts/hold-ar-v1.onnx ../../public/ai/boulder/
cp ../../data/ml/placement_index.json ../../public/ai/boulder/

# 4) app
npm run dev
# UI: model = Hold AR
```

---

## 11. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Mode collapse / same holds | temperature, nucleus sampling, diversity penalty |
| Invalid climbs | illegal mask + polishClimb |
| Screws as feet | mask or set embedding + post cleanup |
| ONNX too slow on CPU | quantize, shorter max_len, WebGPU later |
| Vocab drift after retrain | version placement_index; bump model id |
| Overfit popular holds | frequency-balanced sampling optional |

---

## 12. Explicit non-goals (v1)

- Multi-frame routes  
- Cloud training infra  
- Replacing playground feedback  
- Full LLM in browser  
- Auto-retrain on every Approve  

---

## 13. Decision log

| Decision | Choice | Why |
|----------|--------|-----|
| Model type | Autoregressive next-hold | Fits discrete board; small; trainable on climbs |
| Runtime | ONNX Runtime Web in Worker | Standard, no cloud |
| Safety | Keep polishClimb + set rules | Structural guarantees |
| Default UI | remix until proven | No regression |
| Feedback | Phase B7 only | Need base model first |

---

## 14. Immediate next actions

**B1 done:**

- `npm run ml:export-sequences`  
- ~97.7k climbs, train/val split, stats, placement_index (N=476, vocab=1905)  
- `ml/hold-ar/train.py` scaffold ready  

**B2–B3 done:** `hold-ar-v1.pt` trained (val_acc ~17.6%); ONNX in `public/ai/boulder/hold-ar-v1.onnx` (fp32, no quant).

```bash
npm run ml:export-onnx   # re-export + parity + copy public
```

**B4 done:** `hold-ar-worker.js` + UI toggle. Test: `npm run dev` → Set/Playground → **Hold AR (NN)** → Generate.

**Next — B5+:** quantitative free-run eval vs remix; more epochs / better arch if human labels prefer remix.
