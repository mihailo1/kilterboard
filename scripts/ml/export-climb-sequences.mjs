#!/usr/bin/env node
/**
 * Plan B1 — export single-frame boulder sequences for hold-ar training.
 *
 * Reads Boardsesh SQLite + Kilter layout JSON.
 * Writes (under data/ml/):
 *   placement_index.json  — frozen vocab maps (commit this)
 *   climbs-40.jsonl       — one climb per line
 *   split.json            — train/val uuid lists
 *   stats.json            — summary counts
 *
 * Usage:
 *   node scripts/ml/export-climb-sequences.mjs
 *   npm run ml:export-sequences
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '../..')
const dbPath = path.join(root, 'data/boardsesh/kilter-12x12.db')
const outDir = path.join(root, 'data/ml')

const ANGLE = 40
const MIN_HOLDS = 6
const MAX_HOLDS = 22
const MIN_STARTS = 1
const MAX_STARTS = 2
const MIN_FINISHES = 1
const MAX_FINISHES = 2
const VAL_FRAC = 0.1
/** Stable seed for split (not crypto security). */
const SPLIT_SEED = 'kilter-hold-ar-v1'

const ROLE_START = 12
const ROLE_HAND = 13
const ROLE_FINISH = 14
const ROLE_FOOT = 15
const ROLES = [ROLE_START, ROLE_HAND, ROLE_FINISH, ROLE_FOOT]

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
  const bases = [12, 20, 24, 28, 32, 36, 42, 46, 50]
  for (const b of bases) {
    if (r >= b && r < b + 4) return 12 + (r - b)
  }
  if (r === 12 || r === 13 || r === 14 || r === 15) return r
  return 13
}

function loadLayout() {
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
  if (!size) throw new Error('product size 10 not found')
  const holeById = new Map(holes.map((h) => [h.id, h]))

  /** @type {number[]} */
  const validIds = []
  /** @type {Record<string, [number, number]>} */
  const coords = {}
  /** @type {Record<string, number>} */
  const setByPlacement = {}

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
    const id = p.id
    validIds.push(id)
    coords[String(id)] = [h.x, h.y]
    setByPlacement[String(id)] = p.set_id
  }

  // Stable order: sort by id ascending (freeze forever for this layout cut)
  validIds.sort((a, b) => a - b)

  /** @type {Record<string, number>} */
  const idToIndex = {}
  /** @type {number[]} */
  const indexToId = validIds.slice()
  for (let i = 0; i < validIds.length; i++) {
    idToIndex[String(validIds[i])] = i
  }

  return { validIds, coords, setByPlacement, idToIndex, indexToId }
}

/**
 * Canonical sequence for AR training (deterministic).
 * Starts → hands → finishes → feet; within role by (y asc, x asc).
 * @param {Map<number, number>} holdMap placement → role
 * @param {Record<string, [number, number]>} coords
 */
function canonicalTokens(holdMap, coords) {
  /** @type {Array<{ id: number, role: number, x: number, y: number }>} */
  const items = []
  for (const [id, rawRole] of holdMap) {
    const role = normalizeRole(rawRole)
    if (!ROLES.includes(role)) continue
    const c = coords[String(id)]
    if (!c) continue
    items.push({ id, role, x: c[0], y: c[1] })
  }

  const roleOrder = {
    [ROLE_START]: 0,
    [ROLE_HAND]: 1,
    [ROLE_FINISH]: 2,
    [ROLE_FOOT]: 3,
  }

  items.sort((a, b) => {
    const ra = roleOrder[a.role] ?? 9
    const rb = roleOrder[b.role] ?? 9
    if (ra !== rb) return ra - rb
    if (a.y !== b.y) return a.y - b.y
    if (a.x !== b.x) return a.x - b.x
    return a.id - b.id
  })

  return items.map((it) => /** @type {[number, number]} */ ([it.id, it.role]))
}

function climbHash(frames, difficulty) {
  return crypto
    .createHash('sha256')
    .update(SPLIT_SEED)
    .update('\0')
    .update(String(difficulty))
    .update('\0')
    .update(frames)
    .digest('hex')
    .slice(0, 16)
}

/** Deterministic 0..1 from hash string */
function hashUnit(hex16) {
  const n = parseInt(hex16.slice(0, 8), 16)
  return n / 0xffffffff
}

function gradeBand(d) {
  if (d <= 15) return '10-15'
  if (d <= 20) return '16-20'
  if (d <= 25) return '21-25'
  return '26-33'
}

