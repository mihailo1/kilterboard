#!/usr/bin/env node
/**
 * Ensure climb DB is present and not older than the latest Boardsesh snapshot.
 *
 * Behaviour:
 * - Always runs stale-aware `sync-boardsesh.mjs` (no-op when already current).
 * - Local offline: if network fails but a local .db/.gz exists → warn and continue.
 * - Vercel/CI: network failure is fatal (no catalog to ship).
 * - FORCE_BOARDSESH_SYNC=1 → pass --force to rebuild even if current.
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
const hasLocal = existsSync(DB) || existsSync(GZ)

const args = [path.join(__dirname, 'sync-boardsesh.mjs')]
if (force) args.push('--force')

console.log(
  `[ensure-boardsesh] ${force ? 'FORCE rebuild' : 'stale-aware sync'}` +
    ` (${onVercel ? 'CI/Vercel' : 'local'}` +
    `${hasLocal ? ', local db present' : ', no local db'})`,
)

const r = spawnSync(process.execPath, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
})

const code = r.status ?? 1

if (code === 0) {
  process.exit(0)
}

// Network / Boardsesh outage: keep last known catalog when offline-friendly
if (!onVercel && !force && hasLocal) {
  console.warn(
    '[ensure-boardsesh] Sync failed but local DB/gz exists — continuing with cached catalog.\n' +
      `  exit=${code}  Fix: npm run sync:climbs   (or FORCE_BOARDSESH_SYNC=1)`,
  )
  process.exit(0)
}

if (!onVercel && !force && !hasLocal) {
  console.warn(
    '[ensure-boardsesh] No climb DB and sync failed.\n' +
      '  Run: npm run sync:climbs\n' +
      '  (Local `next build` can proceed offline; /api/climbs will 503 until DB exists.)',
  )
  process.exit(0)
}

console.error('[ensure-boardsesh] Failed to ensure Boardsesh DB (required on Vercel/CI).')
process.exit(code || 1)
