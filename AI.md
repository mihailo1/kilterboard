# AI — Hold AR (local boulder generation)

**Version:** app **1.0.0** · model **hold-ar-v1** (causal Transformer, ONNX)

Local generation only — **no cloud LLM**. Inference runs in a **Web Worker** via **onnxruntime-web**.

Related: `ARCHITECTURE.md`, `COPILOT.md`, `docs/AI-PLAN-B-STRUCTURED.md`.

---

## Product surface

| Surface | Role |
|---------|------|
| **Set** (`/?mode=set`) | Generate → frames + drafts + BLE |
| **Playground** (`/playground`) | Generate + paint edit (no label UI) |

**UI language: English only.**

---

## Pipeline

```
Boardsesh SQLite @40° single-frame
        │
        ▼
npm run ml:export-sequences   → data/ml/climbs-40.jsonl + placement_index
        │
        ▼
ml/hold-ar/train.py           → artifacts/hold-ar-v1.pt  (Transformer)
        │
        ▼
export_onnx.py                → public/ai/boulder/hold-ar-v1.onnx
        │
        ▼
hold-ar-worker.js + ORT WASM  → generate holds in browser
        │
        ▼
illegal mask + polishClimb    → Set / Playground board
```

### Runtime files

| Path | Role |
|------|------|
| `public/ai/boulder/hold-ar-v1.onnx` | Weights (~33 MB fp32) |
| `public/ai/boulder/hold-ar-v1.meta.json` | Meta (vocab, dims) |
| `public/ai/boulder/placement_index.json` | placementId ↔ class index |
| `public/ai/boulder/models.json` | Coords / setByPlacement / rules for masks |
| `public/ai/boulder/hold-ar-worker.js` | AR decode loop |
| `public/ai/ort/*` | onnxruntime-web WASM |
| `lib/ai/boulder-ai.ts` | Client bridge |

### Model card (v1)

| | |
|--|--|
| Arch | Causal Transformer (BOS + grade cond.) |
| Size | d_model **384**, **4** layers, **6** heads · ~**8.7M** params |
| Vocab | **1905** = 476 placements × 4 roles + STOP |
| Train | ~88k climbs train / ~10k val @40° |
| Best metrics | val_acc **~19.9%** · top-5 **~44.8%** (next-token) |
| Decode | Temperature sample + mask + polishClimb |

### Commands

```bash
# data
npm run sync:climbs
npm run ml:export-sequences

# train (Python 3.10+, venv in ml/hold-ar)
cd ml/hold-ar && source .venv/bin/activate
python train.py --data ../../data/ml --out artifacts --epochs 12 --device mps \
  --d-model 384 --n-layers 4 --n-heads 6

# export ONNX (no quant) + copy to public/
npm run ml:export-onnx

# optional layout pack for coords/rules
npm run train:boulder-ai
```

---

## Decode rules (worker)

Illegal / constrained actions while sampling:

- Placement already used  
- Max 2 starts / 2 finishes  
- Prefer starts early; finishes after some volume  
- Hand/finish reach cut vs previous hand (from `models.json` remix rules if present)  
- Feet roughly under a hand zone  
- Screw-on (set 20) feet downweighted  

Then **polishClimb** (start/finish structure, vertical reseat).

---

## Legacy / not product

| Item | Status |
|------|--------|
| remix / freq / cooccur / spatial UI | Removed from product |
| `boulder-worker.js` | Still present; layout pack helper / offline history |
| `lib/ai/feedback.ts`, `apply-feedback` | Legacy (no UI) |
| Cloud LLM | Out of scope |

---

## Safety

- Generation is **local**; no API keys for AI  
- Do not dump full models / SQLite / feedback into agent chat  
- Unofficial app — not affiliated with Aurora / Kilter  

## Resume checklist

1. `COPILOT.md` + this file + `ARCHITECTURE.md`  
2. Product generator = **hold-ar only**  
3. UI English; chat may be Russian  
4. Scope: `~/Documents/reps.nosync/kilterboard`  
