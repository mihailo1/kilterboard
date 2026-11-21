#!/usr/bin/env python3
"""
Generation-level evaluation: does Hold AR produce climbs that look like good
real climbs of the requested grade?

  python eval_gen.py --methods real,v1,v2:ar-climb,v2:ar-canonical --n 600

Reference = held-out "great" climbs at 40° (never seen in training).
Metrics (per method):
  valid      share with 1–2 starts, 1–2 finishes, ≥6 holds, finish above start
  grade_mae  |independent grade predictor(generated) − requested|  (difficulty units;
             3 ≈ one V grade). The judge (artifacts/grade-eval) is not the rerank model.
  realism    mean Wasserstein distance of climb features vs reference, in reference std units
  c2st_auc   a fresh classifier tries to tell generated from real (0.5 = can't tell)
  copy       share with ≥80% hold overlap with a training climb
  diversity  1 − mean pairwise hold overlap between generated climbs
"""
from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from common import (HoldARv2, SetNet, angle_norm, climb_features, encode, is_valid, load_layout,
                    load_rows, order_holds, pad_batch, pick_device)
from decode import V1Decoder, V2Decoder, predict_grade

ART = Path(__file__).resolve().parent / "artifacts"


def load_ar(name, layout, device):
    ck = torch.load(ART / name / "model.pt", map_location="cpu")
    m = HoldARv2(layout, ck["d_model"], ck["layers"], ck["heads"])
    m.load_state_dict(ck["state"])
    m.order = ck["order"]
    return m.to(device).eval()


class OrtModel:
    """Shipped int8 ONNX (public/ai/boulder) behind the torch call signature."""

    def __init__(self, path, names):
        import onnxruntime as ort
        self.sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        self.names = names

    def eval(self):
        return self

    def __call__(self, *xs):
        feed = {n: x.cpu().numpy() for n, x in zip(self.names, xs)}
        return torch.from_numpy(self.sess.run(None, feed)[0])


class OrtGrade(OrtModel):
    def __call__(self, *xs):  # decode.predict_grade expects the normalised output
        return (super().__call__(*xs) - 21.5) / 6.0


def load_grade(layout, device, name="grade"):
    ck = torch.load(ART / name / "model.pt", map_location="cpu")
    m = SetNet(layout, ck.get("d_model", 192), ck.get("layers", 3), ck.get("heads", 4))
    m.load_state_dict(ck["state"])
    return m.to(device).eval()


def wasserstein(a, b):
    a, b = np.sort(np.asarray(a, float)), np.sort(np.asarray(b, float))
    qs = np.linspace(0, 1, 201)
    return float(np.mean(np.abs(np.quantile(a, qs) - np.quantile(b, qs))))


def realism(gen, ref, layout):
    fg = [climb_features(h, layout) for h in gen]
    fr = [climb_features(h, layout) for h in ref]
    out = {}
    for k in fr[0]:
        r = np.array([f[k] for f in fr])
        g = np.array([f[k] for f in fg])
        out[k] = wasserstein(g, r) / (r.std() + 1e-6)
    return float(np.mean(list(out.values()))), out


def c2st(gen, ref, layout, device, seed=0):
    rng = random.Random(seed)
    n = min(len(gen), len(ref))
    data = [(h, 1.0) for h in rng.sample(gen, n)] + [(h, 0.0) for h in rng.sample(ref, n)]
    rng.shuffle(data)
    cut = int(len(data) * 0.7)
    tr, te = data[:cut], data[cut:]

    def tens(items):
        seq, mask = pad_batch([encode(order_holds([list(x) for x in h], layout, "canonical")) for h, _ in items])
        ang = torch.full((len(items), 1), float(angle_norm(40)))
        y = torch.tensor([t for _, t in items])
        return seq.to(device), mask.to(device), ang.to(device), y.to(device)

    torch.manual_seed(seed)
    m = SetNet(layout, d=128, n_layers=2).to(device)
    opt = torch.optim.AdamW(m.parameters(), lr=1e-3, weight_decay=0.05)
    for _ in range(25):
        m.train()
        rng.shuffle(tr)
        for i in range(0, len(tr), 64):
            seq, mask, ang, y = tens(tr[i : i + 64])
            loss = F.binary_cross_entropy_with_logits(m(seq, mask, ang), y)
            opt.zero_grad()
            loss.backward()
            opt.step()
    m.eval()
    with torch.no_grad():
        seq, mask, ang, y = tens(te)
        s = m(seq, mask, ang).cpu().numpy()
    y = y.cpu().numpy()
    pos, neg = s[y == 1], s[y == 0]
    return float((pos[:, None] > neg[None, :]).mean() + 0.5 * (pos[:, None] == neg[None, :]).mean())


