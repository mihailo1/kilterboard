/**
 * Hold AR v2 — ONNX next-hold model in a classic Web Worker.
 *
 * Decoding (keep in sync with ml/hold-ar/decode.py V2Decoder):
 *   - K candidates sampled together in one batch, conditioned on grade, angle
 *     and quality = "great" (optional classifier-free guidance)
 *   - hard constraints only: unused hold, ≤2 starts, ≤2 finishes, first hold
 *     is a start, STOP once there are ≥6 holds with a start and a finish
 *   - plain sampling (temperature / min-p / top-p kept as options, off by default)
 *   - rerank: likWeight · mean log-probability − gradeWeight · |predicted − requested grade|,
 *     preferring candidates whose finish sits above the start. Default likWeight 0:
 *     picking the most likely candidate made climbs generic in the offline eval.
 * No hand-written reach / foot rules and no polish pass: the model decides.
 *
 * Messages:
 *   { type: 'load' }
 *   { type: 'generate', grade?, angle?, seed?, temperature? }
 * → ready | result | error
 */
/* global ort */

importScripts('/ai/ort/ort.wasm.min.js')

// Overridden by hold-ar-v2.meta.json "decode" (chosen by ml/hold-ar/eval_gen.py).
const DEFAULTS = {
  candidates: 8,
  temperature: 1.0,
  topP: 1.0,
  minP: 0,
  guidance: 0,
  gradeWeight: 1.0,
  likWeight: 0,
}
const ROLES = [12, 13, 14, 15] // start, hand, finish, foot
const START = 0
const FINISH = 2
const Q_GREAT = 3
const Q_UNKNOWN = 4

let ar = null
let gradeNet = null
let index = null
let meta = null
let coords = {}
let ready = false

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function yOfIdx(pIdx) {
  return coords[String(index.indexToId[pIdx])]?.[1] ?? 0
}

function feeds(rows, gradeNorm, angleNorm, quality) {
  const K = rows.length
  const L = Math.max(1, ...rows.map((r) => r.classes.length))
  const seq = new BigInt64Array(K * L)
  const mask = new Uint8Array(K * L)
  rows.forEach((r, k) => {
    r.classes.forEach((c, i) => {
      seq[k * L + i] = BigInt(c)
      mask[k * L + i] = 1
    })
  })
  return {
    seq: new ort.Tensor('int64', seq, [K, L]),
    mask: new ort.Tensor('bool', mask, [K, L]),
    grade: new ort.Tensor('float32', new Float32Array(K).fill(gradeNorm), [K, 1]),
    angle: new ort.Tensor('float32', new Float32Array(K).fill(angleNorm), [K, 1]),
    quality: new ort.Tensor('int64', new BigInt64Array(K).fill(BigInt(quality)), [K]),
  }
}

async function runAr(rows, gradeNorm, angleNorm, quality) {
  const out = await ar.run(feeds(rows, gradeNorm, angleNorm, quality))
  return out[ar.outputNames[0]].data // Float32Array K*V
}

function logSoftmax(src, off, V) {
  let max = -Infinity
  for (let i = 0; i < V; i++) if (src[off + i] > max) max = src[off + i]
  let sum = 0
  for (let i = 0; i < V; i++) sum += Math.exp(src[off + i] - max)
  const lse = max + Math.log(sum)
  const out = new Float32Array(V)
  for (let i = 0; i < V; i++) out[i] = src[off + i] - lse
  return out
}

function allowed(row, n) {
  const V = n * 4 + 1
  const allow = new Uint8Array(V)
  const len = row.classes.length
  if (len >= meta.maxLen) {
    allow[V - 1] = 1
    return allow
  }
  for (let p = 0; p < n; p++) {
    if (row.used.has(p)) continue
    for (let r = 0; r < 4; r++) {
      if (len === 0 && r !== START) continue
      if (r === START && row.nStart >= 2) continue
      if (r === FINISH && row.nFinish >= 2) continue
      allow[p * 4 + r] = 1
    }
  }
  if (len >= 6 && row.nStart >= 1 && row.nFinish >= 1) allow[V - 1] = 1
  return allow
}

/** temperature → min-p → top-p, then draw. Returns a class id. */
function sample(logits, allow, opts, rand) {
  const V = logits.length
  const T = Math.max(0.05, opts.temperature)
  let max = -Infinity
  for (let i = 0; i < V; i++) if (allow[i] && logits[i] > max) max = logits[i]
  if (max === -Infinity) return V - 1
  const items = []
  let sum = 0
  for (let i = 0; i < V; i++) {
    if (!allow[i]) continue
    const w = Math.exp((logits[i] - max) / T)
    items.push([i, w])
    sum += w
  }
  const pMax = 1 / sum // the top item has weight 1
  let kept = items.filter(([, w]) => w / sum >= opts.minP * pMax)
  kept.sort((a, b) => b[1] - a[1])
  const keptSum = kept.reduce((s, [, w]) => s + w, 0)
  let cum = 0
  const nucleus = []
  for (const it of kept) {
    if (cum >= opts.topP * keptSum) break
    nucleus.push(it)
    cum += it[1]
  }
  kept = nucleus.length ? nucleus : kept.slice(0, 1)
  let r = rand() * kept.reduce((s, [, w]) => s + w, 0)
  for (const [i, w] of kept) {
    r -= w
    if (r <= 0) return i
  }
  return kept[kept.length - 1][0]
}

