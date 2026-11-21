#!/usr/bin/env python3
"""
Train Hold AR v2 (or the grade predictor).

  python train_v2.py ar    --order climb     --out artifacts/ar-climb
  python train_v2.py grade --out artifacts/grade

AR: full-sequence teacher forcing (every position is a target), conditioned on
grade, angle and quality bucket; 10% of rows drop the quality to "unknown" so
classifier-free guidance can be used at decode time.
Grade: SetNet regression on climbs with ≥3 ascents (consensus grades).
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from common import (MAX_LEN, Q_UNKNOWN, HoldARv2, SetNet, angle_norm, encode, grade_norm,
                    load_layout, load_rows, order_holds, pad_batch, pick_device)


def batches(items, size, shuffle):
    idx = list(range(len(items)))
    if shuffle:
        random.shuffle(idx)
    for i in range(0, len(idx), size):
        yield [items[j] for j in idx[i : i + size]]


def cosine(step, total, warm):
    if step < warm:
        return (step + 1) / warm
    p = (step - warm) / max(1, total - warm)
    return 0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * min(1.0, p)))


def ar_tensors(rows, layout, order, device, cond_drop=0.0):
    seqs = [encode(order_holds(r["holds"], layout, order)) for r in rows]
    seq, mask = pad_batch(seqs)
    B = len(rows)
    # targets for positions 0..L: token t at position t-1, STOP after the last
    tgt = torch.full((B, MAX_LEN + 1), -100, dtype=torch.long)
    stop = layout.n * 4
    for i, s in enumerate(seqs):
        tgt[i, : len(s)] = torch.tensor(s)
        tgt[i, len(s)] = stop
    q = torch.tensor([r["q"] for r in rows])
    if cond_drop > 0:
        q = torch.where(torch.rand(B) < cond_drop, torch.full_like(q, Q_UNKNOWN), q)
    g = torch.tensor(grade_norm([r["grade"] for r in rows])).unsqueeze(1)
    a = torch.tensor(angle_norm([r["angle"] for r in rows])).unsqueeze(1)
    return [t.to(device) for t in (seq, mask, g, a, q, tgt)]


@torch.no_grad()
def eval_ar(model, rows, layout, order, device):
    model.eval()
    tot, n, c1, c5 = 0.0, 0, 0, 0
    for b in batches(rows, 512, False):
        seq, mask, g, a, q, tgt = ar_tensors(b, layout, order, device)
        logits = model.forward_all(seq, mask, g, a, q)
        flat, t = logits.reshape(-1, logits.shape[-1]), tgt.reshape(-1)
        keep = t != -100
        tot += F.cross_entropy(flat[keep], t[keep], reduction="sum").item()
        n += int(keep.sum())
        c1 += (flat[keep].argmax(-1) == t[keep]).sum().item()
        c5 += (flat[keep].topk(5, -1).indices == t[keep, None]).any(-1).sum().item()
    return {"nll": tot / n, "acc": c1 / n, "acc5": c5 / n}


def train_ar(args, layout, train, val, device):
    model = HoldARv2(layout, args.d_model, args.layers, args.heads, dropout=args.dropout).to(device)
    print(f"params={sum(p.numel() for p in model.parameters()):,}", flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.05, betas=(0.9, 0.98))
    steps = args.epochs * math.ceil(len(train) / args.batch)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: cosine(s, steps, int(steps * 0.04)))
    val_great = [r for r in val if r["q"] == 3]
    best, history = math.inf, []
    for ep in range(1, args.epochs + 1):
        model.train()
        t0, run, n = time.time(), 0.0, 0
        for b in batches(train, args.batch, True):
            seq, mask, g, a, q, tgt = ar_tensors(b, layout, args.order, device, cond_drop=0.1)
            logits = model.forward_all(seq, mask, g, a, q)
            loss = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), tgt.reshape(-1),
                                   ignore_index=-100, label_smoothing=0.02)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            run += loss.item()
            n += 1
        m_all = eval_ar(model, val, layout, args.order, device)
        m_great = eval_ar(model, val_great, layout, args.order, device)
        row = {"epoch": ep, "train_loss": run / n, "val": m_all, "val_great": m_great,
               "sec": round(time.time() - t0, 1)}
        history.append(row)
        print(json.dumps(row), flush=True)
        if m_great["nll"] < best:
            best = m_great["nll"]
            torch.save({"kind": "ar", "state": model.state_dict(), "order": args.order,
                        "d_model": args.d_model, "layers": args.layers, "heads": args.heads,
                        "epoch": ep, "val": m_all, "val_great": m_great}, args.out / "model.pt")
    (args.out / "history.json").write_text(json.dumps(history, indent=2))


def grade_tensors(rows, layout, device):
    seq, mask = pad_batch([encode(order_holds(r["holds"], layout, "canonical")) for r in rows])
    a = torch.tensor(angle_norm([r["angle"] for r in rows])).unsqueeze(1)
    y = torch.tensor([r["grade"] for r in rows], dtype=torch.float32)
    return [t.to(device) for t in (seq, mask, a, y)]


def train_grade(args, layout, train, val, device):
    train = [r for r in train if r["ascents"] >= 3]
    val = [r for r in val if r["ascents"] >= 3]
    print(f"grade rows train={len(train)} val={len(val)}", flush=True)
    model = SetNet(layout, d=args.d_model, n_layers=args.layers, n_heads=args.heads).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.05)
    steps = args.epochs * math.ceil(len(train) / args.batch)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: cosine(s, steps, int(steps * 0.04)))
    best = math.inf
    for ep in range(1, args.epochs + 1):
        model.train()
        for b in batches(train, args.batch, True):
            seq, mask, a, y = grade_tensors(b, layout, device)
            loss = F.smooth_l1_loss(model(seq, mask, a), (y - 21.5) / 6.0)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
        model.eval()
        err, n = 0.0, 0
        with torch.no_grad():
            for b in batches(val, 1024, False):
                seq, mask, a, y = grade_tensors(b, layout, device)
                err += (model(seq, mask, a) * 6.0 + 21.5 - y).abs().sum().item()
                n += len(b)
        mae = err / n
        print(json.dumps({"epoch": ep, "val_mae": round(mae, 3)}), flush=True)
        if mae < best:
            best = mae
            torch.save({"kind": "grade", "state": model.state_dict(), "val_mae": mae,
                        "scale": [21.5, 6.0], "d_model": args.d_model, "layers": args.layers,
                        "heads": args.heads}, args.out / "model.pt")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["ar", "grade"])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--order", default="climb", choices=["climb", "canonical"])
    ap.add_argument("--epochs", type=int, default=14)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=6e-4)
    ap.add_argument("--d-model", type=int, default=0, help="default: 384 (ar) / 192 (grade)")
    ap.add_argument("--layers", type=int, default=0, help="default: 4 (ar) / 3 (grade)")
    ap.add_argument("--heads", type=int, default=0, help="default: 6 (ar) / 4 (grade)")
    ap.add_argument("--dropout", type=float, default=0.1)
    ap.add_argument("--max-train", type=int, default=0)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    defaults = {"ar": (384, 4, 6), "grade": (192, 3, 4)}[args.what]
    args.d_model = args.d_model or defaults[0]
    args.layers = args.layers or defaults[1]
    args.heads = args.heads or defaults[2]
    args.out.mkdir(parents=True, exist_ok=True)
    device = pick_device(args.device)
    layout = load_layout()
    train, val = load_rows()
    if args.max_train:
        random.shuffle(train)
        train = train[: args.max_train]
    print(f"device={device} train={len(train)} val={len(val)}", flush=True)
    (train_ar if args.what == "ar" else train_grade)(args, layout, train, val, device)


if __name__ == "__main__":
    main()