def overlap_matrix(a, b, n):
    A = np.zeros((len(a), n), np.float32)
    Bm = np.zeros((len(b), n), np.float32)
    for i, h in enumerate(a):
        A[i, [p for p, _ in h]] = 1
    for i, h in enumerate(b):
        Bm[i, [p for p, _ in h]] = 1
    inter = A @ Bm.T
    union = A.sum(1)[:, None] + Bm.sum(1)[None, :] - inter
    return inter / np.maximum(union, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--methods", default="real,v1,v2:ar-climb")
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--k", type=int, default=8)
    ap.add_argument("--temperature", type=float, default=1.0)
    ap.add_argument("--top-p", type=float, default=1.0)
    ap.add_argument("--min-p", type=float, default=0.0)
    ap.add_argument("--guidance", type=float, default=0.0)
    ap.add_argument("--grade-weight", type=float, default=1.0)
    ap.add_argument("--lik-weight", type=float, default=0.0)
    ap.add_argument("--out", type=Path, default=ART / "eval.json")
    args = ap.parse_args()

    device = pick_device()
    layout = load_layout()
    train, val = load_rows()
    ref_all = [r for r in val if r["angle"] == 40 and r["q"] == 3]
    random.Random(1).shuffle(ref_all)
    half = len(ref_all) // 2
    ref, ref_holdout = ref_all[:half], ref_all[half:]
    ref_h = [[tuple(h) for h in r["holds"]] for r in ref]
    rng = random.Random(7)
    targets = [rng.choice(ref)["grade"] for _ in range(args.n)]
    train_sets = [[tuple(h) for h in r["holds"]] for r in random.Random(3).sample(train, min(60000, len(train)))]
    gm = load_grade(layout, device)  # used by the v2 rerank
    # Independent judge (other seed + architecture): the rerank must not grade its own homework.
    judge = load_grade(layout, device, "grade-eval") if (ART / "grade-eval" / "model.pt").exists() else gm
    print(f"reference great@40: {len(ref)} (+{len(ref_holdout)} hold-out)  targets={args.n}", flush=True)

    results = {}
    for method in args.methods.split(","):
        t0 = time.time()
        if method == "real":
            sample = ref_holdout[: args.n]
            gen = [[tuple(h) for h in r["holds"]] for r in sample]
            req = np.array([r["grade"] for r in sample])
        elif method == "v1":
            dec = V1Decoder(layout)
            gen = [dec.generate(g, seed=i) for i, g in enumerate(targets)]
            req = np.array(targets)
        else:
            name = method.split(":", 1)[1]
            if name == "shipped":
                pub = Path(__file__).resolve().parents[2] / "public" / "ai" / "boulder"
                ar = OrtModel(pub / "hold-ar-v2.int8.onnx", ["seq", "mask", "grade", "angle", "quality"])
                ar.order = json.loads((pub / "hold-ar-v2.meta.json").read_text())["order"]
                dec = V2Decoder(ar, layout, OrtGrade(pub / "grade-v2.int8.onnx", ["seq", "mask", "angle"]), "cpu")
            else:
                dec = V2Decoder(load_ar(name, layout, device), layout, gm, device)
            gen = []
            for i in range(0, len(targets), 100):
                best, _ = dec.generate(targets[i : i + 100], angle=40, k=args.k, temperature=args.temperature,
                                       top_p=args.top_p, min_p=args.min_p, guidance=args.guidance,
                                       grade_weight=args.grade_weight, lik_weight=args.lik_weight, seed=i)
                gen += best
            req = np.array(targets)
        pg = predict_grade(judge, gen, layout, 40, device)
        real_score, per_feat = realism(gen, ref_h, layout)
        ov = overlap_matrix(gen, train_sets, layout.n).max(1)
        sub = gen[:300]
        pair = overlap_matrix(sub, sub, layout.n)
        div = 1 - (pair.sum() - len(sub)) / (len(sub) * (len(sub) - 1))
        res = {
            "valid": float(np.mean([is_valid(h, layout) for h in gen])),
            "grade_mae": float(np.mean(np.abs(pg - req))),
            "realism": real_score,
            "c2st_auc": c2st(gen, ref_h, layout, device),
            "copy": float(np.mean(ov >= 0.8)),
            "diversity": float(div),
            "holds": float(np.mean([len(h) for h in gen])),
            "features": per_feat,
            "sec": round(time.time() - t0, 1),
        }
        results[method] = res
        print(method, json.dumps({k: (round(v, 3) if isinstance(v, float) else v)
                                   for k, v in res.items() if k != "features"}), flush=True)
    cfg = {k: v for k, v in vars(args).items() if k != "out"}
    args.out.write_text(json.dumps({"config": cfg, "results": results}, indent=2, default=str))


if __name__ == "__main__":
    main()
