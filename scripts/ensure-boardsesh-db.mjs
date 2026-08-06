#!/usr/bin/env node
/**
 * Ensure climb DB exists before `next build` (Vercel / CI).
 *
 * - Local: if data/boardsesh/kilter-12x12.db (or .db.gz) already present → skip
 * - Vercel / FORCE_BOARDSESH_SYNC=1: always rebuild when missing
 *
 * Run: node scripts/ensure-boardsesh-db.mjs
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DB = path.join(ROOT, 'data', 'boardsesh', 'kilter-12x12.db')
const GZ = `${DB}.gz`

const onVercel = process.env.VERCEL === '1' || process.env.CI === 'true'
const force = process.env.FORCE_BOARDSESH_SYNC === '1'

if (!force && (existsSync(DB) || existsSync(GZ))) {
  console.log(
    `[ensure-boardsesh] OK — ${existsSync(DB) ? 'kilter-12x12.db' : 'kilter-12x12.db.gz'} present`,
  )
  process.exit(0)
}

if (!onVercel && !force && !existsSync(DB) && !existsSync(GZ)) {
  console.warn(
    '[ensure-boardsesh] No climb DB. Run: npm run sync:climbs\n' +
      '  (Skipping auto-download outside Vercel/CI so local builds stay offline-friendly.)',
  )
  process.exit(0)
}

console.log('[ensure-boardsesh] Building Boardsesh slim DB (download + subset)…')
const r = spawnSync(process.execPath, [path.join(__dirname, 'sync-boardsesh.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
})
process.exit(r.status ?? 1)
