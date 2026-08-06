/**
 * Local boulder generators — runs in a Web Worker.
 * Models: freq | cooccur | spatial | remix
 *
 * Tuned against real Boardsesh boulders @40°:
 *   ~12 holds, 1–2 starts (low Y), 1–2 finishes (high Y), ~99% finish above start
 */

/** @typedef {{ models: any, coords: Record<string,[number,number]>, validPlacements: number[] }} Pack */

/** @type {Pack | null} */
let pack = null

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickWeighted(items, rand) {
  let sum = 0
  for (const [, w] of items) sum += w
  if (sum <= 0 || items.length === 0) return null
  let r = rand() * sum
  for (const [id, w] of items) {
    r -= w
    if (r <= 0) return id
  }
  return items[items.length - 1][0]
}

function pickHist(hist, rand) {
  return pickWeighted(hist, rand)
}

function roleList(model, role) {
  return model.holdsByRole?.[String(role)] ?? model.holdsByRole?.[role] ?? []
}

function yOf(id, coords) {
  return coords?.[String(id)]?.[1] ?? 80
}

function xOf(id, coords) {
  return coords?.[String(id)]?.[0] ?? 72
}

/** Kilter set ids: 1 bolt-on (main), 20 screw-on (small). */
const SET_BOLT = 1
const SET_SCREW = 20

function setOf(id) {
  const m = pack?.setByPlacement
  if (!m) return 0
  return m[String(id)] ?? m[id] ?? 0
}

function isScrewOn(id) {
  return setOf(id) === SET_SCREW
}

function isBoltOn(id) {
  return setOf(id) === SET_BOLT
}

/** Bias pool weights by board height: lowY→starts, highY→finishes */
function biasPoolByY(pool, coords, mode) {
  // mode: 'low' | 'high' | 'mid'
  return pool.map(([id, w]) => {
    const y = yOf(id, coords)
    // board y roughly 0–156
    const t = Math.max(0, Math.min(1, y / 156))
    let mult = 1
    if (mode === 'low') mult = 0.25 + (1 - t) * 2.5 // prefer bottom
    else if (mode === 'high') mult = 0.25 + t * 2.8 // prefer top
    else mult = 0.6 + 1.2 * (1 - Math.abs(t - 0.5) * 2) // mid band
    return [id, Math.max(0.01, w * mult)]
  })
}

function sampleRoleCounts(model, rand) {
  const rc = model.roleCountHist || {}
  const n12 = pickHist(rc[12] || rc['12'] || [[2, 1]], rand) ?? 2
  const n13 = pickHist(rc[13] || rc['13'] || [[6, 1]], rand) ?? 6
  const n14 = pickHist(rc[14] || rc['14'] || [[1, 1]], rand) ?? 1
  const n15 = pickHist(rc[15] || rc['15'] || [[4, 1]], rand) ?? 4
  return {
    12: Math.min(2, Math.max(1, n12)),
    13: Math.min(18, Math.max(2, n13)),
    14: Math.min(2, Math.max(1, n14)),
    15: Math.min(14, Math.max(1, n15)),
  }
}

/**
 * Enforce Kilter-like structure:
 * - ≤2 starts, ≤2 finishes, ≥1 each when possible
 * - mean finish Y significantly above mean start Y (swap/reassign if not)
 */
