#!/usr/bin/env node
/**
 * Hold AR v2 dataset: single-frame boulders at EVERY angle, with the signals
 * the v2 model is conditioned on (grade, angle, quality bucket).
 *
 * Reads Boardsesh SQLite + Kilter layout JSON. Writes (data/ml/v2/, not committed):
 *   climbs.jsonl  — one (climb × angle) row per line:
 *                   { cid, angle, grade, ascents, quality, q, holds: [[pIdx, rIdx], …] }
 *   layout.json   — placement index (same 476-placement cut as v1) + coords + set ids
 *   split.json    — val climb ids (split by climb, so no angle of a val climb leaks)
 *   stats.json    — counts per quality bucket / angle
 *
 * Hold order is NOT fixed here; ml/hold-ar/common.py orders holds for training.
 *
 * Usage: npm run ml:export-v2
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '../..')
const dbPath = path.join(root, 'data/boardsesh/kilter-12x12.db')
const outDir = path.join(root, 'data/ml/v2')

const MIN_HOLDS = 6
const MAX_HOLDS = 22
const VAL_FRAC = 0.08
const SPLIT_SEED = 'kilter-hold-ar-v2'
const ROLES = [12, 13, 14, 15] // start, hand, finish, foot

/**
 * Quality bucket (model condition). Generation asks for GREAT.
 *   0 unverified: nobody logged it
 *   1 few:        1–4 ascents
 *   2 solid:      ≥5 ascents
 *   3 great:      ≥10 ascents and average rating ≥ 3.0 (0–5 scale)
 * (4 = "unknown", used only for condition dropout in training.)
 */
function qualityBucket(ascents, quality) {
  const a = Number(ascents) || 0
  const q = Number(quality) || 0
  if (a >= 10 && q >= 3.0) return 3
  if (a >= 5) return 2
  if (a >= 1) return 1
  return 0
}

function normalizeRole(r) {
  for (const b of [12, 20, 24, 28, 32, 36, 42, 46, 50]) {
    if (r >= b && r < b + 4) return 12 + (r - b)
  }
  return ROLES.includes(r) ? r : 13
}

function loadLayout() {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data/kilter', f), 'utf8'))
  const placements = read('placements.json')
  const holes = new Map(read('holes.json').map((h) => [h.id, h]))
  const size = read('product_sizes.json').find((s) => s.id === 10)
  if (!size) throw new Error('product size 10 not found')

  const valid = []
  for (const p of placements) {
    if (p.layout_id !== 1 || (p.set_id !== 1 && p.set_id !== 20)) continue
    const h = holes.get(p.hole_id)
    if (!h) continue
    if (h.x <= size.edge_left || h.x >= size.edge_right || h.y <= size.edge_bottom || h.y >= size.edge_top) {
      continue
    }
    valid.push({ id: p.id, x: h.x, y: h.y, set: p.set_id })
  }
  valid.sort((a, b) => a.id - b.id) // same frozen order as v1 placement_index
  return {
    indexToId: valid.map((v) => v.id),
    idToIndex: Object.fromEntries(valid.map((v, i) => [String(v.id), i])),
    coords: valid.map((v) => [v.x, v.y]),
    sets: valid.map((v) => v.set),
    edges: { left: size.edge_left, right: size.edge_right, bottom: size.edge_bottom, top: size.edge_top },
  }
}

function main() {
  if (!fs.existsSync(dbPath)) {
    console.error('Missing DB. Run: npm run sync:climbs')
    process.exit(1)
  }
  const layout = loadLayout()
  const N = layout.indexToId.length

  // Sanity: the shipped v1 index must match (the app maps classes with it).
  const v1 = JSON.parse(fs.readFileSync(path.join(root, 'public/ai/boulder/placement_index.json'), 'utf8'))
  if (JSON.stringify(v1.indexToId) !== JSON.stringify(layout.indexToId)) {
    throw new Error('placement order differs from public/ai/boulder/placement_index.json')
  }

  const db = new DatabaseSync(dbPath, { readOnly: true })
  const rows = db
    .prepare(
      `SELECT frames, angle, difficulty, ascents, quality
       FROM search_rows
       WHERE frames IS NOT NULL AND length(frames) > 8
         AND instr(frames, ',"') = 0
         AND difficulty BETWEEN 10 AND 33`,
    )
    .all()
  console.log(`raw rows (climb × angle): ${rows.length}`)

  const out = []
  const skip = { size: 0, starts: 0, finishes: 0, unknownHold: 0 }
  for (const row of rows) {
    const holds = new Map()
    let unknown = false
    for (const m of String(row.frames).matchAll(/p(\d+)r(\d+)/g)) {
      const pIdx = layout.idToIndex[m[1]]
      if (pIdx === undefined) {
        unknown = true
        continue
      }
      holds.set(pIdx, ROLES.indexOf(normalizeRole(Number(m[2]))))
    }
    if (unknown) {
      skip.unknownHold++ // a hold outside the 12×12 cut: the climb is not this board's
      continue
    }
    if (holds.size < MIN_HOLDS || holds.size > MAX_HOLDS) {
      skip.size++
      continue
    }
    const roles = [...holds.values()]
    const nS = roles.filter((r) => r === 0).length
    const nF = roles.filter((r) => r === 2).length
    if (nS < 1 || nS > 2) {
      skip.starts++
      continue
    }
    if (nF < 1 || nF > 2) {
      skip.finishes++
      continue
    }
    const sorted = [...holds.entries()].sort((a, b) => a[0] - b[0])
    const cid = crypto.createHash('sha256').update(sorted.map(([p, r]) => `${p}:${r}`).join(',')).digest('hex').slice(0, 16)
    out.push({
      cid,
      angle: Number(row.angle),
      grade: Math.round(Number(row.difficulty) * 100) / 100,
      ascents: Number(row.ascents) || 0,
      quality: row.quality == null ? null : Math.round(Number(row.quality) * 100) / 100,
      q: qualityBucket(row.ascents, row.quality),
      holds: sorted,
    })
  }

  const cids = [...new Set(out.map((r) => r.cid))]
  const val = cids.filter((c) => parseInt(c.slice(0, 8), 16) / 0xffffffff < VAL_FRAC)

  const byQ = [0, 0, 0, 0]
  const byAngle = {}
  for (const r of out) {
    byQ[r.q]++
    byAngle[r.angle] = (byAngle[r.angle] || 0) + 1
  }
  const stats = {
    version: 2,
    createdAt: new Date().toISOString(),
    rows: out.length,
    climbs: cids.length,
    valClimbs: val.length,
    skipped: skip,
    byQuality: { unverified: byQ[0], few: byQ[1], solid: byQ[2], great: byQ[3] },
    byAngle,
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'climbs.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n')
  fs.writeFileSync(
    path.join(outDir, 'layout.json'),
    JSON.stringify({ version: 2, nPlacements: N, roles: ROLES, ...layout }),
  )
  fs.writeFileSync(path.join(outDir, 'split.json'), JSON.stringify({ seed: SPLIT_SEED, valFrac: VAL_FRAC, valCids: val }))
  fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(stats, null, 2) + '\n')
  console.log(JSON.stringify(stats, null, 2))
}

main()
