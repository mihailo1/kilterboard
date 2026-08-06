# Kilterboard

**v1.1.0** — Web app for the [Kilter Board](https://settercloset.com/pages/kilter-board) (12×12 + kickboard / Aurora).

Browse community climbs, set your own boulders, light a physical board over **Web Bluetooth**, and generate holds with **Hold AR** — a local ONNX transformer that runs entirely in the browser (no cloud AI). Installable as a **PWA** (standalone display, home-screen icons, floating dock nav).

![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![License](https://img.shields.io/badge/license-unofficial-lightgrey)
![AI](https://img.shields.io/badge/AI-local%20ONNX-blue)
![PWA](https://img.shields.io/badge/PWA-standalone-purple)

## Features

- **Climbs** — search Boardsesh catalog (grade, angle, setter, quality, …)
- **Set** — paint holds (swipe or palette), multi-frame routes, local drafts
- **Light board** — Web Bluetooth to Aurora / Kilter LEDs (`@hangtime/grip-connect`)
- **Hold AR** — local neural generator (causal Transformer → ONNX → Web Worker)
- **Playground** — `/playground` sandbox to try generation + tweak holds
- **PWA** — installable standalone app, glass dock nav, safe areas, maskable icons

## Requirements

| | |
|--|--|
| Node | **≥ 22** (built-in `node:sqlite`) |
| Browser (app + BLE) | **Chrome** or **Edge** (desktop / Android) |
| Network | `localhost` or HTTPS for Bluetooth |
| Optional hardware | Physical Kilter / Aurora LED board |

**Not supported:** Safari / iOS Web Bluetooth.

## Quick start

```bash
git clone https://github.com/mihailo1/kilterboard.git
cd kilterboard
nvm use 22          # or any Node ≥22
npm install
npm run sync:climbs # Boardsesh snapshot → data/boardsesh/ (gitignored)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Mode | URL |
|------|-----|
| Climbs | `/` |
| Set | `/?mode=set` |
| AI playground | `/playground` |
| Climb detail | `/climb/[id]` |

### Climb catalog (Boardsesh)

Climbs come from [Boardsesh board snapshots](https://boardsesh-board-snapshots.t3.tigrisfiles.io/board-snapshots/v1/manifest.json) (Kilter Original layout), filtered to **product size 10**.

```bash
npm run sync:climbs              # slim SQLite + .gz (~120MB / ~37MB)
npm run sync:climbs -- --keep-full
```

`data/boardsesh/*.db` is **gitignored** (too large for the repo). After clone, run `sync:climbs` once for local dev.

#### Vercel / production

`/api/climbs` returns **503** if the DB is missing. On Vercel, `npm run build` runs `ensure-boardsesh-db.mjs`, which downloads Boardsesh and builds the slim DB + gzip during the deploy. The function gunzips into `/tmp` on cold start.

Optional override: set `BOARDSESH_DB_URL` to a public `.db` or `.db.gz` URL if you host the file yourself.

Requires **Node ≥ 22** (`node:sqlite`).

## Hold AR (local AI)

Generation does **not** call OpenAI/Anthropic/etc. A small transformer was trained offline on ~100k real single-frame boulders @40°, exported to ONNX, and runs with **onnxruntime-web** in a Worker.

| Asset | Path |
|-------|------|
| Model | `public/ai/boulder/hold-ar-v1.onnx` (~33 MB) |
| Placement map | `public/ai/boulder/placement_index.json` |
| Worker | `public/ai/boulder/hold-ar-worker.js` |
| Client API | `lib/ai/boulder-ai.ts` |

### Retrain (optional)

```bash
npm run ml:export-sequences   # SQLite → data/ml/
cd ml/hold-ar
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python train.py --data ../../data/ml --out artifacts --epochs 12 --device mps \
  --d-model 384 --n-layers 4 --n-heads 6
cd ../..
npm run ml:export-onnx        # copy ONNX into public/
```

See **`AI.md`** and **`docs/AI-PLAN-B-STRUCTURED.md`** for architecture and metrics.

Also useful:

```bash
npm run train:boulder-ai   # rebuild models.json (coords / rules pack)
npm run eval:boulder-ai    # structural eval helpers
```

## Project layout

```
app/                 # Next.js App Router
components/          # UI (SetStudio, ClimbList, PaintBoard, …)
lib/
  ai/boulder-ai.ts   # Hold AR bridge
  aurora/            # board frames + BLE
  boardsesh.ts       # SQLite search
  version.ts         # APP_VERSION (1.0.0)
public/ai/           # ONNX + worker + ort wasm
ml/hold-ar/          # Python train / ONNX export
scripts/             # sync, train pack, ML export
data/kilter/         # layout JSON
docs/                # design notes
```

## Frames format

```
p{placementId}r{roleId}…
```

Multi-frame routes: deltas joined by `,"`.

| Role | Color   | Meaning |
|------|---------|---------|
| 12   | green   | start   |
| 13   | cyan    | hand    |
| 14   | magenta | finish  |
| 15   | orange  | foot    |

## Bluetooth (API 3)

Uses Nordic UART-style packets via grip-connect Aurora (same family as Climbest examples). Connect only after a user gesture. Clear LEDs before disconnect when possible.

## Docs

| File | Content |
|------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design |
| [AI.md](./AI.md) | Hold AR pipeline |
| [COPILOT.md](./COPILOT.md) | Agent / contributor map |
| [PROGRESS.md](./PROGRESS.md) | Change log |

## Disclaimer

Unofficial reverse-engineered client. **Not affiliated** with Aurora Climbing, Kilter, or Boardsesh. Use at your own risk; may void warranties. Climb data remains subject to its original sources’ terms.

## Version

**1.1.0** — PWA polish (dock nav, install prompt, safe areas, maskable icons).  
**1.0.0** — first public Hold AR release (local transformer + catalog + Set + BLE).
