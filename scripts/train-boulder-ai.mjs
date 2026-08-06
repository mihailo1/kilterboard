/**
 * Train lightweight local boulder generators from Boardsesh SQLite.
 * Output: public/ai/boulder/models.json (+ meta)
 *
 * Four models:
 *  1. freq    — role-wise frequency sampling
 *  2. cooccur — pairwise co-occurrence (conditional)
 *  3. spatial — spatial chain (near previous holds)
 *  4. remix   — grade-band templates + soft mutation
 *
 * Usage: node scripts/train-boulder-ai.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dbPath = path.join(root, 'data', 'boardsesh', 'kilter-12x12.db')
const outDir = path.join(root, 'public', 'ai', 'boulder')

const ANGLE = 40
const MAX_TEMPLATES = 12_000
const TOP_PARTNERS = 40
const MAX_PAIR_KEYS = 80_000

function parseFrames(frames) {
  /** @type {Map<number, number>} */
  const m = new Map()
  const re = /p(\d+)r(\d+)/g
  let match
  while ((match = re.exec(frames)) !== null) {
    m.set(Number(match[1]), Number(match[2]))
  }
  return m
}

function normalizeRole(r) {
  // classic 12–15; map product-scoped bases to 12–15
  const bases = [12, 20, 24, 28, 32, 36, 42, 46, 50]
  for (const b of bases) {
    if (r >= b && r < b + 4) return 12 + (r - b)
  }
  if (r === 12 || r === 13 || r === 14 || r === 15) return r
  return 13
}

function loadCoords() {
  const placements = JSON.parse(
    fs.readFileSync(path.join(root, 'data/kilter/placements.json'), 'utf8'),
  )
  const holes = JSON.parse(
    fs.readFileSync(path.join(root, 'data/kilter/holes.json'), 'utf8'),
  )
  const sizes = JSON.parse(
    fs.readFileSync(path.join(root, 'data/kilter/product_sizes.json'), 'utf8'),
  )
  const size = sizes.find((s) => s.id === 10)
  const holeById = new Map(holes.map((h) => [h.id, h]))
  /** @type {Record<string, [number, number]>} */
  const coords = {}
  /** placementId → set_id (1 bolt-on, 20 screw-on) */
  /** @type {Record<string, number>} */
  const setByPlacement = {}
  /** @type {number[]} */
  const validIds = []
  for (const p of placements) {
    if (p.layout_id !== 1) continue
    if (p.set_id !== 1 && p.set_id !== 20) continue
    const h = holeById.get(p.hole_id)
    if (!h) continue
    if (
      h.x <= size.edge_left ||
      h.x >= size.edge_right ||
      h.y <= size.edge_bottom ||
      h.y >= size.edge_top
    ) {
      continue
    }
    coords[String(p.id)] = [h.x, h.y]
    setByPlacement[String(p.id)] = p.set_id
    validIds.push(p.id)
  }
  return { coords, setByPlacement, validIds: new Set(validIds) }
}

