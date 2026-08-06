#!/usr/bin/env node
/**
 * Download latest Boardsesh Kilter layout snapshot and build a 12×12 (size 10) subset DB.
 *
 * Usage:
 *   node scripts/sync-boardsesh.mjs
 *
 * Writes:
 *   data/boardsesh/manifest.json
 *   data/boardsesh/kilter-layout-1.db   (full layout, ~260MB — optional keep)
 *   data/boardsesh/kilter-12x12.db      (filtered for product_size_id=10)
 */

import { createWriteStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
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
/** 12×12 with kickboard — matches our board viewer / Kilter Lookup product_size_id_10 */
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

  console.log('Downloading full layout DB…')
  await download(entry.url, fullPath)
  console.log('Building size-10 subset…')
  buildSubset(fullPath, subsetPath, entry)

  if (!KEEP_FULL) {
    unlinkSync(fullPath)
    console.log('Removed full DB (pass --keep-full to retain)')
  }

  console.log(`Done → ${subsetPath}`)
}

function buildSubset(fullPath, subsetPath, entry) {
  if (existsSync(subsetPath)) unlinkSync(subsetPath)

  const db = new DatabaseSync(fullPath)
  db.exec(`ATTACH '${subsetPath.replaceAll("'", "''")}' AS out`)

  db.exec(`
    CREATE TABLE out.climbs AS
    SELECT
      c.uuid,
      c.name,
      c.setter_username AS setter,
      c.frames,
      c.is_listed,
      c.is_draft,
      c.created_at,
      c.published_at,
      c.compatible_size_ids,
      c.angle AS default_angle,
      c.hsm,
      c.required_set_ids
    FROM board_climbs c, json_each(c.compatible_size_ids) j
    WHERE j.value = ${SIZE_ID}
      AND c.is_listed = 1
      AND c.is_draft = 0;

    CREATE TABLE out.climb_stats AS
    SELECT
      s.climb_uuid,
      s.angle,
      s.display_difficulty,
      s.benchmark_difficulty,
      s.ascensionist_count,
      s.quality_average,
      s.fa_username
    FROM board_climb_stats s
    WHERE s.board_type = '${BOARD_TYPE}'
      AND s.climb_uuid IN (SELECT uuid FROM out.climbs);

    CREATE TABLE out.meta (
      source TEXT,
      board_type TEXT,
      layout_id INTEGER,
      size_id INTEGER,
      built_at TEXT,
      watermark_updated_at TEXT,
      full_row_count INTEGER,
      subset_row_count INTEGER
    );

    CREATE INDEX out.idx_climbs_name ON climbs(name);
    CREATE INDEX out.idx_climbs_setter ON climbs(setter);
    CREATE INDEX out.idx_climbs_published ON climbs(published_at);
    CREATE INDEX out.idx_stats_uuid ON climb_stats(climb_uuid);
    CREATE INDEX out.idx_stats_angle_pop ON climb_stats(angle, ascensionist_count DESC);
    CREATE INDEX out.idx_stats_angle_grade ON climb_stats(angle, display_difficulty);
  `)

  const subsetCount = db.prepare('SELECT COUNT(*) AS n FROM out.climbs').get().n
  const watermark =
    entry.tables?.board_climbs?.watermarkUpdatedAt ??
    db.prepare(
      "SELECT watermark_updated_at FROM snapshot_meta WHERE table_name='board_climbs'",
    ).get()?.watermark_updated_at ??
    null

  db.prepare(
    `INSERT INTO out.meta
     (source, board_type, layout_id, size_id, built_at, watermark_updated_at, full_row_count, subset_row_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'boardsesh',
    BOARD_TYPE,
    LAYOUT_ID,
    SIZE_ID,
    entry.builtAt,
    watermark,
    entry.tables.board_climbs.rowCount,
    subsetCount,
  )

  db.exec('DETACH out')
  db.close()

  // Denormalized search table (angle × climb) — keeps list filters fast
  const out = new DatabaseSync(subsetPath)
  out.exec(`
    DROP TABLE IF EXISTS search_rows;
    CREATE TABLE search_rows AS
    SELECT
      c.uuid,
      c.name,
      c.setter,
      c.frames,
      c.published_at,
      c.created_at,
      s.angle,
      s.display_difficulty AS difficulty,
      s.ascensionist_count AS ascents,
      s.quality_average AS quality
    FROM climbs c
    INNER JOIN climb_stats s ON s.climb_uuid = c.uuid;

    CREATE INDEX idx_sr_angle_pop ON search_rows(angle, ascents DESC);
    CREATE INDEX idx_sr_angle_diff ON search_rows(angle, difficulty);
    CREATE INDEX idx_sr_angle_quality ON search_rows(angle, quality DESC);
    CREATE INDEX idx_sr_name ON search_rows(name);
    CREATE INDEX idx_sr_setter ON search_rows(setter);
    CREATE INDEX idx_sr_published ON search_rows(published_at DESC);
  `)
  const searchCount = out.prepare('SELECT COUNT(*) AS n FROM search_rows').get().n
  out.exec('VACUUM')
  out.close()

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
