"""
Decoders used by the offline evaluation.

V1Decoder — port of the v1 worker (app ≤ 1.2.0; model kept in baseline/ for
  comparison): ONNX v1, heuristic mask, temperature sampling, polishClimb.
V2Decoder — what the v2 worker does: K candidates in one batch, hard
  constraints only, plain sampling (T=1, no top-p/min-p by default), rerank by
  grade-predictor match. Likelihood rerank / truncation are kept as options:
  eval showed they make climbs generic (C2ST AUC 0.82 vs 0.49 without).
  Keep in sync with public/ai/boulder/hold-ar-worker.js.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch

from common import (FINISH, FOOT, HAND, MAX_LEN, Q_GREAT, Q_UNKNOWN, ROOT, START, Layout,
                    angle_norm, encode, grade_norm, order_holds, pad_batch)

PUBLIC = ROOT / "public" / "ai" / "boulder"


class V1Decoder:
    def __init__(self, layout: Layout):
        import onnxruntime as ort

        v1 = Path(__file__).resolve().parent / "baseline" / "hold-ar-v1.onnx"
        self.sess = ort.InferenceSession(str(v1), providers=["CPUExecutionProvider"])
        pack = json.loads((PUBLIC / "models.json").read_text())
        self.rules = pack.get("models", {}).get("remix", {}).get("rules") or pack.get("rules") or {}
        self.layout = layout
        self.n = layout.n
        self.xy = layout.coords
        self.screw = layout.sets == 1

    def _logits(self, classes, gnorm):
        seq = np.zeros((1, MAX_LEN), dtype=np.int64)
        mask = np.zeros((1, MAX_LEN), dtype=bool)
        seq[0, : len(classes)] = classes
        mask[0, : len(classes)] = True
        out = self.sess.run(None, {"seq": seq, "mask": mask, "grade": np.array([[gnorm]], dtype=np.float32)})
        return out[0][0]

    def _allowed(self, holds: dict, step: int):
        n = self.n
        allow = np.zeros(n * 4 + 1, dtype=bool)
        roles = list(holds.values())
        ns, nf = roles.count(START), roles.count(FINISH)
        hands = [p for p, r in holds.items() if r in (START, HAND, FINISH)]
        prev = max(hands, key=lambda p: (self.xy[p, 1], self.xy[p, 0])) if hands else None
        reach = (self.rules.get("handReach", {}) or {}).get("max", 55)
        fb = self.rules.get("footBelow", {}) or {}
        dymin, dymax, dxmax = fb.get("dyMin", 6), fb.get("dyMax", 48), fb.get("dxAbsP90", 28)
        free = np.ones(n, dtype=bool)
        for p in holds:
            free[p] = False
        a = allow[: n * 4].reshape(n, 4)
        a[:, :] = free[:, None]
        if ns >= 2:
            a[:, START] = False
        if nf >= 2:
            a[:, FINISH] = False
        if ns == 0 and step < 3:
            a[:, HAND] = a[:, FINISH] = a[:, FOOT] = False
        if len(holds) < 4:
            a[:, FINISH] = False
        if prev is not None:
            d = np.hypot(self.xy[:, 0] - self.xy[prev, 0], self.xy[:, 1] - self.xy[prev, 1])
            far = d > reach * 1.15
            a[far, HAND] = False
            a[far, FINISH] = False
            ok = np.zeros(n, dtype=bool)
            for h in hands:
                dy = self.xy[h, 1] - self.xy[:, 1]
                dx = np.abs(self.xy[h, 0] - self.xy[:, 0])
                ok |= (dy >= dymin * 0.5) & (dy <= dymax * 1.2) & (dx <= dxmax * 1.4)
            a[~ok, FOOT] = False
        if len(holds) >= 6:
            allow[-1] = True
        if len(holds) >= MAX_LEN:
            allow[:] = False
            allow[-1] = True
        return allow

    def _sample(self, logits, allow, T, rng):
        if not allow.any():
            return self.n * 4
        l = np.where(allow, logits, -np.inf) / max(0.05, T)
        w = np.exp(l - l[allow].max())
        foot_cls = np.arange(self.n) * 4 + FOOT
        w[foot_cls[self.screw]] *= 0.15
        w[~allow] = 0
        return int(rng.choice(len(w), p=w / w.sum()))

    def _polish(self, holds: dict):
        y = lambda p: self.xy[p, 1]
        def ids(r):
            return [p for p, rr in holds.items() if rr == r]
        for r, rev in ((START, False), (FINISH, True)):
            lst = sorted(ids(r), key=y, reverse=rev)
            for p in lst[2:]:
                holds[p] = HAND
        if not ids(START) and holds:
            holds[min(holds, key=y)] = START
        if not ids(FINISH) and holds:
            hi = max(holds, key=y)
            if hi not in ids(START):
                holds[hi] = FINISH
        s, f = ids(START), ids(FINISH)
        sy = np.mean([y(p) for p in s]) if s else 0
        fy = np.mean([y(p) for p in f]) if f else 0
        if ((f and s and fy < sy + 24) or (f and fy < 120) or (s and sy > 90)) and len(holds) >= 3:
            allp = sorted(holds, key=y)
            for p in s + f:
                holds[p] = HAND
            for i in range(min(2, max(1, len(s) or 1))):
                holds[allp[i]] = START
            for i in range(min(2, max(1, len(f) or 1))):
                holds[allp[-1 - i]] = FINISH
        for r, rev in ((START, False), (FINISH, True)):
            for p in sorted(ids(r), key=y, reverse=rev)[2:]:
                holds[p] = HAND
        return holds

    def generate(self, grade: float, seed: int, temperature: float = 0.85):
        rng = np.random.default_rng(seed)
        g = (min(33, max(10, grade)) - 10) / 23
        classes, holds = [], {}
        for step in range(MAX_LEN):
            allow = self._allowed(holds, step)
            if not allow.any():
                break
            c = self._sample(self._logits(classes, g), allow, temperature, rng)
            if c == self.n * 4:
                break
            holds[c // 4] = c % 4
            classes.append(c)
        guard = 0
        while len(holds) < 6 and guard < 12:
            guard += 1
            allow = self._allowed(holds, len(classes))
            allow[-1] = False
            if not allow.any():
                break
            c = self._sample(self._logits(classes, g), allow, max(temperature, 0.9), rng)
            if c == self.n * 4 or c // 4 in holds:
                break
            holds[c // 4] = c % 4
            classes.append(c)
        return list(self._polish(holds).items())


class V2Decoder:
    def __init__(self, model, layout: Layout, grade_model=None, device="cpu"):
        self.m = model.eval()
        self.g = grade_model.eval() if grade_model is not None else None
        self.layout = layout
        self.n = layout.n
        self.device = device
        self.order = getattr(model, "order", "climb")

    def _mask(self, states, lengths):
        """states: [B,N] role+1 per placement (0 = unused). Returns allowed [B,V]."""
        n = self.n
        B = states.shape[0]
        used = states > 0
        ns = (states == START + 1).sum(1)
        nf = (states == FINISH + 1).sum(1)
        a = (~used).unsqueeze(-1).expand(B, n, 4).clone()
        a[:, :, START] &= (ns < 2).unsqueeze(1)
        a[:, :, FINISH] &= (nf < 2).unsqueeze(1)
        first = (lengths == 0).view(B, 1)
        a[:, :, HAND] &= ~first
        a[:, :, FINISH] &= ~first
        a[:, :, FOOT] &= ~first
        stop = (lengths >= 6) & (ns >= 1) & (nf >= 1)
        full = lengths >= MAX_LEN
        a &= ~full.view(B, 1, 1)
        stop |= full
        return torch.cat([a.reshape(B, n * 4), stop.unsqueeze(1)], 1)

    @torch.no_grad()
    def generate(self, grades, angle=40, k=8, temperature=1.0, top_p=1.0, min_p=0.0,
                 guidance=0.0, grade_weight=1.0, lik_weight=0.0, seed=0):
        """Returns (best holds per request, all candidates per request)."""
        gen = torch.Generator(device="cpu").manual_seed(seed)
        R = len(grades)
        B = R * k
        dev = self.device
        g = torch.tensor(grade_norm(np.repeat(grades, k))).unsqueeze(1).to(dev)
        a = torch.full((B, 1), float(angle_norm(angle)), device=dev)
        q = torch.full((B,), Q_GREAT, dtype=torch.long, device=dev)
        qu = torch.full((B,), Q_UNKNOWN, dtype=torch.long, device=dev)
        seq = torch.zeros(B, MAX_LEN, dtype=torch.long, device=dev)
        mask = torch.zeros(B, MAX_LEN, dtype=torch.bool, device=dev)
        states = torch.zeros(B, self.n, dtype=torch.long, device=dev)
        lengths = torch.zeros(B, dtype=torch.long, device=dev)
        done = torch.zeros(B, dtype=torch.bool, device=dev)
        logp_sum = torch.zeros(B, device=dev)
        stop = self.n * 4
        for _ in range(MAX_LEN + 1):
            logits = self.m(seq, mask, g, a, q)
            lp_cond = torch.log_softmax(logits.float(), -1)
            if guidance:
                lu = self.m(seq, mask, g, a, qu)
                logits = logits + guidance * (logits - lu)
            allow = self._mask(states, lengths)
            logits = logits.float().masked_fill(~allow, -1e9) / temperature
            probs = torch.softmax(logits, -1)
            probs = probs * (probs >= min_p * probs.max(-1, keepdim=True).values)
            sp, si = probs.sort(-1, descending=True)
            cum = sp.cumsum(-1)
            sp = sp * ((cum - sp) < top_p)
            pick_sorted = torch.multinomial((sp / sp.sum(-1, keepdim=True)).cpu(), 1, generator=gen).to(dev)
            c = si.gather(1, pick_sorted).squeeze(1)
            c = torch.where(done, torch.full_like(c, stop), c)
            logp_sum += torch.where(done, torch.zeros_like(logp_sum), lp_cond.gather(1, c[:, None]).squeeze(1))
            is_stop = c == stop
            live = ~done & ~is_stop
            idx = lengths.clamp(max=MAX_LEN - 1)
            rows = torch.arange(B, device=dev)
            seq[rows[live], idx[live]] = c[live]
            mask[rows[live], idx[live]] = True
            states[rows[live], (c[live] // 4)] = (c[live] % 4) + 1
            lengths += live.long()
            done |= is_stop
            if done.all():
                break
        tokens = (lengths + 1).float()  # + STOP
        score = lik_weight * (logp_sum / tokens).cpu().numpy()
        cands = []
        for b in range(B):
            L = int(lengths[b])
            cands.append([(int(t) // 4, int(t) % 4) for t in seq[b, :L].tolist()])
        if self.g is not None and grade_weight:
            pg = self.predict_grade(cands, angle)
            score = score - grade_weight * np.abs(pg - np.repeat(grades, k))
        best, groups = [], []
        for r in range(R):
            sl = slice(r * k, (r + 1) * k)
            group = cands[sl]
            ok = [i for i, h in enumerate(group) if _structure_ok(h, self.layout)]
            pool = ok or list(range(k))
            i = max(pool, key=lambda j: score[sl][j])
            best.append(group[i])
            groups.append(group)
        return best, groups

    @torch.no_grad()
    def predict_grade(self, climbs, angle=40):
        return predict_grade(self.g, climbs, self.layout, angle, self.device)


def _structure_ok(holds, layout):
    roles = [r for _, r in holds]
    if not (1 <= roles.count(START) <= 2 and 1 <= roles.count(FINISH) <= 2 and len(holds) >= 6):
        return False
    xy = layout.coords
    sy = np.mean([xy[p, 1] for p, r in holds if r == START])
    fy = np.mean([xy[p, 1] for p, r in holds if r == FINISH])
    return fy - sy > 20


@torch.no_grad()
def predict_grade(model, climbs, layout, angle, device, batch=2048):
    out = []
    for i in range(0, len(climbs), batch):
        part = climbs[i : i + batch]
        seq, mask = pad_batch([encode(order_holds([list(h) for h in c], layout, "canonical")) for c in part])
        ang = torch.full((len(part), 1), float(angle_norm(angle)))
        y = model(seq.to(device), mask.to(device), ang.to(device))
        out.append((y * 6.0 + 21.5).cpu().numpy())
    return np.concatenate(out) if out else np.zeros(0)
