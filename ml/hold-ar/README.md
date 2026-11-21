# hold-ar — Hold AR models

**Current: v2** (`common.py`, `train_v2.py`, `decode.py`, `eval_gen.py`, `export_v2.py`).
Design and numbers: `../../AI.md`, `EVAL.md`. The sections below the line describe v1
(`train.py`, `export_onnx.py`), kept for history; its model lives in `baseline/` for eval.

## v2 quick start

```bash
python3.12 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
cd ../.. && npm run ml:export-v2 && cd ml/hold-ar           # data/ml/v2
./.venv/bin/python train_v2.py grade --out artifacts/grade   # rerank grade predictor
./.venv/bin/python train_v2.py grade --out artifacts/grade-eval --d-model 256 --layers 4 --heads 8 --seed 1 --epochs 8   # eval judge
./.venv/bin/python train_v2.py ar --order climb --epochs 6 --out artifacts/ar-climb
./.venv/bin/python eval_gen.py --methods real,v1,v2:ar-climb --n 600
./.venv/bin/python export_v2.py --ar ar-climb --copy-public  # int8 ONNX + meta → public/ai/boulder
./.venv/bin/python eval_gen.py --methods v2:shipped           # re-check the shipped int8 files
```

| File | Role |
|------|------|
| `common.py` | data loading, hold orders, `HoldARv2`, `SetNet` (grade / discriminator), climb features |
| `train_v2.py` | `ar` (full-sequence, conditioned) and `grade` training |
| `decode.py` | `V1Decoder` (old worker port) and `V2Decoder` (= `public/ai/boulder/hold-ar-worker.js`) |
| `eval_gen.py` | generation metrics vs held-out great climbs |
| `export_v2.py` | plain-op encoder swap, ONNX export, int8, parity, meta with decode defaults |

---

## v1 (history) — structured next-hold model (Plan B)

Train a small autoregressive policy offline; export ONNX for the browser Worker.

See **`docs/AI-PLAN-B-STRUCTURED.md`**.

## Prerequisites

1. Node ≥22, Boardsesh DB: `npm run sync:climbs`
2. Export sequences (B1):

```bash
cd ../..   # repo root
npm run ml:export-sequences
# → data/ml/climbs-40.jsonl, split.json, stats.json, placement_index.json
# → public/ai/boulder/placement_index.json (slim)
```

3. Python 3.10+

```bash
cd ml/hold-ar
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Train (Transformer)

```bash
python train.py --data ../../data/ml --out artifacts \
  --epochs 12 --batch 192 --lr 3e-4 --device mps \
  --d-model 384 --n-layers 4 --n-heads 6
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--data` | `../../data/ml` | climbs-40.jsonl + split + placement_index |
| `--out` | `artifacts` | checkpoints + metrics |
| `--epochs` | `12` | training epochs |
| `--batch` | `256` | batch size |
| `--lr` | `3e-4` | AdamW peak lr (warmup + cosine) |
| `--device` | `auto` | `auto` / `cpu` / `cuda` / `mps` |
| `--d-model` | `384` | transformer width |
| `--n-layers` | `4` | encoder layers (causal) |
| `--n-heads` | `6` | attention heads |
| `--max-train` | `0` | if >0, cap train climbs (debug) |

## Export ONNX (B3, no quant)

```bash
python export_onnx.py \
  --ckpt artifacts/hold-ar-v1.pt \
  --out artifacts/hold-ar-v1.onnx \
  --copy-public
```

→ `artifacts/hold-ar-v1.onnx` + parity report  
→ `public/ai/boulder/hold-ar-v1.onnx` + `hold-ar-v1.meta.json`

## Next

- B4: Worker + `onnxruntime-web` decode  
- B5: UI model toggle  


## Layout

```
ml/hold-ar/
  train.py
  requirements.txt
  README.md
  artifacts/          # gitignored
data/ml/              # export outputs (mostly gitignored)
public/ai/boulder/placement_index.json
```