function polishClimb(holds, coords) {
  // demote extras
  const starts = [...holds.entries()].filter(([, r]) => r === 12).map(([id]) => id)
  const finishes = [...holds.entries()].filter(([, r]) => r === 14).map(([id]) => id)
  if (starts.length > 2) {
    // keep lowest Y as starts
    starts
      .sort((a, b) => yOf(a, coords) - yOf(b, coords))
      .slice(2)
      .forEach((id) => holds.set(id, 13))
  }
  if (finishes.length > 2) {
    finishes
      .sort((a, b) => yOf(b, coords) - yOf(a, coords))
      .slice(2)
      .forEach((id) => holds.set(id, 13))
  }

  let startIds = [...holds.entries()].filter(([, r]) => r === 12).map(([id]) => id)
  let finishIds = [...holds.entries()].filter(([, r]) => r === 14).map(([id]) => id)

  // ensure ≥1 start / finish from extreme holds if missing
  if (startIds.length === 0 && holds.size) {
    const lowest = [...holds.keys()].sort(
      (a, b) => yOf(a, coords) - yOf(b, coords),
    )[0]
    holds.set(lowest, 12)
    startIds = [lowest]
  }
  if (finishIds.length === 0 && holds.size) {
    const highest = [...holds.keys()].sort(
      (a, b) => yOf(b, coords) - yOf(a, coords),
    )[0]
    if (!startIds.includes(highest)) {
      holds.set(highest, 14)
      finishIds = [highest]
    }
  }

  startIds = [...holds.entries()].filter(([, r]) => r === 12).map(([id]) => id)
  finishIds = [...holds.entries()].filter(([, r]) => r === 14).map(([id]) => id)

  const mean = (ids) =>
    ids.length
      ? ids.reduce((s, id) => s + yOf(id, coords), 0) / ids.length
      : 0
  let sY = mean(startIds)
  let fY = mean(finishIds)

  // Real climbs: starts ~y48, finishes ~y148. Fix inverted or “mid-board” finishes.
  const needReseat =
    (finishIds.length && startIds.length && fY < sY + 24) ||
    (finishIds.length && fY < 120) ||
    (startIds.length && sY > 90)
  if (needReseat && holds.size >= 3) {
    const all = [...holds.keys()].sort((a, b) => yOf(a, coords) - yOf(b, coords))
    for (const id of startIds) holds.set(id, 13)
    for (const id of finishIds) holds.set(id, 13)
    const nS = Math.min(2, Math.max(1, startIds.length || 1))
    const nF = Math.min(2, Math.max(1, finishIds.length || 1))
    for (let i = 0; i < nS; i++) holds.set(all[i], 12)
    for (let i = 0; i < nF; i++) holds.set(all[all.length - 1 - i], 14)
  }

  // clamp again
  startIds = [...holds.entries()].filter(([, r]) => r === 12).map(([id]) => id)
  finishIds = [...holds.entries()].filter(([, r]) => r === 14).map(([id]) => id)
  if (startIds.length > 2) {
    startIds
      .sort((a, b) => yOf(a, coords) - yOf(b, coords))
      .slice(2)
      .forEach((id) => holds.set(id, 13))
  }
  if (finishIds.length > 2) {
    finishIds
      .sort((a, b) => yOf(b, coords) - yOf(a, coords))
      .slice(2)
      .forEach((id) => holds.set(id, 13))
  }

  return holds
}

function pickDistinct(poolIn, n, rand, used) {
  const pool = poolIn.filter(([id]) => !used.has(id))
  const out = []
  let guard = 0
  while (out.length < n && pool.length && guard++ < 200) {
    const id = pickWeighted(pool, rand)
    if (id == null) break
    out.push(id)
    used.add(id)
    const idx = pool.findIndex(([x]) => x === id)
    if (idx >= 0) pool.splice(idx, 1)
  }
  return out
}

function genFreq(model, rand, coords) {
  const counts = sampleRoleCounts(model, rand)
  /** @type {Map<number, number>} */
  const holds = new Map()
  const used = new Set()

  for (const id of pickDistinct(
    biasPoolByY(roleList(model, 12), coords, 'low'),
    counts[12],
    rand,
    used,
  )) {
    holds.set(id, 12)
  }
  for (const id of pickDistinct(
    biasPoolByY(roleList(model, 14), coords, 'high'),
    counts[14],
    rand,
    used,
  )) {
    holds.set(id, 14)
  }
  for (const id of pickDistinct(
    biasPoolByY(roleList(model, 13), coords, 'mid'),
    counts[13],
    rand,
    used,
  )) {
    holds.set(id, 13)
  }
  for (const id of pickDistinct(
    biasPoolByY(roleList(model, 15), coords, 'mid'),
    counts[15],
    rand,
    used,
  )) {
    holds.set(id, 15)
  }
  return polishClimb(holds, coords)
}

