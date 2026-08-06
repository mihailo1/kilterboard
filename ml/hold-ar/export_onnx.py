#!/usr/bin/env python3
"""
Plan B3 — export hold-ar checkpoint to ONNX (no quantization) + parity check.

Usage (from ml/hold-ar, venv active):
  python export_onnx.py \\
    --ckpt artifacts/hold-ar-v1.pt \\
    --out artifacts/hold-ar-v1.onnx \\
    --copy-public

Copies to public/ai/boulder/hold-ar-v1.onnx when --copy-public.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

# Reuse model definition
from train import HoldAR


def load_model(ckpt_path: Path, device: torch.device) -> tuple[HoldAR, dict]:
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    vocab = int(ckpt["vocab"])
    d_model = int(ckpt.get("d_model", 384))
    max_len = int(ckpt.get("max_len", 22))
    n_layers = int(ckpt.get("n_layers", 4))
    n_heads = int(ckpt.get("n_heads", 6))
    model = HoldAR(
        vocab=vocab,
        d_model=d_model,
        n_layers=n_layers,
        n_heads=n_heads,
        max_len=max_len,
        dropout=0.0,  # inference
    )
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    model.to(device)
    return model, ckpt


@torch.no_grad()
def make_dummy(batch: int, max_len: int, vocab: int, device: torch.device):
    # mix empty + short + full-ish prefixes
    seq = torch.full((batch, max_len), -1, dtype=torch.long, device=device)
    mask = torch.zeros(batch, max_len, dtype=torch.bool, device=device)
    grade = torch.zeros(batch, 1, dtype=torch.float32, device=device)
    for i in range(batch):
        n = (i * 3) % (max_len + 1)  # 0..max_len
        if n > 0:
            # random valid class ids
            seq[i, :n] = torch.randint(0, vocab - 1, (n,), device=device)
            mask[i, :n] = True
        grade[i, 0] = (10 + (i % 24)) / 23.0  # rough
        # proper norm (d-10)/23
        d = 10 + (i % 24)
        grade[i, 0] = (d - 10) / 23.0
    return seq, mask, grade


@torch.no_grad()
def parity_check(
    model: HoldAR,
    onnx_path: Path,
    max_len: int,
    vocab: int,
    n_cases: int = 32,
) -> dict:
    import onnxruntime as ort

    device = torch.device("cpu")
    model = model.to(device)
    model.eval()

    sess = ort.InferenceSession(
        str(onnx_path),
        providers=["CPUExecutionProvider"],
    )

    max_abs = 0.0
    max_rel = 0.0
    argmax_match = 0

    for seed in range(n_cases):
        torch.manual_seed(seed)
        np.random.seed(seed)
        seq, mask, grade = make_dummy(1, max_len, vocab, device)
        # torch
        logits_t = model(seq, mask, grade).cpu().numpy()
        # onnx — mask as bool
        feeds = {
            "seq": seq.cpu().numpy().astype(np.int64),
            "mask": mask.cpu().numpy().astype(np.bool_),
            "grade": grade.cpu().numpy().astype(np.float32),
        }
        logits_o = sess.run(None, feeds)[0]

        diff = np.abs(logits_t - logits_o)
        max_abs = max(max_abs, float(diff.max()))
        denom = np.maximum(np.abs(logits_t), 1e-6)
        max_rel = max(max_rel, float((diff / denom).max()))
        if int(logits_t.argmax()) == int(logits_o.argmax()):
            argmax_match += 1

    return {
        "n_cases": n_cases,
        "max_abs_diff": max_abs,
        "max_rel_diff": max_rel,
        "argmax_match": argmax_match,
        "argmax_match_rate": argmax_match / n_cases,
        "ok": max_abs < 1e-3 and argmax_match == n_cases,
    }


def main():
    ap = argparse.ArgumentParser(description="Export hold-ar to ONNX (no quant)")
    ap.add_argument("--ckpt", type=Path, default=Path("artifacts/hold-ar-v1.pt"))
    ap.add_argument("--out", type=Path, default=Path("artifacts/hold-ar-v1.onnx"))
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--copy-public", action="store_true")
    ap.add_argument("--parity-cases", type=int, default=32)
    args = ap.parse_args()

    ckpt_path = args.ckpt.resolve()
    if not ckpt_path.exists():
        raise SystemExit(f"Missing checkpoint: {ckpt_path}")

    device = torch.device("cpu")
    model, ckpt = load_model(ckpt_path, device)
    vocab = int(ckpt["vocab"])
    max_len = int(ckpt.get("max_len", 22))
    print(
        f"loaded {ckpt_path}  arch={ckpt.get('arch')} vocab={vocab} "
        f"d_model={ckpt.get('d_model')} layers={ckpt.get('n_layers')} "
        f"heads={ckpt.get('n_heads')} max_len={max_len} epoch={ckpt.get('epoch')}"
    )

    # Export wrapper: ensure bool mask + long seq
    class ExportWrapper(nn.Module):
        def __init__(self, m: HoldAR):
            super().__init__()
            self.m = m

        def forward(self, seq: torch.Tensor, mask: torch.Tensor, grade: torch.Tensor):
            # ORT may pass mask as bool or float
            if mask.dtype != torch.bool:
                mask = mask > 0.5
            return self.m(seq, mask, grade)

    wrapped = ExportWrapper(model)
    wrapped.eval()

    dummy_seq = torch.zeros(1, max_len, dtype=torch.long)
    dummy_mask = torch.zeros(1, max_len, dtype=torch.bool)
    dummy_mask[0, 0] = True
    dummy_seq[0, 0] = 10
    dummy_grade = torch.tensor([[(16 - 10) / 23.0]], dtype=torch.float32)

    out_path = args.out.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"exporting ONNX opset={args.opset} → {out_path} (fp32, no quant)")
    # dynamo=False: legacy TorchScript exporter (more reliable for GRU on 2.x)
    export_kw = dict(
        input_names=["seq", "mask", "grade"],
        output_names=["logits"],
        dynamic_axes={
            "seq": {0: "batch"},
            "mask": {0: "batch"},
            "grade": {0: "batch"},
            "logits": {0: "batch"},
        },
        opset_version=args.opset,
        do_constant_folding=True,
    )
    try:
        torch.onnx.export(
            wrapped,
            (dummy_seq, dummy_mask, dummy_grade),
            str(out_path),
            dynamo=False,
            **export_kw,
        )
    except TypeError:
        torch.onnx.export(
            wrapped,
            (dummy_seq, dummy_mask, dummy_grade),
            str(out_path),
            **export_kw,
        )

    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"wrote {out_path}  ({size_mb:.2f} MB)")

    print("parity check (torch vs onnxruntime CPU)…")
    report = parity_check(
        model, out_path, max_len, vocab, n_cases=args.parity_cases
    )
    print(json.dumps(report, indent=2))

    report_path = out_path.with_suffix(".parity.json")
    meta = {
        "ckpt": str(ckpt_path),
        "onnx": str(out_path),
        "vocab": vocab,
        "n_placements": ckpt.get("n_placements"),
        "max_len": max_len,
        "d_model": ckpt.get("d_model"),
        "n_layers": ckpt.get("n_layers"),
        "n_heads": ckpt.get("n_heads"),
        "arch": ckpt.get("arch", "transformer"),
        "epoch": ckpt.get("epoch"),
        "val_loss": ckpt.get("val_loss"),
        "val_acc": ckpt.get("val_acc"),
        "val_acc_top5": ckpt.get("val_acc_top5"),
        "quantized": False,
        "parity": report,
    }
    report_path.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {report_path}")

    if not report["ok"]:
        print("WARNING: parity thresholds not met (max_abs >= 1e-3 or argmax mismatch)", file=sys.stderr)

    if args.copy_public:
        root = Path(__file__).resolve().parents[2]
        pub = root / "public" / "ai" / "boulder" / "hold-ar-v1.onnx"
        pub.parent.mkdir(parents=True, exist_ok=True)
        pub.write_bytes(out_path.read_bytes())
        print(f"copied → {pub}")
        # side meta for app
        (pub.parent / "hold-ar-v1.meta.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "model": "hold-ar-v1",
                    "onnx": "hold-ar-v1.onnx",
                    "placementIndex": "placement_index.json",
                    "vocab": vocab,
                    "nPlacements": ckpt.get("n_placements"),
                    "maxLen": max_len,
                    "stopClass": int(ckpt.get("n_placements", 476)) * 4,
                    "gradeNorm": "(difficulty - 10) / 23",
                    "inputs": ["seq", "mask", "grade"],
                    "outputs": ["logits"],
                    "arch": ckpt.get("arch", "transformer"),
                    "dModel": ckpt.get("d_model"),
                    "nLayers": ckpt.get("n_layers"),
                    "nHeads": ckpt.get("n_heads"),
                    "quantized": False,
                    "valAcc": ckpt.get("val_acc"),
                    "valAccTop5": ckpt.get("val_acc_top5"),
                    "valLoss": ckpt.get("val_loss"),
                },
                indent=2,
            )
            + "\n"
        )
        print(f"wrote {pub.parent / 'hold-ar-v1.meta.json'}")

    if report["ok"]:
        print("B3 OK — ONNX ready (no quant).")
        sys.exit(0)
    sys.exit(2)


if __name__ == "__main__":
    main()
