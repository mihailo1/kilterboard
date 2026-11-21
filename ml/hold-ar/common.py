"""
Hold AR v2 — shared data, models and features.

Data: data/ml/v2 (npm run ml:export-v2). Classes are the same as v1 so the app
keeps one placement index: class = placementIndex * 4 + roleIndex, STOP = N * 4.
Roles: 0 start, 1 hand, 2 finish, 3 foot.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

ROOT = Path(__file__).resolve().parents[2]
DATA_V2 = ROOT / "data" / "ml" / "v2"

START, HAND, FINISH, FOOT = 0, 1, 2, 3
Q_UNVERIFIED, Q_FEW, Q_SOLID, Q_GREAT, Q_UNKNOWN = 0, 1, 2, 3, 4
N_Q = 5
MAX_LEN = 22


# ---------------------------------------------------------------- data


@dataclass
class Layout:
    n: int
    index_to_id: list[int]
    coords: np.ndarray  # [N,2] raw board units
    sets: np.ndarray  # [N] 0 = bolt-on (set 1), 1 = screw-on (set 20)
    edges: dict

    @property
    def coords_norm(self) -> np.ndarray:
        e = self.edges
        x = (self.coords[:, 0] - e["left"]) / (e["right"] - e["left"])
        y = (self.coords[:, 1] - e["bottom"]) / (e["top"] - e["bottom"])
        return np.stack([x, y], axis=1).astype(np.float32)


def load_layout(data_dir: Path = DATA_V2) -> Layout:
    d = json.loads((data_dir / "layout.json").read_text())
    return Layout(
        n=d["nPlacements"],
        index_to_id=d["indexToId"],
        coords=np.array(d["coords"], dtype=np.float32),
        sets=np.array([1 if s == 20 else 0 for s in d["sets"]], dtype=np.int64),
        edges=d["edges"],
    )


def load_rows(data_dir: Path = DATA_V2) -> tuple[list[dict], list[dict]]:
    val = set(json.loads((data_dir / "split.json").read_text())["valCids"])
    train, valid = [], []
    with open(data_dir / "climbs.jsonl") as f:
        for line in f:
            if line.strip():
                r = json.loads(line)
                (valid if r["cid"] in val else train).append(r)
    return train, valid


def order_holds(holds: list[list[int]], layout: Layout, order: str) -> list[tuple[int, int]]:
    """
    canonical: starts → hands → finishes → feet; each group by (y, x)   [v1]
    climb:     starts, then hands and feet together bottom→top, finishes last
    """
    xy = layout.coords

    def key(h):
        return (float(xy[h[0], 1]), float(xy[h[0], 0]), h[0])

    if order == "canonical":
        rank = {START: 0, HAND: 1, FINISH: 2, FOOT: 3}
    elif order == "climb":
        rank = {START: 0, HAND: 1, FOOT: 1, FINISH: 2}
    else:
        raise ValueError(order)
    return [(p, r) for p, r in sorted(holds, key=lambda h: (rank[h[1]],) + key(h))]


def encode(holds: list[tuple[int, int]]) -> list[int]:
    return [p * 4 + r for p, r in holds]


def grade_norm(g):
    return (np.asarray(g, dtype=np.float32) - 10.0) / 23.0


def angle_norm(a):
    return np.asarray(a, dtype=np.float32) / 70.0


# ---------------------------------------------------------------- model


def fourier(coords_norm: np.ndarray, n_freq: int = 8) -> torch.Tensor:
    c = torch.tensor(coords_norm)  # [N,2] in 0..1
    freqs = 2.0 ** torch.arange(n_freq, dtype=torch.float32) * math.pi
    ang = c.unsqueeze(-1) * freqs  # [N,2,F]
    return torch.cat([ang.sin(), ang.cos()], dim=-1).reshape(c.shape[0], -1)  # [N, 4F]


class PlacementRepr(nn.Module):
    """Placement vector = learned id embedding + board position (Fourier) + hold type."""

    def __init__(self, layout: Layout, d: int):
        super().__init__()
        self.register_buffer("feat", fourier(layout.coords_norm), persistent=False)
        self.register_buffer("sets", torch.tensor(layout.sets), persistent=False)
        self.emb = nn.Embedding(layout.n, d)
        self.geo = nn.Sequential(nn.Linear(self.feat.shape[1], d), nn.GELU(), nn.Linear(d, d))
        self.set_emb = nn.Embedding(2, d)
        nn.init.normal_(self.emb.weight, std=0.02)

    def forward(self) -> torch.Tensor:  # [N,d]
        return self.emb.weight + self.geo(self.feat) + self.set_emb(self.sets)


class HoldARv2(nn.Module):
    """
    Causal Transformer over hold tokens, conditioned on grade, angle and quality
    bucket. Input and output share the placement representation (position-aware),
    output logits = role query · placement vector.

    forward(seq, mask, grade, angle, quality) → logits at the last real position [B, V]
    (ONNX contract used by the browser worker). forward_all → every position.
    """

    def __init__(self, layout: Layout, d: int = 384, n_layers: int = 4, n_heads: int = 6,
                 max_len: int = MAX_LEN, dropout: float = 0.1):
        super().__init__()
        self.n = layout.n
        self.vocab = layout.n * 4 + 1
        self.stop = layout.n * 4
        self.d = d
        self.max_len = max_len
        self.place = PlacementRepr(layout, d)
        self.role_emb = nn.Embedding(4, d)
        self.bos = nn.Parameter(torch.randn(1, 1, d) * 0.02)
        self.pos_emb = nn.Embedding(max_len + 1, d)
        self.grade_mlp = nn.Sequential(nn.Linear(1, d), nn.GELU(), nn.Linear(d, d))
        self.angle_mlp = nn.Sequential(nn.Linear(1, d), nn.GELU(), nn.Linear(d, d))
        self.q_emb = nn.Embedding(N_Q, d)
        layer = nn.TransformerEncoderLayer(d, n_heads, d * 4, dropout, activation="gelu",
                                           batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, n_layers, enable_nested_tensor=False)
        self.drop = nn.Dropout(dropout)
        self.ln = nn.LayerNorm(d)
        self.role_q = nn.Linear(d, 4 * d)
        self.out_bias = nn.Parameter(torch.zeros(layout.n * 4))
        self.stop_head = nn.Linear(d, 1)
        causal = torch.triu(torch.ones(max_len + 1, max_len + 1, dtype=torch.bool), 1)
        self.register_buffer("causal", causal, persistent=False)

    def _hidden(self, seq, mask, grade, angle, quality):
        B, L = seq.shape
        P = self.place()  # [N,d]
        seq = seq.long().clamp(0, self.stop - 1)
        tok = P[seq // 4] + self.role_emb(seq % 4)
        cond = self.grade_mlp(grade) + self.angle_mlp(angle) + self.q_emb(quality.long().view(-1))
        pos = self.pos_emb(torch.arange(L + 1, device=seq.device)).unsqueeze(0)
        x = torch.cat([self.bos.expand(B, 1, -1), tok], 1) + pos + cond.unsqueeze(1)
        keep = torch.cat([torch.ones(B, 1, dtype=torch.bool, device=seq.device), mask.bool()], 1)
        h = self.encoder(self.drop(x), mask=self.causal[: L + 1, : L + 1], src_key_padding_mask=~keep)
        return self.ln(h), P

    def _logits(self, h, P):
        q = self.role_q(h).view(*h.shape[:-1], 4, self.d)
        lp = torch.einsum("...rd,nd->...nr", q, P).reshape(*h.shape[:-1], self.n * 4)
        lp = lp / math.sqrt(self.d) + self.out_bias
        return torch.cat([lp, self.stop_head(h)], -1)

    def forward_all(self, seq, mask, grade, angle, quality):
        h, P = self._hidden(seq, mask, grade, angle, quality)
        return self._logits(h, P)  # [B, L+1, V]

    def forward(self, seq, mask, grade, angle, quality):
        h, P = self._hidden(seq, mask, grade, angle, quality)
        idx = mask.long().sum(1)
        h_last = h[torch.arange(h.shape[0], device=h.device), idx]
        return self._logits(h_last, P)


class SetNet(nn.Module):
    """
    Order-free climb encoder (holds as a set + angle) → scalar.
    Used as grade predictor (regression) and as real-vs-generated discriminator.
    """

    def __init__(self, layout: Layout, d: int = 192, n_layers: int = 3, n_heads: int = 4,
                 dropout: float = 0.1):
        super().__init__()
        self.stop = layout.n * 4
        self.place = PlacementRepr(layout, d)
        self.role_emb = nn.Embedding(4, d)
        self.angle_mlp = nn.Sequential(nn.Linear(1, d), nn.GELU(), nn.Linear(d, d))
        self.cls = nn.Parameter(torch.randn(1, 1, d) * 0.02)
        layer = nn.TransformerEncoderLayer(d, n_heads, d * 4, dropout, activation="gelu",
                                           batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, n_layers, enable_nested_tensor=False)
        self.head = nn.Sequential(nn.LayerNorm(d), nn.Linear(d, d), nn.GELU(), nn.Linear(d, 1))

    def forward(self, seq, mask, angle):
        B = seq.shape[0]
        seq = seq.long().clamp(0, self.stop - 1)
        tok = self.place()[seq // 4] + self.role_emb(seq % 4)
        x = torch.cat([self.cls.expand(B, 1, -1) + self.angle_mlp(angle).unsqueeze(1), tok], 1)
        keep = torch.cat([torch.ones(B, 1, dtype=torch.bool, device=seq.device), mask.bool()], 1)
        h = self.encoder(x, src_key_padding_mask=~keep)
        return self.head(h[:, 0]).squeeze(-1)


def pad_batch(seqs: list[list[int]], max_len: int = MAX_LEN):
    B = len(seqs)
    seq = torch.zeros(B, max_len, dtype=torch.long)
    mask = torch.zeros(B, max_len, dtype=torch.bool)
    for i, s in enumerate(seqs):
        s = s[:max_len]
        if s:
            seq[i, : len(s)] = torch.tensor(s)
            mask[i, : len(s)] = True
    return seq, mask


def pick_device(want: str = "auto") -> torch.device:
    if want == "auto":
        if torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(want)


# ---------------------------------------------------------------- climb features


def climb_features(holds: list[tuple[int, int]], layout: Layout) -> dict:
    """Plain numbers a climber would notice. Board units (≈ inches)."""
    xy = layout.coords
    hands = [p for p, r in holds if r in (START, HAND, FINISH)]
    feet = [p for p, r in holds if r == FOOT]
    starts = [p for p, r in holds if r == START]
    finishes = [p for p, r in holds if r == FINISH]
    hy = sorted(hands, key=lambda p: (xy[p, 1], xy[p, 0]))
    moves = [float(np.hypot(*(xy[b] - xy[a]))) for a, b in zip(hy, hy[1:])]
    sy = float(np.mean([xy[p, 1] for p in starts])) if starts else 0.0
    fy = float(np.mean([xy[p, 1] for p in finishes])) if finishes else 0.0

    def foot_ok(f):
        return any(5 <= xy[h, 1] - xy[f, 1] <= 55 and abs(xy[h, 0] - xy[f, 0]) <= 35 for h in hands)

    return {
        "holds": len(holds),
        "hands": len(hands),
        "feet": len(feet),
        "start_y": sy,
        "finish_y": fy,
        "span": fy - sy,
        "move_mean": float(np.mean(moves)) if moves else 0.0,
        "move_max": float(np.max(moves)) if moves else 0.0,
        "hand_x_std": float(np.std([xy[p, 0] for p in hands])) if hands else 0.0,
        "feet_ok": float(np.mean([foot_ok(f) for f in feet])) if feet else 1.0,
        "screw_feet": float(np.mean([layout.sets[f] for f in feet])) if feet else 0.0,
    }


def is_valid(holds: list[tuple[int, int]], layout: Layout) -> bool:
    roles = [r for _, r in holds]
    ns, nf = roles.count(START), roles.count(FINISH)
    if not (6 <= len(holds) <= MAX_LEN and 1 <= ns <= 2 and 1 <= nf <= 2):
        return False
    f = climb_features(holds, layout)
    return f["span"] > 20
