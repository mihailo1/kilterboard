# hold-ar — structured next-hold model (Plan B)

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
