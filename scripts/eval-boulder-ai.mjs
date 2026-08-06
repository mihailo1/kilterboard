/**
 * Compare local boulder generators to real Boardsesh boulders.
 * Usage: node scripts/eval-boulder-ai.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pack = JSON.parse(
  fs.readFileSync(path.join(root, 'public/ai/boulder/models.json'), 'utf8'),
)
const coords = pack.coords
const valid = new Set(pack.validPlacements)
const workerSrc = fs.readFileSync(
  path.join(root, 'public/ai/boulder/boulder-worker.js'),
  'utf8',
)

const results = []
const context = {
  console,
  Math,
  fetch: async () => ({ ok: true, json: async () => pack }),
  self: {
    onmessage: null,
    postMessage(msg) {
      results.push(msg)
    },
  },
}
vm.createContext(context)
vm.runInContext(workerSrc, context)
const onmessage = context.self.onmessage

async function gen(model, seed, grade) {
  results.length = 0
  await onmessage({ data: { type: 'load' } })
  results.length = 0
  await onmessage({ data: { type: 'generate', model, seed, grade } })
  const r = results.find((x) => x.type === 'result')
  if (!r) throw new Error(JSON.stringify(results))
  return new Map(r.holds)
}

function analyze(holds) {
  const roles = { 12: 0, 13: 0, 14: 0, 15: 0 }
  for (const [, r] of holds) roles[r]++
  const ids = [...holds.keys()]
  const pts = ids.map((id) => coords[String(id)]).filter(Boolean)
  const ys = pts.map((p) => p[1])
  const xs = pts.map((p) => p[0])
  const spanY = pts.length ? Math.max(...ys) - Math.min(...ys) : 0
  const spanX = pts.length ? Math.max(...xs) - Math.min(...xs) : 0
  let meanNN = 0
  if (pts.length) {
    let s = 0
    for (let i = 0; i < pts.length; i++) {
      let best = Infinity
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue
        const d = Math.hypot(
          pts[i][0] - pts[j][0],
          pts[i][1] - pts[j][1],
        )
        if (d < best) best = d
      }
      if (best < Infinity) s += best
    }
    meanNN = s / pts.length
  }
  const starts = [...holds.entries()].filter(([, r]) => r === 12)
  const fins = [...holds.entries()].filter(([, r]) => r === 14)
  const startY = starts.length
    ? starts.reduce((a, [id]) => a + (coords[String(id)]?.[1] ?? 0), 0) /
      starts.length
    : null
  const finishY = fins.length
    ? fins.reduce((a, [id]) => a + (coords[String(id)]?.[1] ?? 0), 0) /
      fins.length
    : null
  return {
    n: holds.size,
    starts: roles[12],
    hands: roles[13],
    finishes: roles[14],
    feet: roles[15],
    spanY,
    spanX,
    meanNN,
    startY,
    finishY,
    okStarts: roles[12] >= 1 && roles[12] <= 2,
    okFinish: roles[14] >= 1 && roles[14] <= 2,
    flow: startY != null && finishY != null ? finishY > startY + 20 : null,
  }
}

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
}
function pct(a, p) {
  return a.length ? (100 * a.filter(p).length) / a.length : 0
}
function summarize(list) {
  return {
    n: +mean(list.map((x) => x.n)).toFixed(1),
    starts: +mean(list.map((x) => x.starts)).toFixed(2),
    hands: +mean(list.map((x) => x.hands)).toFixed(1),
    finishes: +mean(list.map((x) => x.finishes)).toFixed(2),
    feet: +mean(list.map((x) => x.feet)).toFixed(1),
    spanY: +mean(list.map((x) => x.spanY)).toFixed(1),
    spanX: +mean(list.map((x) => x.spanX)).toFixed(1),
    meanNN: +mean(list.map((x) => x.meanNN)).toFixed(2),
    startY: +mean(list.map((x) => x.startY).filter((v) => v != null)).toFixed(1),
    finishY: +mean(
      list.map((x) => x.finishY).filter((v) => v != null),
    ).toFixed(1),
    pctOkStarts: pct(list, (x) => x.okStarts).toFixed(1) + '%',
    pctOkFinish: pct(list, (x) => x.okFinish).toFixed(1) + '%',
    pctFlow:
      pct(
        list.filter((x) => x.flow != null),
        (x) => x.flow,
      ).toFixed(1) + '%',
  }
}

const db = new DatabaseSync(path.join(root, 'data/boardsesh/kilter-12x12.db'), {
  readOnly: true,
})
const realRows = db
  .prepare(
    `SELECT frames FROM search_rows
     WHERE angle=40 AND instr(frames, ',"')=0 AND difficulty BETWEEN 10 AND 28
     ORDER BY RANDOM() LIMIT 4000`,
  )
  .all()

function parseFrames(frames) {
  const m = new Map()
  const re = /p(\d+)r(\d+)/g
  let match
  while ((match = re.exec(frames))) {
    const id = Number(match[1])
    if (!valid.has(id)) continue
    let role = Number(match[2])
    for (const b of [12, 20, 24, 28, 32, 36, 42, 46, 50]) {
      if (role >= b && role < b + 4) {
        role = 12 + (role - b)
        break
      }
    }
    if (![12, 13, 14, 15].includes(role)) role = 13
    m.set(id, role)
  }
  return m
}

const real = []
for (const row of realRows) {
  const h = parseFrames(row.frames)
  if (h.size >= 4) real.push(analyze(h))
}
const r = summarize(real)
console.log('REAL', r)

const N = 400
const grades = [12, 16, 18, 22]
let all = true
for (const modelId of ['freq', 'cooccur', 'spatial', 'remix']) {
  const list = []
  for (let i = 0; i < N; i++) {
    list.push(
      analyze(
        await gen(
          modelId,
          (i + 1) * 7919 + modelId.charCodeAt(0) * 99,
          grades[i % 4],
        ),
      ),
    )
  }
  const s = summarize(list)
  const ok =
    parseFloat(s.pctFlow) >= 97 &&
    s.pctOkStarts === '100.0%' &&
    s.pctOkFinish === '100.0%' &&
    Math.abs(s.n - r.n) < 2.2 &&
    Math.abs(s.spanY - r.spanY) < 22 &&
    s.startY < s.finishY - 55 &&
    s.finishY > 125
  all = all && ok
  console.log(modelId, s)
  console.log(
    '  PASS',
    ok,
    `| Δn ${(s.n - r.n).toFixed(1)} ΔspanY ${(s.spanY - r.spanY).toFixed(1)}`,
  )
}
console.log(all ? '\nALL PASS' : '\nSOME FAILED')
process.exit(all ? 0 : 1)