function main() {
  if (!fs.existsSync(dbPath)) {
    console.error('Missing DB. Run: npm run sync:climbs')
    process.exit(1)
  }

  const { validIds, coords, setByPlacement, idToIndex, indexToId } =
    loadLayout()
  const N = validIds.length
  const vocabSize = N * 4 + 1 // placement×role + STOP

  console.log(`Layout placements: ${N}`)
  console.log(`Vocab size (N*4+STOP): ${vocabSize}`)

  const db = new DatabaseSync(dbPath, { readOnly: true })
  console.log(`Scanning boulders @${ANGLE}° (single-frame)…`)
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

  /** @type {any[]} */
  const climbs = []
  const skip = {
    empty: 0,
    size: 0,
    starts: 0,
    finishes: 0,
    invalidPlacement: 0,
    noCoords: 0,
  }

  for (const row of rows) {
    const frames = row.frames
    const difficulty = Math.round(Number(row.difficulty))
    if (!Number.isFinite(difficulty) || difficulty < 10 || difficulty > 33) {
      continue
    }

    const holdMap = parseFrames(frames)
    if (holdMap.size === 0) {
      skip.empty++
      continue
    }

    // Keep only valid placements; drop unknowns
    /** @type {Map<number, number>} */
    const cleaned = new Map()
    let badP = false
    for (const [id, rawRole] of holdMap) {
      if (!coords[String(id)]) {
        badP = true
        continue
      }
      cleaned.set(id, normalizeRole(rawRole))
    }
    if (cleaned.size === 0) {
      skip.invalidPlacement++
      continue
    }
    if (badP && cleaned.size < holdMap.size) {
      // partial — still use cleaned if size ok
    }

    if (cleaned.size < MIN_HOLDS || cleaned.size > MAX_HOLDS) {
      skip.size++
      continue
    }

    let nStart = 0
    let nFinish = 0
    for (const r of cleaned.values()) {
      if (r === ROLE_START) nStart++
      if (r === ROLE_FINISH) nFinish++
    }
    if (nStart < MIN_STARTS || nStart > MAX_STARTS) {
      skip.starts++
      continue
    }
    if (nFinish < MIN_FINISHES || nFinish > MAX_FINISHES) {
      skip.finishes++
      continue
    }

    const tokens = canonicalTokens(cleaned, coords)
    if (tokens.length < MIN_HOLDS) {
      skip.noCoords++
      continue
    }

    // Indices for training (placement index + role)
    const tokenIndices = tokens.map(([pid, role]) => {
      const pIdx = idToIndex[String(pid)]
      if (pIdx === undefined) return null
      const rIdx = ROLES.indexOf(role)
      if (rIdx < 0) return null
      // flat class: placement_index * 4 + role_index  (STOP = N*4)
      return pIdx * 4 + rIdx
    })
    if (tokenIndices.some((x) => x == null)) {
      skip.invalidPlacement++
      continue
    }

    const setIds = tokens.map(
      ([pid]) => setByPlacement[String(pid)] ?? 0,
    )

    const id = climbHash(frames, difficulty)
    climbs.push({
      id,
      grade: difficulty,
      angle: ANGLE,
      holdCount: tokens.length,
      tokens, // [[placementId, roleId], ...]
      tokenClasses: tokenIndices, // flat class ids for AR
      setIds,
      ascents: row.ascents != null ? Number(row.ascents) : null,
      band: gradeBand(difficulty),
    })
  }

  console.log(`  kept: ${climbs.length}`)
  console.log('  skipped:', skip)

  // Stratified split by band
  /** @type {Record<string, any[]>} */
  const byBand = {}
  for (const c of climbs) {
    if (!byBand[c.band]) byBand[c.band] = []
    byBand[c.band].push(c)
  }

  const trainIds = []
  const valIds = []
  for (const band of Object.keys(byBand).sort()) {
    const list = byBand[band]
    // sort by id for determinism
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const c of list) {
      if (hashUnit(c.id) < VAL_FRAC) valIds.push(c.id)
      else trainIds.push(c.id)
    }
  }

  // Stats
  const lengthHist = {}
  const gradeHist = {}
  const bandHist = {}
  let sumLen = 0
  let screwFoot = 0
  let footTotal = 0
  for (const c of climbs) {
    sumLen += c.holdCount
    lengthHist[c.holdCount] = (lengthHist[c.holdCount] || 0) + 1
    gradeHist[c.grade] = (gradeHist[c.grade] || 0) + 1
    bandHist[c.band] = (bandHist[c.band] || 0) + 1
    for (let i = 0; i < c.tokens.length; i++) {
      if (c.tokens[i][1] === ROLE_FOOT) {
        footTotal++
        if (c.setIds[i] === 20) screwFoot++
      }
    }
  }

  const placementIndex = {
    version: 1,
    createdAt: new Date().toISOString(),
    layoutId: 1,
    sizeId: 10,
    angle: ANGLE,
    nPlacements: N,
    roles: ROLES,
    roleNames: { 12: 'start', 13: 'hand', 14: 'finish', 15: 'foot' },
    stopClass: N * 4,
    vocabSize,
    /** flat class = placementIndex * 4 + roleIndex (0=start..3=foot) */
    classEncoding: 'placementIndex * 4 + roleIndex; STOP = nPlacements * 4',
    idToIndex,
    indexToId,
    setByPlacement,
    coords,
    sequenceOrder:
      'role groups start→hand→finish→foot; within group y asc, x asc, id',
  }

  const stats = {
    version: 1,
    createdAt: new Date().toISOString(),
    angle: ANGLE,
    filters: {
      minHolds: MIN_HOLDS,
      maxHolds: MAX_HOLDS,
      starts: [MIN_STARTS, MAX_STARTS],
      finishes: [MIN_FINISHES, MAX_FINISHES],
    },
    rawRows: rows.length,
    kept: climbs.length,
    skipped: skip,
    nPlacements: N,
    vocabSize,
    stopClass: N * 4,
    trainCount: trainIds.length,
    valCount: valIds.length,
    meanHoldCount: climbs.length ? sumLen / climbs.length : 0,
    lengthHist,
    gradeHist,
    bandHist,
    screwOnFootRate: footTotal ? screwFoot / footTotal : 0,
  }

  const split = {
    version: 1,
    seed: SPLIT_SEED,
    valFrac: VAL_FRAC,
    trainIds,
    valIds,
  }

  fs.mkdirSync(outDir, { recursive: true })

  // placement_index — small enough to commit (coords make it ~larger; strip coords from commit copy?)
  // Plan says commit placement_index; coords useful for train — keep but note size
  const indexPath = path.join(outDir, 'placement_index.json')
  fs.writeFileSync(indexPath, JSON.stringify(placementIndex))

  const jsonlPath = path.join(outDir, 'climbs-40.jsonl')
  const ws = fs.createWriteStream(jsonlPath)
  for (const c of climbs) {
    ws.write(JSON.stringify(c) + '\n')
  }
  ws.end()

  fs.writeFileSync(path.join(outDir, 'split.json'), JSON.stringify(split))
  fs.writeFileSync(
    path.join(outDir, 'stats.json'),
    JSON.stringify(stats, null, 2) + '\n',
  )

  // Also copy placement_index into public for future worker (without huge coords optional)
  const publicIndex = {
    version: placementIndex.version,
    createdAt: placementIndex.createdAt,
    nPlacements: N,
    roles: ROLES,
    stopClass: placementIndex.stopClass,
    vocabSize,
    classEncoding: placementIndex.classEncoding,
    idToIndex,
    indexToId,
    setByPlacement,
  }
  const pubDir = path.join(root, 'public/ai/boulder')
  fs.mkdirSync(pubDir, { recursive: true })
  fs.writeFileSync(
    path.join(pubDir, 'placement_index.json'),
    JSON.stringify(publicIndex),
  )

  console.log('')
  console.log('=== B1 export done ===')
  console.log(`  ${path.relative(root, indexPath)}`)
  console.log(`  ${path.relative(root, jsonlPath)} (${climbs.length} lines)`)
  console.log(`  data/ml/split.json  train=${trainIds.length} val=${valIds.length}`)
  console.log(`  data/ml/stats.json`)
  console.log(`  public/ai/boulder/placement_index.json (slim)`)
  console.log('')
  console.log('Stats:')
  console.log(`  mean holds: ${stats.meanHoldCount.toFixed(2)}`)
  console.log(`  bands: ${JSON.stringify(bandHist)}`)
  console.log(
    `  screw-on as foot rate: ${(stats.screwOnFootRate * 100).toFixed(1)}%`,
  )
  console.log(`  grade histogram keys: ${Object.keys(gradeHist).length} grades`)
}

main()