function genCooccur(model, rand, coords) {
  const counts = sampleRoleCounts(model, rand)
  /** @type {Map<number, number>} */
  const holds = new Map()
  const partners = model.partners || {}
  const used = new Set()

  for (const id of pickDistinct(
    biasPoolByY(roleList(model, 12), coords, 'low'),
    counts[12],
    rand,
    used,
  )) {
    holds.set(id, 12)
  }

  function addRole(role, n, yMode) {
    let need = n
    let guard = 0
    while (need > 0 && guard++ < 300) {
      const base = biasPoolByY(roleList(model, role), coords, yMode)
      /** @type {Array<[number, number]>} */
      const scored = []
      for (const [id, w] of base) {
        if (holds.has(id)) continue
        let boost = 0
        const plist = partners[String(id)] || []
        for (const [pid, pw] of plist) {
          if (holds.has(pid)) boost += pw
        }
        scored.push([id, w + boost * 3])
      }
      if (!scored.length) break
      const id = pickWeighted(scored, rand)
      if (id == null) break
      holds.set(id, role)
      need--
    }
  }

  addRole(13, counts[13], 'mid')
  addRole(15, counts[15], 'mid')
  addRole(14, counts[14], 'high')
  return polishClimb(holds, coords)
}

/**
 * Spatial: grow a connected-ish set bottom→top, then assign roles by height.
 * (Previously assigned finish mid-route — that broke vertical flow.)
 */
function genSpatial(model, rand, coords) {
  const counts = sampleRoleCounts(model, rand)
  const total =
    counts[12] + counts[13] + counts[14] + counts[15]

  /** adjacency */
  /** @type {Map<number, Array<[number, number]>>} */
  const adj = new Map()
  for (const [a, b, w] of model.edges || []) {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a).push([b, w])
    adj.get(b).push([a, w])
  }

  // seed at bottom
  const startPool = biasPoolByY(roleList(model, 12), coords, 'low')
  /** @type {number[]} */
  const picked = []
  const used = new Set()
  const seed = pickWeighted(startPool, rand)
  if (seed != null) {
    picked.push(seed)
    used.add(seed)
  }

  let guard = 0
  while (picked.length < total && guard++ < 500) {
    // frontier: neighbors of all picked, prefer higher Y than current centroid
    const meanY =
      picked.reduce((s, id) => s + yOf(id, coords), 0) / Math.max(1, picked.length)
    /** @type {Array<[number, number]>} */
    const frontier = []
    const seen = new Set()
    for (const id of picked) {
      for (const [nid, w] of adj.get(id) || []) {
        if (used.has(nid) || seen.has(nid)) continue
        if (!coords[String(nid)]) continue
        seen.add(nid)
        const ny = yOf(nid, coords)
        // strong bias to go up, mild lateral
        const up = Math.max(0, ny - meanY)
        const score = w * (1 + up * 0.35) * (ny >= meanY - 8 ? 1.4 : 0.45)
        frontier.push([nid, score])
      }
    }
    let next = pickWeighted(frontier, rand)
    if (next == null) {
      // jump: pick any unused mid/high hold from hand pool
      const jump = roleList(model, 13).filter(([id]) => !used.has(id))
      next = pickWeighted(biasPoolByY(jump, coords, 'high'), rand)
    }
    if (next == null) break
    picked.push(next)
    used.add(next)
  }

  // fill if short
  while (picked.length < Math.min(total, 8)) {
    const pool = roleList(model, 13).filter(([id]) => !used.has(id))
    const id = pickWeighted(pool, rand)
    if (id == null) break
    picked.push(id)
    used.add(id)
  }

  // Ensure vertical coverage without bloating hold count:
  // replace mid holds with high/low anchors if span is short
  const minSpan = 120
  {
    let ys = picked.map((id) => yOf(id, coords))
    let span = Math.max(...ys) - Math.min(...ys)
    let g2 = 0
    while (span < minSpan && g2++ < 24 && picked.length >= 3) {
      // drop a middle hold, add a high one
      const ordered = [...picked].sort((a, b) => yOf(a, coords) - yOf(b, coords))
      const mid = ordered[Math.floor(ordered.length / 2)]
      const highPool = biasPoolByY(
        roleList(model, 14)
          .concat(roleList(model, 13))
          .filter(([id]) => !used.has(id) || id === mid),
        coords,
        'high',
      ).filter(([id]) => id !== mid)
      const id = pickWeighted(highPool, rand)
      if (id == null) break
      // swap mid → high
      const ix = picked.indexOf(mid)
      if (ix >= 0) picked.splice(ix, 1)
      used.delete(mid)
      picked.push(id)
      used.add(id)
      ys = picked.map((x) => yOf(x, coords))
      span = Math.max(...ys) - Math.min(...ys)
    }
    // guarantee a top finish candidate
    const maxY = Math.max(...picked.map((id) => yOf(id, coords)))
    if (maxY < 135 && picked.length) {
      const ordered = [...picked].sort((a, b) => yOf(a, coords) - yOf(b, coords))
      const replace = ordered[ordered.length - 1]
      const topPool = biasPoolByY(
        roleList(model, 14).filter(([id]) => !used.has(id)),
        coords,
        'high',
      )
      const id = pickWeighted(topPool, rand)
      if (id != null) {
        const ix = picked.indexOf(replace)
        if (ix >= 0) picked.splice(ix, 1)
        used.delete(replace)
        picked.push(id)
        used.add(id)
      }
    }
  }

  // assign roles by height rank
  const ordered = [...picked].sort((a, b) => yOf(a, coords) - yOf(b, coords))
  /** @type {Map<number, number>} */
  const holds = new Map()
  const nS = counts[12]
  const nF = counts[14]
  for (let i = 0; i < ordered.length; i++) {
    const id = ordered[i]
    if (i < nS) holds.set(id, 12)
    else if (i >= ordered.length - nF) holds.set(id, 14)
    else {
      // alternate hand/foot with slight preference for hand mid-high, foot mid-low
      const t = ordered.length <= 1 ? 0.5 : i / (ordered.length - 1)
      const footBias = t < 0.55 ? 0.55 : 0.35
      holds.set(id, rand() < footBias ? 15 : 13)
    }
  }

  // rebalance hand/foot counts toward target roughly
  const hands = [...holds.entries()].filter(([, r]) => r === 13)
  const feet = [...holds.entries()].filter(([, r]) => r === 15)
  // if too few hands, convert some feet in upper half
  while (hands.length < counts[13] && feet.length) {
    const cand = feet
      .filter(([id]) => yOf(id, coords) > 60)
      .sort((a, b) => yOf(b[0], coords) - yOf(a[0], coords))
    if (!cand.length) break
    const [id] = cand[0]
    holds.set(id, 13)
    hands.push([id, 13])
    const fi = feet.findIndex(([x]) => x === id)
    if (fi >= 0) feet.splice(fi, 1)
  }

  return polishClimb(holds, coords)
}