function main() {
  if (!fs.existsSync(dbPath)) {
    console.error('Missing DB. Run: npm run sync:climbs')
    process.exit(1)
  }

  const { coords, setByPlacement, validIds } = loadCoords()
  const db = new DatabaseSync(dbPath, { readOnly: true })

  console.log('Scanning boulders @40° (single-frame)…')
  const rows = db
    .prepare(
      `SELECT frames, difficulty, ascents
       FROM search_rows
       WHERE angle = @angle
         AND frames IS NOT NULL
         AND length(frames) > 8
         AND instr(frames, ',"') = 0
         AND difficulty IS NOT NULL
         AND difficulty >= 10
         AND difficulty <= 33`,
    )
    .all({ angle: ANGLE })

  console.log(`  raw rows: ${rows.length}`)

  /** freq: role -> Map(placementId, count) */
  const roleFreq = {
    12: new Map(),
    13: new Map(),
    14: new Map(),
    15: new Map(),
  }
  /** size histogram: total holds -> count */
  const sizeHist = new Map()
  /** role count histograms */
  const roleCountHist = {
    12: new Map(),
    13: new Map(),
    14: new Map(),
    15: new Map(),
  }
  /** co-occurrence of placement pairs (undirected, ordered a<b) */
  const pairs = new Map()
  /** placement partners: id -> Map(partner, count) */
  const partners = new Map()
  /** spatial edges from consecutive holds in sorted-by-y order within climb */
  const spatial = new Map() // "a>b" -> weight

  /** templates for remix: stratified by difficulty band */
  /** @type {Array<{ d: number, h: Array<[number, number]> }>} */
  const templates = []
  const templatesPerBand = new Map() // band -> count

  // --- biomechanics / quality stats for remix rules ---
  /** overall hold quality (ascent-weighted usage) */
  const holdUse = new Map() // id -> weight
  /** consecutive hand reach distances */
  const handDists = []
  const handDxAbs = []
  /** foot relative to nearest hand above: dy = handY - footY (>0), dx = footX - handX */
  const footDy = []
  const footDxAbs = []
  /** |dx| when alternating L/R inferred sides */
  const sideDx = []
  let prevHandAsFootHits = 0
  let prevHandAsFootTries = 0

  let used = 0
  let skipped = 0

  for (const row of rows) {
    const raw = parseFrames(row.frames)
    /** @type {Array<[number, number]>} */
    const holds = []
    for (const [id, role] of raw) {
      if (!validIds.has(id)) continue
      holds.push([id, normalizeRole(role)])
    }
    if (holds.length < 4 || holds.length > 40) {
      skipped++
      continue
    }
    // need at least 1 start-ish or hands
    const byRole = { 12: [], 13: [], 14: [], 15: [] }
    for (const [id, r] of holds) {
      if (byRole[r]) byRole[r].push(id)
    }
    // fix weird roles: if no start but has holds, still ok for training frequency
    used++
    const ascW = Math.log1p(Math.max(0, Number(row.ascents) || 0)) + 1

    sizeHist.set(holds.length, (sizeHist.get(holds.length) ?? 0) + 1)
    for (const r of [12, 13, 14, 15]) {
      const n = byRole[r].length
      roleCountHist[r].set(n, (roleCountHist[r].get(n) ?? 0) + 1)
      for (const id of byRole[r]) {
        roleFreq[r].set(id, (roleFreq[r].get(id) ?? 0) + 1)
        holdUse.set(id, (holdUse.get(id) ?? 0) + ascW)
      }
    }

    // pairs among all holds
    const ids = holds.map(([id]) => id).sort((a, b) => a - b)
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i]
      if (!partners.has(a)) partners.set(a, new Map())
      for (let j = i + 1; j < ids.length; j++) {
        const b = ids[j]
        const key = `${a}|${b}`
        pairs.set(key, (pairs.get(key) ?? 0) + 1)
        partners.get(a).set(b, (partners.get(a).get(b) ?? 0) + 1)
        if (!partners.has(b)) partners.set(b, new Map())
        partners.get(b).set(a, (partners.get(b).get(a) ?? 0) + 1)
      }
    }

    // spatial chain: sort by y then x (bottom-up climbing order)
    const withC = holds
      .map(([id, r]) => {
        const c = coords[String(id)]
        return c ? { id, r, x: c[0], y: c[1] } : null
      })
      .filter(Boolean)
      .sort((a, b) => a.y - b.y || a.x - b.x)
    for (let i = 0; i < withC.length - 1; i++) {
      const a = withC[i].id
      const b = withC[i + 1].id
      const key = a < b ? `${a}>${b}` : `${b}>${a}`
      spatial.set(key, (spatial.get(key) ?? 0) + 1)
    }

    // Hand sequence (start/hand/finish) bottom→top — reach + L/R geometry
    const handsSeq = withC.filter((h) => h.r === 12 || h.r === 13 || h.r === 14)
    for (let i = 0; i < handsSeq.length - 1; i++) {
      const a = handsSeq[i]
      const b = handsSeq[i + 1]
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      handDists.push(dist)
      handDxAbs.push(Math.abs(b.x - a.x))
      // inferred alternating sides: L prefers lower x
      const side = i % 2 === 0 ? 'L' : 'R'
      const nextSide = side === 'L' ? 'R' : 'L'
      // signed dx from climber perspective roughly
      sideDx.push(nextSide === 'R' ? b.x - a.x : a.x - b.x)
    }

    // Feet relative to nearest hand at or above foot
    const feet = withC.filter((h) => h.r === 15)
    const handIds = new Set(handsSeq.map((h) => h.id))
    for (const f of feet) {
      let best = null
      let bestDy = Infinity
      for (const h of handsSeq) {
        if (h.y < f.y - 2) continue // hand should be above or ~level
        const dy = h.y - f.y
        if (dy < bestDy) {
          bestDy = dy
          best = h
        }
      }
      if (best && bestDy < 80) {
        footDy.push(bestDy)
        footDxAbs.push(Math.abs(f.x - best.x))
      }
      // "previous hands as feet": foot hold also appears as hand in this climb?
      prevHandAsFootTries++
      if (handIds.has(f.id)) prevHandAsFootHits++ // same id can't be both — check role dual never
      // better: foot id is common hand placement in global roleFreq
      // tracked after loop via quality
    }
    // previous hand hold used as foot = foot near previous hand position
    for (let i = 1; i < handsSeq.length; i++) {
      const prev = handsSeq[i - 1]
      for (const f of feet) {
        const d = Math.hypot(f.x - prev.x, f.y - prev.y)
        if (d < 12) {
          prevHandAsFootHits++
          break
        }
      }
      prevHandAsFootTries++
    }

    // templates (stratified) — prefer cleaner problems
    const d = Math.round(Number(row.difficulty))
    const band = Math.min(33, Math.max(10, d))
    const bandCount = templatesPerBand.get(band) ?? 0
    const cap = Math.ceil(MAX_TEMPLATES / 24)
    const clean =
      byRole[12].length >= 1 &&
      byRole[12].length <= 2 &&
      byRole[14].length >= 1 &&
      byRole[14].length <= 2 &&
      holds.length >= 6 &&
      holds.length <= 22
    if (bandCount < cap && clean) {
      templates.push({ d: band, h: holds })
      templatesPerBand.set(band, bandCount + 1)
    }
  }

  console.log(`  used: ${used}, skipped: ${skipped}, templates: ${templates.length}`)

  function topWeighted(map, limit) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, w]) => [Number(id), w])
  }

  function histToArr(map) {
    return [...map.entries()]
      .map(([k, v]) => [Number(k), v])
      .sort((a, b) => a[0] - b[0])
  }

  // prune pairs
  const pairList = [...pairs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PAIR_KEYS)
    .map(([k, w]) => {
      const [a, b] = k.split('|').map(Number)
      return [a, b, w]
    })

  /** partner lists */
  const partnerLists = {}
  for (const [id, m] of partners) {
    partnerLists[String(id)] = topWeighted(m, TOP_PARTNERS)
  }

  const spatialList = [...spatial.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60_000)
    .map(([k, w]) => {
      const [a, b] = k.split('>').map(Number)
      return [a, b, w]
    })

  function percentile(arr, p) {
    if (!arr.length) return 0
    const s = [...arr].sort((a, b) => a - b)
    const i = (s.length - 1) * p
    const lo = Math.floor(i)
    const hi = Math.ceil(i)
    if (lo === hi) return s[lo]
    return s[lo] * (hi - i) + s[hi] * (i - lo)
  }

  // Hold quality 0–100 from ascent-weighted use
  const useVals = [...holdUse.values()]
  const maxUse = Math.max(1, ...useVals)
  /** @type {Record<string, number>} */
  const holdQuality = {}
  for (const [id, w] of holdUse) {
    // log scale → 0..100
    const q = (100 * Math.log1p(w)) / Math.log1p(maxUse)
    holdQuality[String(id)] = Math.round(q * 10) / 10
  }

  const rules = {
    handReach: {
      p10: percentile(handDists, 0.1),
      p50: percentile(handDists, 0.5),
      p90: percentile(handDists, 0.9),
      max: percentile(handDists, 0.98),
    },
    handDx: {
      p50: percentile(handDxAbs, 0.5),
      p90: percentile(handDxAbs, 0.9),
      max: percentile(handDxAbs, 0.98),
    },
    footBelow: {
      dyP10: percentile(footDy, 0.1),
      dyP50: percentile(footDy, 0.5),
      dyP90: percentile(footDy, 0.9),
      dyMin: Math.max(2, percentile(footDy, 0.05)),
      dyMax: percentile(footDy, 0.95),
      dxAbsP90: percentile(footDxAbs, 0.9),
    },
    /** Prefer alternating sides: positive = next hand tends outward to that side */
    sideDxP50: percentile(sideDx, 0.5),
    prevHandAsFootRate:
      prevHandAsFootTries > 0 ? prevHandAsFootHits / prevHandAsFootTries : 0.25,
    holdQuality,
    /** soft defaults if empty */
    boardCenterX: 72,
  }
  console.log('  rules handReach p50/p90', rules.handReach.p50, rules.handReach.p90)
  console.log('  rules footDy min/p50/max', rules.footBelow.dyMin, rules.footBelow.dyP50, rules.footBelow.dyMax)

  const models = {
    version: 2,
    builtAt: new Date().toISOString(),
    angle: ANGLE,
    climbCount: used,
    validPlacements: [...validIds],
    coords,
    /** 1 = Bolt Ons, 20 = Screw Ons — used by genRemix quality rules */
    setByPlacement,
    models: {
      freq: {
        id: 'freq',
        name: 'Frequency',
        description: 'Sample holds independently by how often each appears per role.',
        holdsByRole: {
          12: topWeighted(roleFreq[12], 400),
          13: topWeighted(roleFreq[13], 400),
          14: topWeighted(roleFreq[14], 400),
          15: topWeighted(roleFreq[15], 400),
        },
        sizeHist: histToArr(sizeHist),
        roleCountHist: {
          12: histToArr(roleCountHist[12]),
          13: histToArr(roleCountHist[13]),
          14: histToArr(roleCountHist[14]),
          15: histToArr(roleCountHist[15]),
        },
      },
      cooccur: {
        id: 'cooccur',
        name: 'Co-occurrence',
        description: 'Grow a climb from starts using holds that often appear together.',
        holdsByRole: {
          12: topWeighted(roleFreq[12], 300),
          13: topWeighted(roleFreq[13], 300),
          14: topWeighted(roleFreq[14], 300),
          15: topWeighted(roleFreq[15], 300),
        },
        partners: partnerLists,
        pairs: pairList.slice(0, 40_000),
        sizeHist: histToArr(sizeHist),
        roleCountHist: {
          12: histToArr(roleCountHist[12]),
          13: histToArr(roleCountHist[13]),
          14: histToArr(roleCountHist[14]),
          15: histToArr(roleCountHist[15]),
        },
      },
      spatial: {
        id: 'spatial',
        name: 'Spatial chain',
        description: 'Bottom-up flow: next holds prefer real spatial neighbors from training.',
        holdsByRole: {
          12: topWeighted(roleFreq[12], 300),
          13: topWeighted(roleFreq[13], 300),
          14: topWeighted(roleFreq[14], 300),
          15: topWeighted(roleFreq[15], 300),
        },
        edges: spatialList,
        sizeHist: histToArr(sizeHist),
        roleCountHist: {
          12: histToArr(roleCountHist[12]),
          13: histToArr(roleCountHist[13]),
          14: histToArr(roleCountHist[14]),
          15: histToArr(roleCountHist[15]),
        },
      },
      remix: {
        id: 'remix',
        name: 'Grade remix',
        description:
          'Real climb near grade + rule-aware mutation (L/R hands, feet under hands, reach, hold quality).',
        templates,
        partners: partnerLists,
        holdsByRole: {
          12: topWeighted(roleFreq[12], 300),
          13: topWeighted(roleFreq[13], 300),
          14: topWeighted(roleFreq[14], 300),
          15: topWeighted(roleFreq[15], 300),
        },
        rules,
      },
    },
  }

  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'models.json')
  fs.writeFileSync(outPath, JSON.stringify(models))
  const mb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2)
  console.log(`Wrote ${outPath} (${mb} MB)`)
  console.log('Models:', Object.keys(models.models).join(', '))
}

main()