async function predictGrades(rows, angleNorm) {
  if (!gradeNet) return null
  const f = feeds(rows, 0, angleNorm, 0)
  const out = await gradeNet.run({ seq: f.seq, mask: f.mask, angle: f.angle })
  return out[gradeNet.outputNames[0]].data
}

function structureOk(row) {
  const roles = row.classes.map((c) => c % 4)
  const s = row.classes.filter((c) => c % 4 === START).map((c) => yOfIdx(Math.floor(c / 4)))
  const f = row.classes.filter((c) => c % 4 === FINISH).map((c) => yOfIdx(Math.floor(c / 4)))
  if (roles.length < 6 || !s.length || !f.length || s.length > 2 || f.length > 2) return false
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  return mean(f) - mean(s) > 20
}

async function generate({ grade, angle, seed, temperature }) {
  const opts = { ...DEFAULTS, ...(meta.decode || {}) }
  if (typeof temperature === 'number') opts.temperature = temperature
  const rand = mulberry32(seed >>> 0)
  const g = Math.min(33, Math.max(10, Number.isFinite(grade) ? grade : 16))
  const gradeNorm = (g - 10) / 23
  const angleNorm = (Number.isFinite(angle) ? angle : 40) / 70
  const n = meta.nPlacements
  const V = n * 4 + 1
  const rows = Array.from({ length: opts.candidates }, () => ({
    classes: [],
    used: new Set(),
    nStart: 0,
    nFinish: 0,
    logp: 0,
    done: false,
  }))

  for (let step = 0; step <= meta.maxLen; step++) {
    const live = rows.filter((r) => !r.done)
    if (!live.length) break
    const logits = await runAr(live, gradeNorm, angleNorm, Q_GREAT)
    const uncond = opts.guidance ? await runAr(live, gradeNorm, angleNorm, Q_UNKNOWN) : null
    live.forEach((row, k) => {
      const lp = logSoftmax(logits, k * V, V)
      const mixed = new Float32Array(V)
      for (let i = 0; i < V; i++) {
        const l = logits[k * V + i]
        mixed[i] = uncond ? l + opts.guidance * (l - uncond[k * V + i]) : l
      }
      const c = sample(mixed, allowed(row, n), opts, rand)
      row.logp += lp[c]
      if (c === V - 1) {
        row.done = true
        return
      }
      const p = Math.floor(c / 4)
      const r = c % 4
      row.classes.push(c)
      row.used.add(p)
      if (r === START) row.nStart++
      if (r === FINISH) row.nFinish++
    })
  }

  const grades = await predictGrades(rows, angleNorm)
  let best = null
  let bestScore = -Infinity
  const anyOk = rows.some(structureOk)
  rows.forEach((row, k) => {
    if (anyOk && !structureOk(row)) return
    let score = opts.likWeight * (row.logp / (row.classes.length + 1))
    if (grades) score -= opts.gradeWeight * Math.abs(grades[k] - g)
    if (score > bestScore) {
      bestScore = score
      best = { row, predicted: grades ? grades[k] : null }
    }
  })
  const holds = new Map(
    best.row.classes.map((c) => [index.indexToId[Math.floor(c / 4)], ROLES[c % 4]]),
  )
  return { holds, predictedGrade: best.predicted }
}

async function loadAll() {
  if (typeof ort === 'undefined') throw new Error('onnxruntime-web failed to load (importScripts)')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  ort.env.wasm.wasmPaths = '/ai/ort/'

  const [indexRes, metaRes, modelsRes] = await Promise.all([
    fetch('/ai/boulder/placement_index.json'),
    fetch('/ai/boulder/hold-ar-v2.meta.json'),
    fetch('/ai/boulder/models.json'),
  ])
  if (!indexRes.ok || !metaRes.ok || !modelsRes.ok) throw new Error('Failed to load Hold AR files')
  index = await indexRes.json()
  meta = await metaRes.json()
  coords = (await modelsRes.json()).coords || {}

  const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
  ar = await ort.InferenceSession.create(`/ai/boulder/${meta.onnx}`, opt)
  try {
    gradeNet = await ort.InferenceSession.create(`/ai/boulder/${meta.gradeOnnx}`, opt)
  } catch {
    gradeNet = null // rerank by likelihood only
  }
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
            name: 'Hold AR v2 (local NN)',
            description: 'Quality-conditioned next-hold transformer · best of several candidates',
          },
        ],
        builtAt: meta?.createdAt,
        backend: 'hold-ar-v2-onnx',
      })
      return
    }
    if (msg.type === 'generate') {
      if (!ready) throw new Error('Hold AR not loaded')
      const seed = typeof msg.seed === 'number' ? msg.seed : (Math.random() * 1e9) | 0
      const { holds, predictedGrade } = await generate({ ...msg, seed })
      const values = [...holds.values()]
      self.postMessage({
        type: 'result',
        model: 'hold-ar',
        seed,
        holds: [...holds.entries()],
        meta: {
          holdCount: holds.size,
          starts: values.filter((r) => r === 12).length,
          finishes: values.filter((r) => r === 14).length,
          predictedGrade,
        },
      })
      return
    }
    self.postMessage({ type: 'error', error: `Unknown message: ${msg.type}` })
  } catch (e) {
    self.postMessage({ type: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}