/** Hand sequence bottom→top with inferred L/R sides (alternate). */
function handSequence(holds, coords) {
  const seq = [...holds.entries()]
    .filter(([, r]) => r === 12 || r === 13 || r === 14)
    .map(([id, r]) => ({
      id,
      r,
      x: xOf(id, coords),
      y: yOf(id, coords),
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  if (!seq.length) return seq
  // First hold: L if left of center, else R — then alternate
  let side = seq[0].x < 72 ? 'L' : 'R'
  for (const h of seq) {
    h.side = side
    side = side === 'L' ? 'R' : 'L'
  }
  return seq
}

function qualityOf(id, rules) {
  return rules?.holdQuality?.[String(id)] ?? 30
}

/**
 * Stable fingerprint of a remix template (source holds + difficulty).
 * Same algorithm as scripts/apply-feedback.mjs.
 * @param {number} difficulty
 * @param {Array<[number, number]>} holdsList
 */
function templateFingerprint(difficulty, holdsList) {
  const d = Number.isFinite(difficulty) ? difficulty : 16
  const parts = (holdsList || [])
    .map(([id, role]) => `${id}:${role}`)
    .sort()
  const s = `${d}|${parts.join(',')}`
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0
  }
  return `d${d}-${h.toString(16).padStart(8, '0')}`
}

/**
 * Rule-aware remix:
 * - pick real template near grade
 * - mutate hands/feet with L/R reach, foot-under-hand, quality
 * - strongMutation: higher swap rate (toggle, default off in UI)
 * @returns {{ holds: Map<number, number>, templateId: string, templateGrade: number }}
 */
function genRemix(model, rand, coords, grade, strongMutation) {
  const templates = model.templates || []
  if (!templates.length) {
    return {
      holds: genFreq(model, rand, coords),
      templateId: undefined,
      templateGrade: undefined,
    }
  }

  const rules = model.rules || {}
  const reachP50 = rules.handReach?.p50 ?? 28
  const reachP90 = rules.handReach?.p90 ?? 42
  const reachMax = (rules.handReach?.max ?? 55) * (strongMutation ? 1.25 : 1)
  const footDyMin = rules.footBelow?.dyMin ?? 6
  const footDyMax = rules.footBelow?.dyMax ?? 48
  const footDxMax = rules.footBelow?.dxAbsP90 ?? 28

  const target = grade != null && Number.isFinite(grade) ? grade : 16
  /** @type {Array<[any, number]>} */
  const scored = templates.map((t) => {
    const dist = Math.abs((t.d ?? 16) - target)
    return [t, 1 / (1 + dist * dist)]
  })
  let sum = 0
  for (const [, w] of scored) sum += w
  let r = rand() * sum
  let tpl = scored[0][0]
  for (const [t, w] of scored) {
    r -= w
    if (r <= 0) {
      tpl = t
      break
    }
  }

  const templateGrade = tpl.d ?? 16
  const templateId = templateFingerprint(templateGrade, tpl.h || [])

  /** @type {Map<number, number>} */
  const holds = new Map()
  for (const [id, role] of tpl.h || []) {
    if (coords[String(id)]) holds.set(id, role)
  }

  // Mutation rate: soft default, strong optional
  const mutRate = strongMutation
    ? 0.38 + rand() * 0.18
    : 0.12 + rand() * 0.1
  const partners = model.partners || {}

  const seq0 = handSequence(holds, coords)
  const sideById = new Map(seq0.map((h) => [h.id, h.side]))

  // Mutate hands (not start/finish) and feet
  const mutable = [...holds.entries()].filter(
    ([, r]) => r === 13 || r === 15,
  )
  const mutN = Math.floor(mutable.length * mutRate)

  for (let m = 0; m < mutN; m++) {
    if (!mutable.length) break
    const idx = Math.floor(rand() * mutable.length)
    const [oldId, role] = mutable[idx]
    const oldY = yOf(oldId, coords)
    const oldX = xOf(oldId, coords)
    const side = sideById.get(oldId) || (oldX < 72 ? 'L' : 'R')

    // neighbors in hand sequence for reach constraints
    const seq = handSequence(holds, coords)
    const hi = seq.findIndex((h) => h.id === oldId)
    const prev = hi > 0 ? seq[hi - 1] : null
    const next = hi >= 0 && hi < seq.length - 1 ? seq[hi + 1] : null

    holds.delete(oldId)
    const plist = partners[String(oldId)] || roleList(model, role)
    let candidates = plist
      .concat(roleList(model, role))
      .filter(([id]) => !holds.has(id) && coords[String(id)])

    /** @type {Array<[number, number]>} */
    const scoredC = []
    for (const [id, w] of candidates) {
      const x = xOf(id, coords)
      const y = yOf(id, coords)
      const q = qualityOf(id, rules) / 100
      // quality: prefer better holds (strong mut softens this)
      const qW = strongMutation ? 0.35 + 0.65 * q : 0.15 + 1.2 * q
      // similar height
      const dy = Math.abs(y - oldY)
      const yW = 1 / (1 + dy * (strongMutation ? 0.04 : 0.09))
      // side fit: L wants smaller x than board center / prev
      let sideW = 1
      if (role === 13 || role === 12 || role === 14) {
        if (side === 'L') sideW = x <= oldX + 8 ? 1.4 : 0.55
        else sideW = x >= oldX - 8 ? 1.4 : 0.55
      }
      // reach to prev/next hand
      let reachW = 1
      if (role !== 15) {
        if (prev) {
          const d = Math.hypot(x - prev.x, y - prev.y)
          if (d > reachMax) reachW *= 0.05
          else if (d > reachP90) reachW *= 0.35
          else if (d < reachP50 * 0.35) reachW *= 0.6
          else reachW *= 1.2
        }
        if (next) {
          const d = Math.hypot(x - next.x, y - next.y)
          if (d > reachMax) reachW *= 0.05
          else if (d > reachP90) reachW *= 0.35
        }
      } else {
        // foot: should sit under some hand
        const hands = [...holds.entries()].filter(
          ([, rr]) => rr === 12 || rr === 13 || rr === 14,
        )
        let best = 0
        for (const [hid] of hands) {
          const hy = yOf(hid, coords)
          const hx = xOf(hid, coords)
          const fdy = hy - y
          const fdx = Math.abs(x - hx)
          if (fdy >= footDyMin && fdy <= footDyMax && fdx <= footDxMax * 1.2) {
            best = Math.max(best, 1.5)
          } else if (fdy > 0 && fdy < footDyMax * 1.3) {
            best = Math.max(best, 0.7)
          }
        }
        // previous hand as foot: near a lower hand position
        for (const h of handSequence(holds, coords)) {
          if (h.y >= y - 2) continue
          const d = Math.hypot(x - h.x, y - h.y)
          if (d < 14) best = Math.max(best, 1.8)
        }
        reachW *= best || 0.25
      }

      // Hold set: prefer bolt-ons; screw-ons as feet under hands are usually junk
      let setW = 1
      if (isScrewOn(id)) {
        if (role === 15) {
          setW = strongMutation ? 0.12 : 0.06
        } else if (role === 13) {
          // small intermediate hands between main holds — soft penalty
          setW = strongMutation ? 0.55 : 0.35
        }
      } else if (isBoltOn(id)) {
        setW = role === 15 ? 1.15 : 1.25
      }

      const score = Math.max(0.001, w * qW * yW * sideW * reachW * setW)
      scoredC.push([id, score])
    }

    const nid = pickWeighted(
      scoredC.length ? scoredC : roleList(model, role),
      rand,
    )
    if (nid != null && !holds.has(nid)) {
      holds.set(nid, role)
      mutable[idx] = [nid, role]
      if (side) sideById.set(nid, side)
    } else {
      holds.set(oldId, role)
    }
  }

  // Ensure feet under hands (add if missing, without exploding count)
  {
    const seq = handSequence(holds, coords)
    const feet = [...holds.entries()].filter(([, r]) => r === 15)
    for (let i = 1; i < seq.length; i++) {
      const h = seq[i]
      const hasFoot = feet.some(([fid]) => {
        const fdy = h.y - yOf(fid, coords)
        const fdx = Math.abs(h.x - xOf(fid, coords))
        return fdy >= footDyMin && fdy <= footDyMax && fdx <= footDxMax * 1.25
      })
      if (hasFoot) continue
      if (holds.size >= 22) break
      // candidate feet: role-15 pool under this hand, or previous hand geometry
      const prev = seq[i - 1]
      const pool = roleList(model, 15)
        .filter(([id]) => !holds.has(id) && coords[String(id)])
        .map(([id, w]) => {
          const fy = yOf(id, coords)
          const fx = xOf(id, coords)
          const fdy = h.y - fy
          const fdx = Math.abs(h.x - fx)
          if (fdy < footDyMin || fdy > footDyMax) return [id, 0.01]
          let s = w * (1 + qualityOf(id, rules) / 80)
          if (fdx > footDxMax) s *= 0.3
          // near previous hand (feet can be previous hands)
          if (prev) {
            const dPrev = Math.hypot(fx - prev.x, fy - prev.y)
            if (dPrev < 16) s *= 2.2
          }
          // same side as hand
          if (h.side === 'L' && fx <= h.x + 6) s *= 1.3
          if (h.side === 'R' && fx >= h.x - 6) s *= 1.3
          // Screw-on feet under hands: strong avoid
          if (isScrewOn(id)) s *= 0.05
          else if (isBoltOn(id)) s *= 1.2
          return [id, s]
        })
        .filter(([, s]) => s > 0.02)
      const fid = pickWeighted(pool, rand)
      if (fid != null) {
        holds.set(fid, 15)
        feet.push([fid, 15])
      }
    }
  }

  // Drop hands that are impossibly far from sequence after mutation
  {
    const seq = handSequence(holds, coords)
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1]
      const b = seq[i]
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      if (d > reachMax * 1.15 && b.r === 13) {
        // try replace b
        holds.delete(b.id)
        const pool = roleList(model, 13)
          .filter(([id]) => !holds.has(id))
          .map(([id, w]) => {
            const x = xOf(id, coords)
            const y = yOf(id, coords)
            const dd = Math.hypot(x - a.x, y - a.y)
            if (dd > reachMax) return [id, 0.01]
            let s =
              w *
              (1 + qualityOf(id, rules) / 50) *
              (1 / (1 + Math.abs(dd - reachP50)))
            if (isScrewOn(id)) s *= 0.35
            return [id, s]
          })
        const nid = pickWeighted(pool, rand)
        if (nid != null) holds.set(nid, 13)
        else holds.set(b.id, 13) // restore
      }
    }
  }

  // Cleanup: remove or replace screw-on feet that sit under a hand
  {
    const feet = [...holds.entries()].filter(([, r]) => r === 15)
    for (const [fid] of feet) {
      if (!isScrewOn(fid)) continue
      const fy = yOf(fid, coords)
      const fx = xOf(fid, coords)
      let underHand = false
      for (const [hid, hr] of holds) {
        if (hr !== 12 && hr !== 13 && hr !== 14) continue
        const fdy = yOf(hid, coords) - fy
        const fdx = Math.abs(xOf(hid, coords) - fx)
        if (fdy >= footDyMin * 0.7 && fdy <= footDyMax && fdx <= footDxMax * 1.3) {
          underHand = true
          break
        }
      }
      if (!underHand) continue
      holds.delete(fid)
      // try bolt-on replacement under nearest hand
      const hands = handSequence(holds, coords)
      let bestPool = []
      for (const h of hands) {
        const pool = roleList(model, 15)
          .filter(([id]) => !holds.has(id) && coords[String(id)] && isBoltOn(id))
          .map(([id, w]) => {
            const fy2 = yOf(id, coords)
            const fx2 = xOf(id, coords)
            const fdy = h.y - fy2
            const fdx = Math.abs(h.x - fx2)
            if (fdy < footDyMin || fdy > footDyMax) return [id, 0]
            if (fdx > footDxMax) return [id, 0.05]
            return [id, w * (1 + qualityOf(id, rules) / 60)]
          })
          .filter(([, s]) => s > 0.02)
        if (pool.length) bestPool = bestPool.concat(pool)
      }
      const nid = pickWeighted(bestPool, rand)
      if (nid != null) holds.set(nid, 15)
    }
  }

  return {
    holds: polishClimb(holds, coords),
    templateId,
    templateGrade,
  }
}

