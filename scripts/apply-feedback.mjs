#!/usr/bin/env node
/**
 * Aggregate /playground feedback exports → human report + weight patch.
 *
 * Does NOT retrain models.json or rewrite genRemix. You review the report
 * and patch, then edit rules by hand (or a future consumer of the patch).
 *
 * Usage:
 *   node scripts/apply-feedback.mjs [paths...]
 *   npm run apply-feedback -- data/feedback/export.json
 *
 * Flags:
 *   --models <path>         default public/ai/boulder/models.json
 *   --out <path>            default data/feedback/patch.json
 *   --report <path>         default data/feedback/report.txt
 *   --min-n <n>             min verdicts before trusting ratio (default 5)
 *   --down-threshold <0-1>  reject rate ≥ → downweight (default 0.6)
 *   --up-threshold <0-1>    approve rate ≥ → boost (default 0.7)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const KNOWN_TAGS = [
  'reach',
  'feet',
  'left-right',
  'line',
  'grade',
  'hold-quality',
  'mutation-too-strong',
  'too-hard',
]

const TAG_HINTS = {
  reach:
    'Consider tighter handReach.max / reach hard-cut in genRemix mutation scoring.',
  feet: 'Review foot-under-hand dy/dx rules and auto-add-feet logic.',
  'left-right': 'Review inferred L/R side weights and alternate-side assumption.',
  line: 'Structural polish may pass but climb lacks shape — template quality / mutation rate.',
  grade: 'Template pick weight vs target grade; hold-count band vs difficulty.',
  'hold-quality': 'holdQuality boost / prefer better placements in candidate score.',
  'mutation-too-strong':
    'Check strongMutation usage in labels; soft mut rate or strong mut defaults.',
  'too-hard':
    'Feels harder than selected grade — prefer easier templates / more holds / softer mutation near target grade.',
}

function parseArgs(argv) {
  const opts = {
    models: path.join(root, 'public/ai/boulder/models.json'),
    out: path.join(root, 'data/feedback/patch.json'),
    report: path.join(root, 'data/feedback/report.txt'),
    minN: 5,
    downThreshold: 0.6,
    upThreshold: 0.7,
    paths: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--models') opts.models = path.resolve(argv[++i])
    else if (a === '--out') opts.out = path.resolve(argv[++i])
    else if (a === '--report') opts.report = path.resolve(argv[++i])
    else if (a === '--min-n') opts.minN = Number(argv[++i])
    else if (a === '--down-threshold') opts.downThreshold = Number(argv[++i])
    else if (a === '--up-threshold') opts.upThreshold = Number(argv[++i])
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a.startsWith('-')) {
      console.error(`Unknown flag: ${a}`)
      process.exit(1)
    } else opts.paths.push(path.resolve(a))
  }
  return opts
}

/** Same fingerprint as boulder-worker.js templateFingerprint */
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

function pairKey(a, b) {
  const x = Number(a)
  const y = Number(b)
  return x < y ? `${x}-${y}` : `${y}-${x}`
}

function loadEntriesFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const data = JSON.parse(raw)
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.entries)) return data.entries
  throw new Error(`${filePath}: expected { entries: [] } or array`)
}

function collectFiles(paths) {
  if (!paths.length) {
    const dir = path.join(root, 'data/feedback')
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && f !== 'patch.json')
      .map((f) => path.join(dir, f))
  }
  const out = []
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      console.warn(`skip missing: ${p}`)
      continue
    }
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        if (f.endsWith('.json') && f !== 'patch.json') out.push(path.join(p, f))
      }
    } else out.push(p)
  }
  return out
}

function incCounter(map, key, field) {
  if (!key) return
  let row = map.get(key)
  if (!row) {
    row = { approve: 0, reject: 0, tags: Object.create(null) }
    map.set(key, row)
  }
  row[field]++
}

function noteTag(map, key, tag) {
  if (!key || !tag) return
  const row = map.get(key)
  if (!row) return
  row.tags[tag] = (row.tags[tag] || 0) + 1
}

function rates(row) {
  const n = row.approve + row.reject
  const rejectRate = n ? row.reject / n : 0
  const approveRate = n ? row.approve / n : 0
  return { n, rejectRate, approveRate }
}

