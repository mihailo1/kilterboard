#!/usr/bin/env python3
"""
Hold-AR training — causal Transformer decoder (Plan B, post-GRU).

Data: data/ml/climbs-40.jsonl + split.json + placement_index.json
  (npm run ml:export-sequences)

Checkpoint fields (stable for export_onnx / worker):
  model_state, vocab, n_placements, d_model, max_len, index_version,
  n_layers, n_heads, arch, epoch, val_loss, val_acc, val_acc_top5
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

try:
    import torch
    import torch.nn as nn
    from torch.utils.data import Dataset, DataLoader
except ImportError as e:
    raise SystemExit(
        "PyTorch required. pip install -r requirements.txt\n" + str(e)
    ) from e


class ClimbPrefixDataset(Dataset):
    """Each item: prefix of tokens → next class (or STOP)."""

    def __init__(
        self,
        climbs: list[dict],
        n_placements: int,
        max_len: int = 22,
    ):
        self.n_placements = n_placements
        self.stop_class = n_placements * 4
        self.vocab = n_placements * 4 + 1
        self.max_len = max_len
        self.samples: list[tuple[list[int], int, float]] = []

        for c in climbs:
            classes: list[int] = c.get("tokenClasses") or []
            if not classes:
                continue
            if len(classes) > max_len:
                classes = classes[:max_len]
            grade = float(c.get("grade", 16))
            grade_norm = (grade - 10.0) / 23.0
            for t in range(len(classes)):
                self.samples.append((classes[:t], classes[t], grade_norm))
            self.samples.append((classes[:], self.stop_class, grade_norm))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int):
        return self.samples[idx]


def collate(batch, max_len: int = 22):
    prefixes, targets, grades = zip(*batch)
    B = len(batch)
    L = max_len
    seq = torch.full((B, L), fill_value=-1, dtype=torch.long)
    mask = torch.zeros(B, L, dtype=torch.bool)
    for i, pref in enumerate(prefixes):
        n = min(len(pref), L)
        if n > 0:
            seq[i, :n] = torch.tensor(pref[:n], dtype=torch.long)
            mask[i, :n] = True
    targets_t = torch.tensor(targets, dtype=torch.long)
    grades_t = torch.tensor(grades, dtype=torch.float32).unsqueeze(1)
    return seq, mask, grades_t, targets_t


class HoldAR(nn.Module):
    """
    Causal Transformer decoder over hold-class tokens + grade conditioning.

    Always prepends a learnable BOS (+ grade) so empty prefixes are valid.
    ONNX-friendly: no pack_padded_sequence.
    """

    def __init__(
        self,
        vocab: int,
        d_model: int = 384,
        n_layers: int = 4,
        n_heads: int = 6,
        max_len: int = 22,
        dropout: float = 0.1,
    ):
        super().__init__()
        if d_model % n_heads != 0:
            raise ValueError(f"d_model={d_model} must divide n_heads={n_heads}")
        self.vocab = vocab
        self.d_model = d_model
        self.n_layers = n_layers
        self.n_heads = n_heads
        self.max_len = max_len

        self.tok_emb = nn.Embedding(vocab + 1, d_model, padding_idx=vocab)
        self.bos_emb = nn.Parameter(torch.randn(1, 1, d_model) * 0.02)
        # positions 0=BOS, 1..max_len = tokens
        self.pos_emb = nn.Embedding(max_len + 1, d_model)
        self.grade_mlp = nn.Sequential(
            nn.Linear(1, d_model),
            nn.GELU(),
            nn.Linear(d_model, d_model),
        )
        layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_model * 4,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=n_layers)
        self.drop = nn.Dropout(dropout)
        self.ln = nn.LayerNorm(d_model)
        self.head = nn.Linear(d_model, vocab)

        # causal mask buffer (True = blocked), size max_len+1 for BOS+tokens
        causal = torch.triu(
            torch.ones(max_len + 1, max_len + 1, dtype=torch.bool), diagonal=1
        )
        self.register_buffer("causal_mask", causal, persistent=False)

    def forward(self, seq: torch.Tensor, mask: torch.Tensor, grade: torch.Tensor):
        """
        seq: [B,L] class ids
        mask: [B,L] bool valid tokens (left-aligned)
        grade: [B,1] (difficulty-10)/23
        """
        B, L = seq.shape
        device = seq.device
        pad_id = self.vocab
        mask_f = mask.to(dtype=torch.bool)
        seq_long = seq.to(dtype=torch.long).clamp(min=0, max=self.vocab)
        seq_clamp = torch.where(
            mask_f, seq_long, torch.full_like(seq_long, pad_id)
        )

        g = self.grade_mlp(grade)  # [B,D]

        # BOS at position 0
        bos = self.bos_emb.expand(B, 1, -1) + g.unsqueeze(1)
        bos = bos + self.pos_emb(
            torch.zeros(B, 1, dtype=torch.long, device=device)
        )

        # tokens at positions 1..L
        pos_ids = torch.arange(1, L + 1, device=device).unsqueeze(0).expand(B, -1)
        x_tok = self.tok_emb(seq_clamp) + self.pos_emb(pos_ids) + g.unsqueeze(1)

        x = torch.cat([bos, x_tok], dim=1)  # [B, L+1, D]
        x = self.drop(x)

        # key padding: BOS always valid; tokens follow mask
        bos_valid = torch.ones(B, 1, dtype=torch.bool, device=device)
        key_pad = torch.cat([bos_valid, mask_f], dim=1)  # True = keep
        # TransformerEncoder wants True = ignore
        src_key_padding_mask = ~key_pad

        # causal mask for L+1
        attn_mask = self.causal_mask[: L + 1, : L + 1]

        out = self.encoder(
            x,
            mask=attn_mask,
            src_key_padding_mask=src_key_padding_mask,
        )
        out = self.ln(out)

        # last real position: BOS + n_tokens → index = n_tokens (0 if empty)
        lengths = mask_f.sum(dim=1)  # number of real tokens
        idx = lengths.to(dtype=torch.long)  # BOS-only → 0; 1 tok → 1; …
        batch_idx = torch.arange(B, device=device)
        h_last = out[batch_idx, idx]
        return self.head(h_last)


def load_climbs(data_dir: Path) -> tuple[list[dict], list[dict], dict]:
    index_path = data_dir / "placement_index.json"
    split_path = data_dir / "split.json"
    jsonl_path = data_dir / "climbs-40.jsonl"
    for p in (index_path, split_path, jsonl_path):
        if not p.exists():
            raise SystemExit(
                f"Missing {p}. Run from repo root: npm run ml:export-sequences"
            )

    with open(index_path) as f:
        index = json.load(f)
    with open(split_path) as f:
        split = json.load(f)

    by_id: dict[str, dict] = {}
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            c = json.loads(line)
            by_id[c["id"]] = c

    train = [by_id[i] for i in split["trainIds"] if i in by_id]
    val = [by_id[i] for i in split["valIds"] if i in by_id]
    return train, val, index


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    total_loss = 0.0
    total_n = 0
    correct1 = 0
    correct5 = 0
    crit = nn.CrossEntropyLoss(reduction="sum")
    for seq, mask, grade, targets in loader:
        seq = seq.to(device)
        mask = mask.to(device)
        grade = grade.to(device)
        targets = targets.to(device)
        logits = model(seq, mask, grade)
        loss = crit(logits, targets)
        total_loss += loss.item()
        total_n += targets.size(0)
        pred1 = logits.argmax(dim=-1)
        correct1 += (pred1 == targets).sum().item()
        top5 = logits.topk(5, dim=-1).indices
        correct5 += (top5 == targets.unsqueeze(1)).any(dim=1).sum().item()
    n = max(total_n, 1)
    return total_loss / n, correct1 / n, correct5 / n


def build_scheduler(opt, epochs: int, steps_per_epoch: int, warmup_frac: float = 0.05):
    total_steps = max(1, epochs * steps_per_epoch)
    warmup = max(1, int(total_steps * warmup_frac))

    def lr_lambda(step: int):
        if step < warmup:
            return float(step + 1) / float(warmup)
        # cosine decay to 0.1 of peak
        progress = (step - warmup) / max(1, total_steps - warmup)
        return 0.1 + 0.9 * 0.5 * (1.0 + math.cos(math.pi * min(1.0, progress)))

    return torch.optim.lr_scheduler.LambdaLR(opt, lr_lambda)


def main():
    ap = argparse.ArgumentParser(description="Train hold-ar Transformer")
    ap.add_argument("--data", type=Path, default=Path("../../data/ml"))
    ap.add_argument("--out", type=Path, default=Path("artifacts"))
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--device", type=str, default="auto", help="auto|cpu|cuda|mps")
    ap.add_argument("--max-train", type=int, default=0)
    ap.add_argument("--max-len", type=int, default=22)
    ap.add_argument("--d-model", type=int, default=384)
    ap.add_argument("--n-layers", type=int, default=4)
    ap.add_argument("--n-heads", type=int, default=6)
    ap.add_argument("--dropout", type=float, default=0.1)
    ap.add_argument("--workers", type=int, default=0)
    ap.add_argument("--warmup-frac", type=float, default=0.05)
    args = ap.parse_args()

    data_dir = args.data.resolve()
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    train_climbs, val_climbs, index = load_climbs(data_dir)
    n_placements = int(index["nPlacements"])
    vocab = int(index["vocabSize"])
    print(
        f"placements={n_placements} vocab={vocab} stop={index['stopClass']}",
        flush=True,
    )
    print(
        f"train climbs={len(train_climbs)} val climbs={len(val_climbs)}",
        flush=True,
    )

    if args.max_train > 0:
        train_climbs = train_climbs[: args.max_train]
        print(f"capped train climbs → {len(train_climbs)}", flush=True)

    train_ds = ClimbPrefixDataset(train_climbs, n_placements, args.max_len)
    val_ds = ClimbPrefixDataset(val_climbs, n_placements, args.max_len)
    print(
        f"train prefixes={len(train_ds)} val prefixes={len(val_ds)}",
        flush=True,
    )

    def make_loader(ds, shuffle):
        return DataLoader(
            ds,
            batch_size=args.batch,
            shuffle=shuffle,
            num_workers=args.workers,
            collate_fn=lambda b: collate(b, args.max_len),
        )

    train_loader = make_loader(train_ds, True)
    val_loader = make_loader(val_ds, False)

    want = args.device
    if want.startswith("cuda") and not torch.cuda.is_available():
        print("CUDA not available, falling back", flush=True)
        want = (
            "mps"
            if getattr(torch.backends, "mps", None)
            and torch.backends.mps.is_available()
            else "cpu"
        )
    if want == "mps" and not (
        getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()
    ):
        print("MPS not available, using CPU", flush=True)
        want = "cpu"
    if want == "auto":
        if torch.cuda.is_available():
            want = "cuda"
        elif (
            getattr(torch.backends, "mps", None)
            and torch.backends.mps.is_available()
        ):
            want = "mps"
        else:
            want = "cpu"
    device = torch.device(want)

    model = HoldAR(
        vocab=vocab,
        d_model=args.d_model,
        n_layers=args.n_layers,
        n_heads=args.n_heads,
        max_len=args.max_len,
        dropout=args.dropout,
    ).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(
        f"arch=transformer d_model={args.d_model} layers={args.n_layers} "
        f"heads={args.n_heads} params={n_params:,} device={device}",
        flush=True,
    )

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps_per_epoch = max(1, len(train_loader))
    sched = build_scheduler(
        opt, args.epochs, steps_per_epoch, warmup_frac=args.warmup_frac
    )
    crit = nn.CrossEntropyLoss(label_smoothing=0.05)

    history = []
    best_val = math.inf
    best_acc = 0.0
    t0 = time.time()
    global_step = 0

    for epoch in range(1, args.epochs + 1):
        model.train()
        run_loss = 0.0
        run_n = 0
        for seq, mask, grade, targets in train_loader:
            seq = seq.to(device)
            mask = mask.to(device)
            grade = grade.to(device)
            targets = targets.to(device)
            opt.zero_grad(set_to_none=True)
            logits = model(seq, mask, grade)
            loss = crit(logits, targets)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            global_step += 1
            run_loss += loss.item() * targets.size(0)
            run_n += targets.size(0)

        train_loss = run_loss / max(run_n, 1)
        val_loss, val_acc, val_acc5 = evaluate(model, val_loader, device)
        lr_now = opt.param_groups[0]["lr"]
        row = {
            "epoch": epoch,
            "train_loss": train_loss,
            "val_loss": val_loss,
            "val_acc": val_acc,
            "val_acc_top5": val_acc5,
            "lr": lr_now,
        }
        history.append(row)
        print(
            f"epoch {epoch:02d}  train_loss={train_loss:.4f}  "
            f"val_loss={val_loss:.4f}  val_acc={val_acc:.3f}  "
            f"val_acc@5={val_acc5:.3f}  lr={lr_now:.2e}",
            flush=True,
        )

        # save best by val_acc (primary), then val_loss
        improved = val_acc > best_acc + 1e-6 or (
            abs(val_acc - best_acc) < 1e-6 and val_loss < best_val
        )
        if improved:
            best_val = val_loss
            best_acc = val_acc
            ckpt = {
                "model_state": model.state_dict(),
                "vocab": vocab,
                "n_placements": n_placements,
                "d_model": args.d_model,
                "max_len": args.max_len,
                "n_layers": args.n_layers,
                "n_heads": args.n_heads,
                "arch": "transformer",
                "index_version": index.get("version"),
                "epoch": epoch,
                "val_loss": val_loss,
                "val_acc": val_acc,
                "val_acc_top5": val_acc5,
            }
            torch.save(ckpt, out_dir / "hold-ar-v1.pt")
            print(f"  saved {out_dir / 'hold-ar-v1.pt'}", flush=True)

    metrics = {
        "version": 2,
        "arch": "transformer",
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "nParams": n_params,
        "d_model": args.d_model,
        "n_layers": args.n_layers,
        "n_heads": args.n_heads,
        "vocab": vocab,
        "nPlacements": n_placements,
        "trainClimbs": len(train_climbs),
        "valClimbs": len(val_climbs),
        "trainPrefixes": len(train_ds),
        "valPrefixes": len(val_ds),
        "bestValLoss": best_val,
        "bestValAcc": best_acc,
        "history": history,
        "seconds": time.time() - t0,
        "note": "causal Transformer decoder; target beat GRU val_acc 0.176",
    }
    with open(out_dir / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"wrote {out_dir / 'metrics.json'}", flush=True)
    print(
        f"Done. best val_acc={best_acc:.3f} val_loss={best_val:.4f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