function holdsToList(holds) {
  return [...holds.entries()].map(([id, role]) => [id, role])
}

self.onmessage = async (ev) => {
  const msg = ev.data || {}
  try {
    if (msg.type === 'load') {
      const url = msg.url || '/ai/boulder/models.json'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to load models: HTTP ${res.status}`)
      pack = await res.json()
      self.postMessage({
        type: 'ready',
        models: Object.keys(pack.models || {}).map((id) => {
          const m = pack.models[id]
          return {
            id,
            name: m.name,
            description: m.description,
          }
        }),
        climbCount: pack.climbCount,
        builtAt: pack.builtAt,
      })
      return
    }

    if (msg.type === 'generate') {
      if (!pack) throw new Error('Models not loaded')
      const modelId = msg.model || 'freq'
      const model = pack.models[modelId]
      if (!model) throw new Error(`Unknown model: ${modelId}`)
      const seed =
        typeof msg.seed === 'number' ? msg.seed : (Math.random() * 1e9) | 0
      const rand = mulberry32(seed >>> 0)
      const grade = msg.grade
      const strongMutation = !!msg.strongMutation
      const coords = pack.coords || {}

      /** @type {Map<number, number>} */
      let holds
      /** @type {string | undefined} */
      let templateId
      /** @type {number | undefined} */
      let templateGrade
      if (modelId === 'freq') holds = genFreq(model, rand, coords)
      else if (modelId === 'cooccur') holds = genCooccur(model, rand, coords)
      else if (modelId === 'spatial') holds = genSpatial(model, rand, coords)
      else if (modelId === 'remix') {
        const out = genRemix(model, rand, coords, grade, strongMutation)
        holds = out.holds
        templateId = out.templateId
        templateGrade = out.templateGrade
      } else holds = genFreq(model, rand, coords)

      /** @type {Record<string, unknown>} */
      const meta = {
        holdCount: holds.size,
        starts: [...holds.values()].filter((r) => r === 12).length,
        finishes: [...holds.values()].filter((r) => r === 14).length,
      }
      if (templateId) meta.templateId = templateId
      if (templateGrade != null) meta.templateGrade = templateGrade

      self.postMessage({
        type: 'result',
        model: modelId,
        seed,
        holds: holdsToList(holds),
        meta,
      })
      return
    }

    self.postMessage({ type: 'error', error: `Unknown message: ${msg.type}` })
  } catch (e) {
    self.postMessage({
      type: 'error',
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
