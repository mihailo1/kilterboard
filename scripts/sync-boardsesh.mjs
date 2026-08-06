#!/usr/bin/env node
/**
 * Download latest Boardsesh Kilter layout snapshot and build a slim 12×12 DB.
 *
 * Usage:
 *   node scripts/sync-boardsesh.mjs
 *   node scripts/sync-boardsesh.mjs --keep-full   # keep full layout download
 *
 * Writes:
 *   data/boardsesh/manifest.json
 *   data/boardsesh/kilter-12x12.db      (~120MB slim search_rows + meta)
 *   data/boardsesh/kilter-12x12.db.gz   (~37MB — preferred for Vercel function tracing)
 *
 * Slim format (deploy-friendly):
 *   search_rows: uuid, name, setter, frames, dates, angle, difficulty, ascents,
 *                quality, hold_count, frame_count, is_route
 *   meta: snapshot provenance
 */

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'data', 'boardsesh')
const MANIFEST_URL =
  'https://boardsesh-board-snapshots.t3.tigrisfiles.io/board-snapshots/v1/manifest.json'

const BOARD_TYPE = 'kilter'
const LAYOUT_ID = 1
/** 12×12 with kickboard — matches board viewer / Kilter Lookup product_size_id_10 */
const SIZE_ID = 10
const KEEP_FULL = process.argv.includes('--keep-full')

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  console.log('Fetching manifest…')
  const manifest = await fetchJson(MANIFEST_URL)
  writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const entry = manifest.entries.find(
    (e) => e.boardType === BOARD_TYPE && e.layoutId === LAYOUT_ID,
  )
  if (!entry) {
    throw new Error(`No snapshot for ${BOARD_TYPE} layout ${LAYOUT_ID}`)
  }

  console.log(`Snapshot builtAt=${entry.builtAt}`)
  console.log(
    `  climbs=${entry.tables.board_climbs.rowCount}  bytes≈${(entry.bytes / 1e6).toFixed(1)}MB`,
  )
  writeFileSync(path.join(OUT_DIR, 'manifest-entry.json'), JSON.stringify(entry, null, 2))

  const fullPath = path.join(OUT_DIR, 'kilter-layout-1.db')
  const subsetPath = path.join(OUT_DIR, 'kilter-12x12.db')
  const gzPath = `${subsetPath}.gz`

  console.log('Downloading full layout DB…')
  await download(entry.url, fullPath)
  console.log('Building slim size-10 search DB…')
  buildSlimSubset(fullPath, subsetPath, entry)

  if (!KEEP_FULL) {
    unlinkSync(fullPath)
    console.log('Removed full DB (pass --keep-full to retain)')
  }

  console.log('Gzipping for deploy…')
  if (existsSync(gzPath)) unlinkSync(gzPath)
  await pipeline(createReadStream(subsetPath), createGzip({ level: 6 }), createWriteStream(gzPath))

  const dbMb = (statSync(subsetPath).size / 1e6).toFixed(1)
  const gzMb = (statSync(gzPath).size / 1e6).toFixed(1)
  console.log(`Done → ${subsetPath} (${dbMb}MB) + ${gzPath} (${gzMb}MB)`)
}

/**
 * One denormalized search table + meta. Drops climbs/climb_stats copies to cut size ~2×.
 */
