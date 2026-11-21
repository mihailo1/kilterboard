#!/usr/bin/env python3
"""
Export Hold AR v2 + grade predictor for the browser worker.

  python export_v2.py --ar ar-climb --copy-public

Writes artifacts/export/{hold-ar-v2.onnx, hold-ar-v2.int8.onnx, grade-v2.int8.onnx,
hold-ar-v2.meta.json} and with --copy-public the int8 models + meta into
public/ai/boulder/. Checks int8 vs fp32 logits on real prefixes.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic

from common import MAX_LEN, N_Q, Q_GREAT, angle_norm, encode, grade_norm, load_layout, load_rows, order_holds, pad_batch
from eval_gen import ART, load_ar, load_grade

PUBLIC = Path(__file__).resolve().parents[2] / "public" / "ai" / "boulder"


class PlainEncoder(torch.nn.Module):
    """
    Same math and weights as a pre-norm nn.TransformerEncoder (eval mode), written
    with plain ops so the ONNX graph keeps batch and length dynamic (the fused
    MultiheadAttention path bakes shapes in).
    """

    def __init__(self, enc: torch.nn.TransformerEncoder):
        super().__init__()
        self.layers = enc.layers
        self.heads = enc.layers[0].self_attn.num_heads

    def forward(self, x, mask=None, src_key_padding_mask=None):
        B, T, D = x.shape[0], x.shape[1], x.shape[2]
        H = self.heads
        blocked = torch.zeros(B, 1, T, T, dtype=torch.bool, device=x.device)
        if mask is not None:
            blocked = blocked | mask.view(1, 1, T, T)
        if src_key_padding_mask is not None:
            blocked = blocked | src_key_padding_mask.view(B, 1, 1, T)
        bias = blocked.float() * -1e9
        for layer in self.layers:
            sa = layer.self_attn
            h = layer.norm1(x)
            qkv = torch.nn.functional.linear(h, sa.in_proj_weight, sa.in_proj_bias)
            q, k, v = qkv.chunk(3, dim=-1)
            q = q.reshape(B, T, H, -1).transpose(1, 2)
            k = k.reshape(B, T, H, -1).transpose(1, 2)
            v = v.reshape(B, T, H, -1).transpose(1, 2)
            att = torch.softmax(q @ k.transpose(-1, -2) / (q.shape[-1] ** 0.5) + bias, dim=-1)
            o = (att @ v).transpose(1, 2).reshape(B, T, D)
            x = x + sa.out_proj(o)
            x = x + layer.linear2(torch.nn.functional.gelu(layer.linear1(layer.norm2(x))))
        return x


def plainify(model):
    model.encoder = PlainEncoder(model.encoder)
    return model


class GradeWrap(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, seq, mask, angle):
        return self.m(seq, mask, angle) * 6.0 + 21.5


def export(model, inputs, names, path, dynamic):
    torch.onnx.export(model, inputs, str(path), input_names=names, output_names=["out"],
                      dynamic_axes=dynamic, opset_version=17, dynamo=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ar", default="ar-climb")
    ap.add_argument("--copy-public", action="store_true")
    args = ap.parse_args()
    out = ART / "export"
    out.mkdir(parents=True, exist_ok=True)
    layout = load_layout()
    ar = load_ar(args.ar, layout, "cpu")
    gm = load_grade(layout, "cpu")

    # Plain-op encoder must match the original exactly before we export it.
    import copy
    _, val0 = load_rows()
    probe = [r for r in val0 if r["q"] == 3][:64]
    ps, pm = pad_batch([encode(order_holds(r["holds"], layout, ar.order))[:7] for r in probe])
    pg = torch.tensor(grade_norm([r["grade"] for r in probe])).unsqueeze(1)
    pa = torch.tensor(angle_norm([r["angle"] for r in probe])).unsqueeze(1)
    pq = torch.full((len(probe),), Q_GREAT, dtype=torch.long)
    with torch.no_grad():
        before_ar, before_g = ar(ps, pm, pg, pa, pq), gm(ps, pm, pa)
        ar, gm = plainify(copy.deepcopy(ar)).eval(), plainify(copy.deepcopy(gm)).eval()
        d_ar = (ar(ps, pm, pg, pa, pq) - before_ar).abs().max().item()
        d_g = (gm(ps, pm, pa) - before_g).abs().max().item()
    print(json.dumps({"plain_vs_torch_max_diff": {"ar": d_ar, "grade": d_g}}), flush=True)
    assert d_ar < 1e-3 and d_g < 1e-3, "plain encoder does not match"

    B, L = 2, 5
    seq = torch.zeros(B, MAX_LEN, dtype=torch.long)
    mask = torch.zeros(B, MAX_LEN, dtype=torch.bool)
    g = torch.full((B, 1), 0.3)
    a = torch.full((B, 1), float(angle_norm(40)))
    q = torch.full((B,), Q_GREAT, dtype=torch.long)
    dyn = {"seq": {0: "b", 1: "l"}, "mask": {0: "b", 1: "l"}, "grade": {0: "b"}, "angle": {0: "b"},
           "quality": {0: "b"}, "out": {0: "b"}}
    export(ar, (seq[:, :L], mask[:, :L], g, a, q), ["seq", "mask", "grade", "angle", "quality"],
           out / "hold-ar-v2.onnx", dyn)
    export(GradeWrap(gm), (seq, mask, a), ["seq", "mask", "angle"], out / "grade-v2.onnx",
           {"seq": {0: "b", 1: "l"}, "mask": {0: "b", 1: "l"}, "angle": {0: "b"}, "out": {0: "b"}})
    for name in ("hold-ar-v2", "grade-v2"):
        quantize_dynamic(str(out / f"{name}.onnx"), str(out / f"{name}.int8.onnx"),
                         weight_type=QuantType.QInt8)

    # Parity on real validation prefixes (fp32 torch vs int8 onnx)
    _, val = load_rows()
    rows = [r for r in val if r["angle"] == 40 and r["q"] == 3][:256]
    seqs = [encode(order_holds(r["holds"], layout, ar.order)) for r in rows]
    cut = [s[: np.random.default_rng(i).integers(0, len(s))] for i, s in enumerate(seqs)]
    s, m = pad_batch(cut)
    gg = torch.tensor(grade_norm([r["grade"] for r in rows])).unsqueeze(1)
    aa = torch.full((len(rows), 1), float(angle_norm(40)))
    qq = torch.full((len(rows),), Q_GREAT, dtype=torch.long)
    with torch.no_grad():
        ref = torch.log_softmax(ar(s, m, gg, aa, qq), -1).numpy()
    sess = ort.InferenceSession(str(out / "hold-ar-v2.int8.onnx"), providers=["CPUExecutionProvider"])
    got = sess.run(None, {"seq": s.numpy(), "mask": m.numpy(), "grade": gg.numpy(), "angle": aa.numpy(),
                          "quality": qq.numpy()})[0]
    got = got - np.log(np.exp(got - got.max(-1, keepdims=True)).sum(-1, keepdims=True)) - got.max(-1, keepdims=True)
    p_ref = np.exp(ref)
    top1 = float(np.mean(ref.argmax(-1) == got.argmax(-1)))
    kl = float(np.mean((p_ref * (ref - got)).sum(-1)))
    sizes = {p.name: round(p.stat().st_size / 1e6, 2) for p in out.glob("*.onnx")}
    print(json.dumps({"int8_top1_agree": round(top1, 3), "int8_kl": round(kl, 4), "mb": sizes}), flush=True)

    ck = torch.load(ART / args.ar / "model.pt", map_location="cpu")
    meta = {
        "version": 2,
        "model": "hold-ar-v2",
        "onnx": "hold-ar-v2.int8.onnx",
        "gradeOnnx": "grade-v2.int8.onnx",
        "order": ar.order,
        "vocab": layout.n * 4 + 1,
        "nPlacements": layout.n,
        "stopClass": layout.n * 4,
        "maxLen": MAX_LEN,
        "inputs": ["seq", "mask", "grade", "angle", "quality"],
        "gradeNorm": "(difficulty - 10) / 23",
        "angleNorm": "angle / 70",
        "quality": {"unverified": 0, "few": 1, "solid": 2, "great": 3, "unknown": N_Q - 1},
        "arch": {"dModel": ck["d_model"], "layers": ck["layers"], "heads": ck["heads"]},
        "valGreat": ck["val_great"],
        "int8": {"top1Agree": top1, "kl": kl},
        # Chosen by eval_gen.py (artifacts/eval-final.json); read by the worker.
        "decode": {"candidates": 8, "temperature": 1.0, "topP": 1.0, "minP": 0.0, "guidance": 0,
                   "gradeWeight": 1.0, "likWeight": 0.0},
        "createdAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }
    (out / "hold-ar-v2.meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    if args.copy_public:
        for f in ("hold-ar-v2.int8.onnx", "grade-v2.int8.onnx", "hold-ar-v2.meta.json"):
            shutil.copy(out / f, PUBLIC / f)
        print(f"copied to {PUBLIC}")


if __name__ == "__main__":
    main()
