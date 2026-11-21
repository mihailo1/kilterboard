# Hold AR — generation eval (2026-11-21)

`python eval_gen.py` (see docstring). Reference: 484 held-out **great** climbs at 40°
(≥10 ascents, rating ≥3.0), never in training. 600 generated climbs per method with
grades drawn from the reference. "real" = another 485 held-out great climbs.

- **grade_mae** — independent grade predictor (`artifacts/grade-eval`, other seed and
  architecture than the rerank model) vs requested grade, difficulty units (3 ≈ one V grade).
  Real climbs score 1.21: that is label noise + judge error. Generated climbs can score
  lower because the rerank picks the candidate a (different) grade model agrees with.
- **realism** — mean Wasserstein distance of 11 climb features (holds, hands, feet,
  start/finish height, span, mean/max move, hand x spread, feet under hands, screw-on
  feet share), in reference-std units.
- **c2st_auc** — a fresh set classifier trained to tell generated from real; 0.5 = can't.
- **copy** — share with ≥80% hold overlap with a training climb.

| method | valid | grade_mae | realism | c2st_auc | copy | diversity | holds |
|--|--|--|--|--|--|--|--|
| real (hold-out) | 0.998 | 1.207 | 0.073 | 0.461 | 0.062 | 0.976 | 12.4 |
| v1 (app ≤1.2.0) | 0.998 | 1.499 | 0.246 | 0.763 | 0.002 | 0.974 | 10.8 |
| v2 climb order, fp32 | 1.000 | 0.425 | 0.094 | 0.494 | 0.002 | 0.978 | 12.2 |
| v2 canonical order, fp32 | 1.000 | 0.440 | 0.085 | 0.538 | 0.002 | 0.977 | 12.0 |
| **v2 shipped (int8 ONNX)** | 1.000 | 0.470 | 0.091 | 0.483 | 0.003 | 0.977 | 11.8 |

## Decoding sweep (climb order, n=400)

| config | grade_mae | realism | c2st_auc |
|--|--|--|--|
| 1 sample, T=1, no truncation | 1.591 | 0.130 | 0.515 |
| 1 sample, T=0.9, top-p 0.92, min-p 0.04 | 1.361 | 0.164 | 0.583 |
| 8 samples, pick most likely | 1.280 | 0.217 | 0.819 |
| 8 samples, likelihood + guidance 1.0 | 0.968 | 0.222 | 0.812 |
| 4 samples, T=1, pick closest grade | 0.548 | 0.095 | 0.543 |
| **8 samples, T=1, pick closest grade** | 0.401 | 0.090 | 0.557 |

Take-away: likelihood rerank and truncation push towards generic climbs; grade rerank on
plain samples keeps the real-climb distribution and hits the grade.

## Caveats

- One reference angle (40°) and ~500 reference climbs; C2ST varies by ±0.03 between runs.
- The grade judge and the rerank model share training data, so grade_mae for v2 is
  optimistic. Realism and C2ST do not use the grade models.
- Not yet checked by climbing the generated problems.