function buildSlimSubset(fullPath, subsetPath, entry) {
  if (existsSync(subsetPath)) unlinkSync(subsetPath)

  const db = new DatabaseSync(fullPath)

  // Work in a temp attach so we can filter before writing the final slim file
  const tmpPath = `${subsetPath}.tmp.db`
  if (existsSync(tmpPath)) unlinkSync(tmpPath)

  db.exec(`ATTACH '${tmpPath.replaceAll("'", "''")}' AS out`)

  db.exec(`
    CREATE TABLE out.climbs AS
    SELECT
      c.uuid,
      c.name,
      c.setter_username AS setter,
      c.frames,
      c.created_at,
      c.published_at
    FROM board_climbs c, json_each(c.compatible_size_ids) j
    WHERE j.value = ${SIZE_ID}
      AND c.is_listed = 1
      AND c.is_draft = 0;

    CREATE TABLE out.climb_stats AS
    SELECT
      s.climb_uuid,
      s.angle,
      s.display_difficulty,
      s.ascensionist_count,
      s.quality_average
    FROM board_climb_stats s
    WHERE s.board_type = '${BOARD_TYPE}'
      AND s.climb_uuid IN (SELECT uuid FROM out.climbs);
  `)

  const subsetCount = db.prepare('SELECT COUNT(*) AS n FROM out.climbs').get().n
  const watermark =
    entry.tables?.board_climbs?.watermarkUpdatedAt ??
    db.prepare(
      "SELECT watermark_updated_at FROM snapshot_meta WHERE table_name='board_climbs'",
    ).get()?.watermark_updated_at ??
    null

  db.exec('DETACH out')
  db.close()

  // Build final slim DB with precomputed route/hold stats
  const mid = new DatabaseSync(tmpPath)
  const out = new DatabaseSync(subsetPath)

  out.exec(`
    CREATE TABLE search_rows (
      uuid TEXT NOT NULL,
      name TEXT,
      setter TEXT,
      frames TEXT,
      published_at TEXT,
      created_at TEXT,
      angle INTEGER,
      difficulty REAL,
      ascents INTEGER,
      quality REAL,
      hold_count INTEGER,
      frame_count INTEGER,
      is_route INTEGER
    );
    CREATE TABLE meta (
      source TEXT,
      board_type TEXT,
      layout_id INTEGER,
      size_id INTEGER,
      built_at TEXT,
      watermark_updated_at TEXT,
      full_row_count INTEGER,
      subset_row_count INTEGER
    );
  `)

  out
    .prepare(
      `INSERT INTO meta
       (source, board_type, layout_id, size_id, built_at, watermark_updated_at, full_row_count, subset_row_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'boardsesh',
      BOARD_TYPE,
      LAYOUT_ID,
      SIZE_ID,
      entry.builtAt,
      watermark,
      entry.tables.board_climbs.rowCount,
      subsetCount,
    )

  const insert = out.prepare(
    `INSERT INTO search_rows
     (uuid, name, setter, frames, published_at, created_at, angle, difficulty, ascents, quality, hold_count, frame_count, is_route)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const rows = mid
    .prepare(
      `SELECT
         c.uuid, c.name, c.setter, c.frames, c.published_at, c.created_at,
         s.angle,
         s.display_difficulty AS difficulty,
         s.ascensionist_count AS ascents,
         s.quality_average AS quality
       FROM climbs c
       INNER JOIN climb_stats s ON s.climb_uuid = c.uuid`,
    )
    .iterate()

  out.exec('BEGIN')
  let searchCount = 0
  for (const r of rows) {
    const frames = r.frames ?? ''
    const isRoute = frames.includes(',"') ? 1 : 0
    const holdCount = (frames.match(/p\d+r\d+/g) || []).length
    const frameCount = isRoute ? frames.split(',"').length : 1
    insert.run(
      r.uuid,
      r.name,
      r.setter,
      frames,
      r.published_at,
      r.created_at,
      r.angle,
      r.difficulty,
      r.ascents,
      r.quality,
      holdCount,
      frameCount,
      isRoute,
    )
    searchCount++
  }
  out.exec('COMMIT')

  out.exec(`
    CREATE INDEX idx_sr_angle_pop ON search_rows(angle, ascents DESC);
    CREATE INDEX idx_sr_angle_diff ON search_rows(angle, difficulty);
    CREATE INDEX idx_sr_angle_quality ON search_rows(angle, quality DESC);
    CREATE INDEX idx_sr_name ON search_rows(name);
    CREATE INDEX idx_sr_setter ON search_rows(setter);
    CREATE INDEX idx_sr_published ON search_rows(published_at DESC);
    CREATE INDEX idx_sr_route ON search_rows(is_route);
  `)
  out.exec('VACUUM')
  out.close()
  mid.close()

  unlinkSync(tmpPath)
  console.log(`  subset climbs=${subsetCount}, search_rows=${searchCount}`)
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`)
  const file = createWriteStream(dest)
  await pipeline(Readable.fromWeb(res.body), file)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
