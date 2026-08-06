# Compaction / resume — Kilterboard v1.0.0

## Product

Kilter 12×12 web app: Boardsesh catalog, Set editor, Aurora BLE, **Hold AR** local ONNX generator.  
UI English only. Version footer **v1.0.0** (`lib/version.ts`).

## AI (current)

- Generator: **hold-ar only** (causal Transformer → ONNX → `hold-ar-worker.js`)
- No remix/freq/cooccur/spatial in product UI
- Playground: gen + paint; no Approve/tags UI
- Train: `ml/hold-ar/train.py` · export: `npm run ml:export-onnx`
- Best val_acc ~19.9% top-5 ~44.8% (next-token); free-run still uses mask + polish

## Commands

```bash
nvm use 22 && npm install && npm run sync:climbs && npm run dev
```

## Docs

README · ARCHITECTURE · AI.md · COPILOT · PROGRESS · docs/AI-PLAN-B-STRUCTURED.md

## Scope

Only `~/Documents/reps.nosync/kilterboard`. Do not dump DB/models into chat.