function weightFromRates(row, { minN, downThreshold, upThreshold }) {
  const { n, rejectRate, approveRate } = rates(row)
  if (n < minN) return null
  if (rejectRate >= downThreshold) {
    // tiered downweight
    const w =
      rejectRate >= 0.85 ? 0.25 : rejectRate >= 0.7 ? 0.4 : 0.55
    return { action: 'down', weight: w, n, rejectRate, approveRate }
  }
  if (approveRate >= upThreshold && row.reject === 0) {
    return { action: 'up', weight: 1.5, n, rejectRate, approveRate }
  }
  if (approveRate >= upThreshold) {
    return { action: 'up', weight: 1.25, n, rejectRate, approveRate }
  }
  return { action: 'keep', weight: 1, n, rejectRate, approveRate }
}

function topEntries(map, scoreFn, limit = 5) {
  return [...map.entries()]
    .map(([k, v]) => [k, v, scoreFn(v)])
    .filter(([, , s]) => s > 0)
    .sort((a, b) => b[2] - a[2])
    .slice(0, limit)
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(`Usage: node scripts/apply-feedback.mjs [export.json ...] [flags]
  --min-n 5  --down-threshold 0.6  --up-threshold 0.7
  --out data/feedback/patch.json  --report data/feedback/report.txt`)
    process.exit(0)
  }

  const files = collectFiles(opts.paths)
  if (!files.length) {
    console.error(
      'No feedback JSON found. Export from /playground or pass paths.\n' +
        'Example: npm run apply-feedback -- ./ai-feedback-export.json',
    )
    process.exit(1)
  }

  /** @type {any[]} */
  const entries = []
  for (const f of files) {
    try {
      const list = loadEntriesFromFile(f)
      for (const e of list) entries.push({ ...e, _source: f })
    } catch (err) {
      console.error(String(err.message || err))
      process.exit(1)
    }
  }

  let approve = 0
  let reject = 0
  const byTag = Object.create(null)
  for (const t of KNOWN_TAGS) byTag[t] = { reject: 0, approve: 0 }
  const byTemplate = new Map()
  const byPair = new Map()
  const byPlacement = new Map()
  /** tag -> Map<templateId, rejectCount> */
  const tagTemplates = Object.create(null)
  /** tag -> Map<pairKey, rejectCount> */
  const tagPairs = Object.create(null)
  for (const t of KNOWN_TAGS) {
    tagTemplates[t] = new Map()
    tagPairs[t] = new Map()
  }

  let withTemplateId = 0
  let strongMutReject = 0
  let holdFlagEvents = 0
  /** placementId → { bad, byRole } from explicit holdFlags taps (legacy) */
  const byHoldFlag = new Map()
  /** from originalHolds → holds diffs */
  const removedByEdit = new Map() // placement → count
  const addedByEdit = new Map()
  let editedEntries = 0
  /** too-hard: target grade → list of actual grades */
  const tooHardDeltas = []
  let tooHardCount = 0

  for (const e of entries) {
    const verdict = e.verdict === 'approve' ? 'approve' : 'reject'
    if (verdict === 'approve') approve++
    else reject++

    const tags = Array.isArray(e.tags)
      ? e.tags.filter((t) => KNOWN_TAGS.includes(t))
      : []

    if (verdict === 'reject' && e.strongMutation) strongMutReject++

    let templateId = e.templateId
    if (!templateId && Array.isArray(e.holds) && e.holds.length) {
      // approx: fingerprint of final holds (mutated) — marked later
      const d = e.templateGrade ?? e.grade ?? 16
      templateId = `approx:${templateFingerprint(d, e.holds)}`
    } else if (templateId) {
      withTemplateId++
    }

    if (templateId) {
      incCounter(byTemplate, templateId, verdict)
      for (const tag of tags) {
        if (verdict === 'reject') {
          const m = tagTemplates[tag]
          m.set(templateId, (m.get(templateId) || 0) + 1)
        }
        noteTag(byTemplate, templateId, tag)
      }
    }

    const holds = Array.isArray(e.holds) ? e.holds : []
    for (const [id] of holds) {
      incCounter(byPlacement, String(id), verdict)
    }
    for (let i = 0; i < holds.length; i++) {
      for (let j = i + 1; j < holds.length; j++) {
        const pk = pairKey(holds[i][0], holds[j][0])
        incCounter(byPair, pk, verdict)
        for (const tag of tags) {
          if (verdict === 'reject') {
            const m = tagPairs[tag]
            m.set(pk, (m.get(pk) || 0) + 1)
          }
        }
      }
    }

    // Board edits: originalHolds (AI) vs holds (user correction)
    if (e.edited && Array.isArray(e.originalHolds) && Array.isArray(e.holds)) {
      editedEntries++
      const orig = new Map(e.originalHolds.map(([id, r]) => [String(id), r]))
      const fin = new Map(e.holds.map(([id, r]) => [String(id), r]))
      for (const [id, role] of orig) {
        if (!fin.has(id)) {
          removedByEdit.set(id, (removedByEdit.get(id) || 0) + 1)
          incCounter(byPlacement, id, 'reject')
        } else if (fin.get(id) !== role) {
          // role changed away from this placement's old role
          removedByEdit.set(id, (removedByEdit.get(id) || 0) + 0.5)
        }
      }
      for (const [id] of fin) {
        if (!orig.has(id)) {
          addedByEdit.set(id, (addedByEdit.get(id) || 0) + 1)
          incCounter(byPlacement, id, 'approve')
        }
      }
    }

    // Legacy tap-to-flag bad holds
    if (Array.isArray(e.holdFlags)) {
      for (const hf of e.holdFlags) {
        if (!hf || hf.flag !== 'bad') continue
        const id = String(hf.placementId)
        if (!id || id === 'NaN') continue
        holdFlagEvents++
        let row = byHoldFlag.get(id)
        if (!row) {
          row = { bad: 0, byRole: Object.create(null) }
          byHoldFlag.set(id, row)
        }
        row.bad++
        const role = String(hf.roleId ?? '?')
        row.byRole[role] = (row.byRole[role] || 0) + 1
        incCounter(byPlacement, id, 'reject')
      }
    }

    for (const tag of tags) {
      if (!byTag[tag]) byTag[tag] = { reject: 0, approve: 0 }
      byTag[tag][verdict]++
    }

    if (
      tags.includes('too-hard') &&
      Number.isFinite(e.grade) &&
      Number.isFinite(e.actualGrade)
    ) {
      tooHardCount++
      tooHardDeltas.push({
        target: e.grade,
        actual: e.actualGrade,
        delta: e.actualGrade - e.grade,
        templateId: e.templateId,
      })
    }
  }

  // Build patch weights
  const templateWeights = {}
  const pairWeights = {}
  const placementWeights = {}
  const templateDecisions = []
  const pairDecisions = []

  for (const [id, row] of byTemplate) {
    const dec = weightFromRates(row, opts)
    if (!dec || dec.action === 'keep') continue
    if (dec.action === 'down' || dec.action === 'up') {
      templateWeights[id] = dec.weight
      templateDecisions.push({ id, ...dec, ...row })
    }
  }
  for (const [id, row] of byPair) {
    const dec = weightFromRates(row, opts)
    if (!dec || dec.action === 'keep') continue
    if (dec.action === 'down' || dec.action === 'up') {
      pairWeights[id] = dec.weight
      pairDecisions.push({ id, ...dec, ...row })
    }
  }
  for (const [id, row] of byPlacement) {
    const dec = weightFromRates(row, opts)
    if (!dec || dec.action === 'keep') continue
    if (dec.action === 'down' || dec.action === 'up') {
      placementWeights[id] = dec.weight
    }
  }

  templateDecisions.sort((a, b) => b.rejectRate - a.rejectRate)
  pairDecisions.sort((a, b) => b.rejectRate - a.rejectRate)

  // Optional: load models only for count (do not dump)
  let modelsInfo = 'not loaded'
  if (fs.existsSync(opts.models)) {
    try {
      const pack = JSON.parse(fs.readFileSync(opts.models, 'utf8'))
      const nTpl = pack?.models?.remix?.templates?.length ?? 0
      modelsInfo = `climbCount=${pack.climbCount ?? '?'} remixTemplates=${nTpl} builtAt=${pack.builtAt ?? '?'}`
    } catch {
      modelsInfo = 'failed to parse models.json'
    }
  } else {
    modelsInfo = 'models.json missing'
  }

  const lines = []
  const push = (s = '') => lines.push(s)

  push('=== Feedback apply report ===')
  push(`Generated: ${new Date().toISOString()}`)
  push(`Sources: ${files.length} file(s)`)
  for (const f of files) push(`  - ${path.relative(root, f)}`)
  push(
    `Entries: ${entries.length} (approve ${approve} · reject ${reject})`,
  )
  push(
    `With templateId: ${withTemplateId} · approx fingerprints for rest when needed`,
  )
  push(
    `Board edits: ${editedEntries} · legacy holdFlags: ${holdFlagEvents} events`,
  )
  push(
    `Params: min-n=${opts.minN} down≥${opts.downThreshold} up≥${opts.upThreshold}`,
  )
  push(`Models: ${modelsInfo}`)
  push()

  push('--- Board edits (AI original → user holds) ---')
  if (!editedEntries) {
    push('(none yet — edit holds on /playground after gen, then save)')
  } else {
    const topRm = [...removedByEdit.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
    const topAdd = [...addedByEdit.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
    if (topRm.length) {
      push('Removed / demoted (prefer downweight):')
      for (const [id, c] of topRm) push(`  placement ${id}: ${c}`)
    }
    if (topAdd.length) {
      push('Added by user (prefer boost):')
      for (const [id, c] of topAdd) push(`  placement ${id}: ${c}`)
    }
    for (const [id, c] of removedByEdit) {
      if (c >= 2) placementWeights[id] = Math.min(placementWeights[id] ?? 1, 0.25)
      else if (c >= 1)
        placementWeights[id] = Math.min(placementWeights[id] ?? 1, 0.5)
    }
    for (const [id, c] of addedByEdit) {
      if (c >= 2) placementWeights[id] = Math.max(placementWeights[id] ?? 1, 1.4)
      else if (c >= 1)
        placementWeights[id] = Math.max(placementWeights[id] ?? 1, 1.2)
    }
  }
  push()

  if (byHoldFlag.size) {
    push('--- Legacy holdFlags (tap bad) ---')
    const topBad = [...byHoldFlag.entries()]
      .sort((a, b) => b[1].bad - a[1].bad)
      .slice(0, 15)
    for (const [id, row] of topBad) {
      push(`  placement ${id}: ${row.bad} bad`)
    }
    for (const [id, row] of byHoldFlag) {
      if (row.bad >= 2) {
        placementWeights[id] = Math.min(placementWeights[id] ?? 1, 0.25)
      } else if (row.bad >= 1) {
        placementWeights[id] = Math.min(placementWeights[id] ?? 1, 0.5)
      }
    }
    push()
  }

  push('--- Too hard → actual grade ---')
  if (!tooHardCount) {
    push('(none — tag too-hard + set actual grade in playground)')
  } else {
    const avg =
      tooHardDeltas.reduce((s, d) => s + d.delta, 0) / tooHardDeltas.length
    push(
      `${tooHardCount} labels · mean actual−target = +${avg.toFixed(2)} difficulty`,
    )
    // by target band
    const byTarget = new Map()
    for (const d of tooHardDeltas) {
      if (!byTarget.has(d.target)) byTarget.set(d.target, [])
      byTarget.get(d.target).push(d.actual)
    }
    const bands = [...byTarget.entries()].sort((a, b) => a[0] - b[0])
    for (const [t, acts] of bands.slice(0, 12)) {
      const mean = acts.reduce((s, x) => s + x, 0) / acts.length
      push(
        `  target ${t} → actual avg ${mean.toFixed(1)} (n=${acts.length}, +${(mean - t).toFixed(1)})`,
      )
    }
    push(
      '  hint: gen tends to feel harder than selected grade — softer mutation / easier templates near target.',
    )
  }
  push()

  push('--- By tag (on reject unless noted) ---')
  const tagSorted = [...KNOWN_TAGS].sort(
    (a, b) => (byTag[b]?.reject || 0) - (byTag[a]?.reject || 0),
  )
  for (const tag of tagSorted) {
    const tr = byTag[tag]?.reject || 0
    const ta = byTag[tag]?.approve || 0
    if (tr === 0 && ta === 0) {
      push(`${tag}: 0`)
      continue
    }
    push(`${tag}: ${tr} reject` + (ta ? ` · ${ta} approve-tagged` : ''))
    const tops = [...(tagTemplates[tag] || new Map()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
    if (tops.length) {
      push(
        `  top templates: ${tops.map(([id, c]) => `${id} (${c}r)`).join(', ')}`,
      )
    }
    const topP = [...(tagPairs[tag] || new Map()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
    if (topP.length) {
      push(
        `  top pairs: ${topP.map(([id, c]) => `${id} (${c}r)`).join(', ')}`,
      )
    }
    if (TAG_HINTS[tag] && tr > 0) push(`  hint: ${TAG_HINTS[tag]}`)
  }
  push()

  if (strongMutReject > 0) {
    push(
      `Note: ${strongMutReject} rejects had strongMutation=true (see mutation-too-strong tag).`,
    )
    push()
  }

  push(`--- Templates (n≥${opts.minN}, action ≠ keep) ---`)
  if (!templateDecisions.length) {
    push('(none — need more labels with templateId, or rates within band)')
  } else {
    for (const d of templateDecisions.slice(0, 40)) {
      push(
        `${d.id}  n=${d.n}  rejectRate=${d.rejectRate.toFixed(2)}  → ${d.action.toUpperCase()} ${d.weight}` +
          (d.reject ? `  (${d.reject}r/${d.approve}a)` : ''),
      )
    }
    if (templateDecisions.length > 40) {
      push(`… +${templateDecisions.length - 40} more in patch`)
    }
  }
  push()

  push(`--- Pairs (n≥${opts.minN}, action ≠ keep) ---`)
  if (!pairDecisions.length) {
    push('(none)')
  } else {
    for (const d of pairDecisions.slice(0, 30)) {
      push(
        `${d.id}  n=${d.n}  rejectRate=${d.rejectRate.toFixed(2)}  → ${d.action.toUpperCase()} ${d.weight}`,
      )
    }
    if (pairDecisions.length > 30) {
      push(`… +${pairDecisions.length - 30} more in patch`)
    }
  }
  push()

  push('--- Manual rule hints (summary) ---')
  const hotTags = tagSorted.filter((t) => (byTag[t]?.reject || 0) >= 3)
  if (!hotTags.length) {
    push('Not enough tagged rejects yet for strong rule hints.')
  } else {
    for (const tag of hotTags.slice(0, 5)) {
      push(`• ${tag} (${byTag[tag].reject}r): ${TAG_HINTS[tag] || ''}`)
    }
  }
  push()
  push(
    'Patch does NOT auto-retrain. Review → edit train-boulder-ai / genRemix rules by hand.',
  )
  push(
    'Future: worker can multiply template/pair weights from patch (not wired yet).',
  )

  const reportText = lines.join('\n') + '\n'
  fs.mkdirSync(path.dirname(opts.report), { recursive: true })
  fs.writeFileSync(opts.report, reportText, 'utf8')

  const patch = {
    version: 1,
    createdAt: new Date().toISOString(),
    source: {
      files: files.map((f) => path.relative(root, f)),
      entryCount: entries.length,
      approve,
      reject,
      minN: opts.minN,
      downThreshold: opts.downThreshold,
      upThreshold: opts.upThreshold,
    },
    remix: {
      templateWeights,
      pairWeights,
      placementWeights,
    },
    notes:
      'Weights multiply default 1.0 when a future consumer applies them. <1 down, >1 boost. Not applied by genRemix yet.',
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true })
  fs.writeFileSync(opts.out, JSON.stringify(patch, null, 2) + '\n', 'utf8')

  // stdout: full report (user asked for readable report; keep reasonable)
  console.log(reportText)
  console.log(`Wrote patch:  ${path.relative(root, opts.out)}`)
  console.log(`Wrote report: ${path.relative(root, opts.report)}`)
  console.log(
    `Summary: ${entries.length} entries → ${Object.keys(templateWeights).length} template weights, ${Object.keys(pairWeights).length} pair weights, ${Object.keys(placementWeights).length} placement weights`,
  )
}

main()
