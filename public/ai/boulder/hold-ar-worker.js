/**
 * Hold-AR v1 — ONNX next-hold policy in a classic Web Worker.
 * Plan B4: onnxruntime-web WASM + illegal mask + polishClimb.
 *
 * Messages:
 *   { type: 'load' }
 *   { type: 'generate', grade?, seed?, temperature? }
 * → ready | result | error
 */
/* global ort */

importScripts('/ai/ort/ort.wasm.min.js')

/** @type {import('onnxruntime-web').InferenceSession | null} */
let session = null
/** @type {any} */
let index = null
/** @type {Record<string, [number, number]>} */
let coords = {}
/** @type {Record<string, number>} */
let setByPlacement = {}
/** @type {any} */
let rules = {}
let ready = false

const ROLES = [12, 13, 14, 15]
const MAX_LEN = 22
const MIN_HOLDS = 6

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function yOf(id) {
  return coords[String(id)]?.[1] ?? 80
}

function xOf(id) {
  return coords[String(id)]?.[0] ?? 72
}

function lastHand(holds) {
  const hands = [...holds.entries()]
    .filter(([, r]) => r === 12 || r === 13 || r === 14)
    .map(([id, r]) => ({ id, r, x: xOf(id), y: yOf(id) }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  return hands.length ? hands[hands.length - 1] : null
}

function polishClimb(holds) {
  const starts = [...holds.entries()].filter(([, r]) => r === 12).map(([id]) => id)
  const finishes = [...holds.entries()].filter(([, r]) => r === 14).map(([id]) => id)
  if (starts.length > 2) {
    starts
      .sort((a, b) => yOf(a) - yOf(b))
      .slice(2)
      .forEach((id) => holds.set(id, 13))
  }
  if (finishes.length > 2) {
    finishes
      .sort((a, b) => yOf(b) - yOf(a))
      .slice(2)
      .forEach((id) => holds.set(id, 13))
  }

  let startIds = [...holds.entries()].filter(([, r]) => r === 12).map(([id]) => id)
  let finishIds = [...holds.entries()].filter(([, r]) => r === 14).map(([id]) => id)

  if (startIds.length === 0 && holds.size) {
    const lowest = [...holds.keys()].sort((a, b) => yOf(a) - yOf(b))[0]
    holds.set(lowest, 12)
    startIds = [lowest]
  }
  if (finishIds.length === 0 && holds.size) {
    const highest = [...holds.keys()].sort((a, b) => yOf(b) - yOf(a))[0]
    if (!startIds.includes(highest)) {
      holds.set(highest, 14)
      finishIds = [highest]
    }
  }

  startIds = [...holds.entries()].filter(([, r]) => r === 12).map(([id]) => id)
  finishIds = [...holds.entries()].filter(([, r]) => r === 14).map(([id]) => id)

  const mean = (ids) =>
    ids.length ? ids.reduce((s, id) => s + yOf(id), 0) / ids.length : 0
  let sY = mean(startIds)
  let fY = mean(finishIds)

  const needReseat =
    (finishIds.length && startIds.length && fY < sY + 24) ||
    (finishIds.length && fY < 120) ||
    (startIds.length && sY > 90)
  if (needReseat && holds.size >= 3) {
    const all = [...holds.keys()].sort((a, b) => yOf(a) - yOf(b))
    for (const id of startIds) holds.set(id, 13)
    for (const id of finishIds) holds.set(id, 13)
    const nS = Math.min(2, Math.max(1, startIds.length || 1))
    const nF = Math.min(2, Math.max(1, finishIds.length || 1))
    for (let i = 0; i < nS; i++) holds.set(all[i], 12)
    for (let i = 0; i < nF; i++) holds.set(all[all.length - 1 - i], 14)
  }

  startIds = [...holds.entries()].filter(([, r]) => r === 12).map(([id]) => id)
  finishIds = [...holds.entries()].filter(([, r]) => r === 14).map(([id]) => id)
  if (startIds.length > 2) {
    startIds
      .sort((a, b) => yOf(a) - yOf(b))
      .slice(2)
      .forEach((id) => holds.set(id, 13))
  }
  if (finishIds.length > 2) {
    finishIds
      .sort((a, b) => yOf(b) - yOf(a))
      .slice(2)
      .forEach((id) => holds.set(id, 13))
  }
  return holds
}

function classToHold(cls, nPlacements) {
  if (cls < 0 || cls >= nPlacements * 4) return null
  const pIdx = Math.floor(cls / 4)
  const rIdx = cls % 4
  const placementId = index.indexToId[pIdx]
  const role = ROLES[rIdx]
  if (placementId == null || role == null) return null
  return { placementId, role, pIdx, rIdx }
}

/**
 * Build illegal mask over vocab (true = allowed).
 * @param {Map<number, number>} holds
 * @param {number} step
 */
function allowedMask(holds, step) {
  const n = index.nPlacements
  const stop = index.stopClass
  const vocab = index.vocabSize
  const allow = new Float32Array(vocab)
  // default all off
  let nStart = 0
  let nFinish = 0
  for (const r of holds.values()) {
    if (r === 12) nStart++
    if (r === 14) nFinish++
  }
  const used = new Set(holds.keys())
  const prev = lastHand(holds)
  const reachMax = rules?.handReach?.max ?? 55
  const footDyMin = rules?.footBelow?.dyMin ?? 6
  const footDyMax = rules?.footBelow?.dyMax ?? 48
  const footDxMax = rules?.footBelow?.dxAbsP90 ?? 28

  for (let pIdx = 0; pIdx < n; pIdx++) {
    const pid = index.indexToId[pIdx]
    if (pid == null || used.has(pid)) continue
    if (!coords[String(pid)]) continue
    const px = xOf(pid)
    const py = yOf(pid)
    for (let rIdx = 0; rIdx < 4; rIdx++) {
      const role = ROLES[rIdx]
      if (role === 12 && nStart >= 2) continue
      if (role === 14 && nFinish >= 2) continue
      // early steps: only starts until we have ≥1
      if (nStart === 0 && role !== 12 && step < 3) continue
      // don't finish before volume
      if (role === 14 && holds.size < 4) continue
      // reach cut for hand/finish vs previous hand sequence point
      if ((role === 13 || role === 14) && prev) {
        const d = Math.hypot(px - prev.x, py - prev.y)
        if (d > reachMax * 1.15) continue
      }
      // feet should sit roughly under a hand zone
      if (role === 15) {
        let okFoot = false
        for (const [hid, hr] of holds) {
          if (hr !== 12 && hr !== 13 && hr !== 14) continue
          const fdy = yOf(hid) - py
          const fdx = Math.abs(xOf(hid) - px)
          if (fdy >= footDyMin * 0.5 && fdy <= footDyMax * 1.2 && fdx <= footDxMax * 1.4) {
            okFoot = true
            break
          }
        }
        // allow early feet without hands only rarely — require a hand if any exist
        if (prev && !okFoot) continue
      }
      allow[pIdx * 4 + rIdx] = 1
    }
  }
  // STOP only after min holds
  if (holds.size >= MIN_HOLDS) allow[stop] = 1
  // force STOP if full
  if (holds.size >= MAX_LEN) {
    allow.fill(0)
    allow[stop] = 1
  }
  return allow
}

function sampleLogits(logits, allow, temperature, rand) {
  const T = Math.max(0.05, temperature)
  let maxL = -Infinity
  for (let i = 0; i < logits.length; i++) {
    if (!allow[i]) continue
    if (logits[i] > maxL) maxL = logits[i]
  }
  if (maxL === -Infinity) {
    // fallback: any start
    for (let i = 0; i < allow.length; i++) {
      if (allow[i]) return i
    }
    return index.stopClass
  }
  let sum = 0
  const weights = new Float32Array(logits.length)
  for (let i = 0; i < logits.length; i++) {
    if (!allow[i]) {
      weights[i] = 0
      continue
    }
    let w = Math.exp((logits[i] - maxL) / T)
    // downweight screw-on feet
    const hold = classToHold(i, index.nPlacements)
    if (hold && hold.role === 15) {
      const setId =
        setByPlacement[String(hold.placementId)] ??
        index.setByPlacement?.[String(hold.placementId)]
      if (setId === 20) w *= 0.15
    }
    weights[i] = w
    sum += w
  }
  if (sum <= 0) return index.stopClass
  let r = rand() * sum
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return index.stopClass
}

async function runStep(classes, gradeNorm) {
  const maxLen = index.maxLen || MAX_LEN
  const seq = new BigInt64Array(maxLen)
  const mask = new Uint8Array(maxLen)
  for (let i = 0; i < maxLen; i++) {
    if (i < classes.length) {
      seq[i] = BigInt(classes[i])
      mask[i] = 1
    } else {
      seq[i] = 0n
      mask[i] = 0
    }
  }
  const grade = new Float32Array([gradeNorm])

  // onnxruntime-web Tensor API
  const feeds = {
    seq: new ort.Tensor('int64', seq, [1, maxLen]),
    mask: new ort.Tensor('bool', mask, [1, maxLen]),
    grade: new ort.Tensor('float32', grade, [1, 1]),
  }
  const out = await session.run(feeds)
  const logitsTensor = out.logits || out[Object.keys(out)[0]]
  return logitsTensor.data // Float32Array length vocab
}

async function genHoldAr(grade, seed, temperature) {
  const rand = mulberry32(seed >>> 0)
  const g =
    grade != null && Number.isFinite(grade) ? Number(grade) : 16
  const gradeNorm = (Math.min(33, Math.max(10, g)) - 10) / 23

  /** @type {number[]} */
  const classes = []
  /** @type {Map<number, number>} */
  const holds = new Map()

  for (let step = 0; step < MAX_LEN; step++) {
    const logits = await runStep(classes, gradeNorm)
    const allow = allowedMask(holds, step)
    // ensure at least one allowed
    let any = false
    for (let i = 0; i < allow.length; i++) {
      if (allow[i]) {
        any = true
        break
      }
    }
    if (!any) break

    const cls = sampleLogits(logits, allow, temperature, rand)
    if (cls === index.stopClass) break

    const hold = classToHold(cls, index.nPlacements)
    if (!hold) break
    if (holds.has(hold.placementId)) continue
    holds.set(hold.placementId, hold.role)
    classes.push(cls)
  }

  // if too sparse, keep sampling without STOP
  let guard = 0
  while (holds.size < MIN_HOLDS && guard++ < 12) {
    const logits = await runStep(classes, gradeNorm)
    const allow = allowedMask(holds, classes.length)
    allow[index.stopClass] = 0
    const cls = sampleLogits(logits, allow, Math.max(temperature, 0.9), rand)
    if (cls === index.stopClass) break
    const hold = classToHold(cls, index.nPlacements)
    if (!hold || holds.has(hold.placementId)) break
    holds.set(hold.placementId, hold.role)
    classes.push(cls)
  }

  polishClimb(holds)
  return holds
}

async function loadAll() {
  if (typeof ort === 'undefined') {
    throw new Error('onnxruntime-web failed to load (importScripts)')
  }
  // Single-thread WASM is more reliable in dedicated workers
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  ort.env.wasm.wasmPaths = '/ai/ort/'

  const [indexRes, metaRes, modelsRes] = await Promise.all([
    fetch('/ai/boulder/placement_index.json'),
    fetch('/ai/boulder/hold-ar-v1.meta.json'),
    fetch('/ai/boulder/models.json'),
  ])
  if (!indexRes.ok) throw new Error('Failed to load placement_index.json')
  if (!modelsRes.ok) throw new Error('Failed to load models.json (coords)')
  index = await indexRes.json()
  if (metaRes.ok) {
    const meta = await metaRes.json()
    index.maxLen = meta.maxLen || MAX_LEN
    index.vocabSize = meta.vocab || index.vocabSize
    index.stopClass = meta.stopClass ?? index.stopClass
  }
  if (!index.setByPlacement) index.setByPlacement = {}
  setByPlacement = index.setByPlacement

  const pack = await modelsRes.json()
  coords = pack.coords || {}
  if (pack.setByPlacement) {
    setByPlacement = pack.setByPlacement
    index.setByPlacement = pack.setByPlacement
  }
  rules = pack.models?.remix?.rules || pack.rules || {}

  session = await ort.InferenceSession.create('/ai/boulder/hold-ar-v1.onnx', {
    executionProviders: ['wasm'],
  })
  ready = true
}

self.onmessage = async (ev) => {
  const msg = ev.data || {}
  try {
    if (msg.type === 'load') {
      await loadAll()
      self.postMessage({
        type: 'ready',
        models: [
          {
            id: 'hold-ar',
            name: 'Hold AR (local NN)',
            description:
              'Autoregressive next-hold ONNX policy · polishClimb after decode',
          },
        ],
        climbCount: undefined,
        builtAt: index?.createdAt,
        backend: 'hold-ar-onnx',
      })
      return
    }

    if (msg.type === 'generate') {
      if (!ready || !session) throw new Error('Hold-AR not loaded')
      const seed =
        typeof msg.seed === 'number' ? msg.seed : (Math.random() * 1e9) | 0
      const grade = msg.grade
      const temperature =
        typeof msg.temperature === 'number' ? msg.temperature : 0.85
      const holds = await genHoldAr(grade, seed, temperature)
      const list = [...holds.entries()].map(([id, role]) => [id, role])
      self.postMessage({
        type: 'result',
        model: 'hold-ar',
        seed,
        holds: list,
        meta: {
          holdCount: holds.size,
          starts: [...holds.values()].filter((r) => r === 12).length,
          finishes: [...holds.values()].filter((r) => r === 14).length,
        },
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
