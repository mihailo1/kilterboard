/**
 * Query Boardsesh-derived local SQLite (12×12 kickboard subset).
 * Uses denormalized `search_rows` (angle × climb stats) for fast filters.
 * DB built by: node scripts/sync-boardsesh.mjs
 *
 * On Vercel the DB is not in git. Build ships `kilter-12x12.db.gz`; we gunzip
 * into `/tmp` on first request (or open a local `.db` in dev).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { analyzeClimbFrames } from '@/lib/aurora/board'
import { difficultyToGrade } from '@/lib/grades'
import type { Climb } from '@/types'

const SIZE_ID = 10
const DEFAULT_ANGLE = 40
const DB_NAME = 'kilter-12x12.db'

export interface BoardseshMeta {
  source: string
  board_type: string
  layout_id: number
  size_id: number
  built_at: string | null
  watermark_updated_at: string | null
  full_row_count: number | null
  subset_row_count: number | null
}

/** boulder = single-frame; route = multi-frame (`,"` deltas); both = no filter. */
export type ClimbKindFilter = 'both' | 'boulders' | 'routes'

export interface SearchParams {
  name?: string
  setter?: string
  /** Degrees, or < 0 for all angles (one list row per climb×angle). */
  selectedAngle?: number
  selectedSort?: string
  numResults?: number
  offset?: number
  minAscents?: number
  minDifficulty?: number
  maxDifficulty?: number
  minQuality?: number
  requireGrade?: boolean
  /**
   * Boulders = one frame; routes = multi-frame lead/circuit
   * (frames contain Aurora delimiter `,"`). Default both.
   */
  climbKind?: ClimbKindFilter
  /**
   * Placement IDs that must all appear in frames as `p{id}r…` (AND).
   * Used by hold search; typically with climbKind=boulders.
   */
  requiredPlacements?: number[]
}

export interface SearchResult {
  results_count: number
  climbs: Climb[]
  meta: BoardseshMeta | null
  angleUsed: number
}

const SORT_SQL: Record<string, string> = {
  'Popularity Desc': 'r.ascents DESC NULLS LAST, r.quality DESC NULLS LAST, r.name ASC',
  'Popularity Asc': 'r.ascents ASC NULLS LAST, r.name ASC',
  'Grade Desc': 'r.difficulty DESC NULLS LAST, r.ascents DESC NULLS LAST',
  'Grade Asc': 'r.difficulty ASC NULLS LAST, r.name ASC',
  'Quality Desc': 'r.quality DESC NULLS LAST, r.ascents DESC NULLS LAST',
  'Name A-Z': 'r.name COLLATE NOCASE ASC',
  'Name Z-A': 'r.name COLLATE NOCASE DESC',
  Newest: 'r.published_at DESC NULLS LAST, r.created_at DESC',
}

function localDbPath(): string {
  return path.join(process.cwd(), 'data', 'boardsesh', DB_NAME)
}

function localGzPath(): string {
  return `${localDbPath()}.gz`
}

function tmpDbPath(): string {
  return path.join(os.tmpdir(), DB_NAME)
}

/** True if a usable DB file is already on disk (local, /tmp, or gz in cwd). */
export function boardseshDbExists(): boolean {
  return (
    fs.existsSync(localDbPath()) ||
    fs.existsSync(tmpDbPath()) ||
    fs.existsSync(localGzPath())
  )
}

let cachedDb: DatabaseSync | null = null
let cachedPath: string | null = null
let ensurePromise: Promise<string> | null = null
let hasExtraCols: boolean | null = null

function openDb(dbFile: string): DatabaseSync {
  if (cachedDb && cachedPath === dbFile) return cachedDb
  if (cachedDb) {
    try {
      cachedDb.close()
    } catch {
      /* ignore */
    }
    cachedDb = null
  }
  const db = new DatabaseSync(dbFile, { readOnly: true })
  try {
    db.exec('PRAGMA query_only=ON')
  } catch {
    /* older sqlite */
  }
  cachedDb = db
  cachedPath = dbFile
  hasExtraCols = null
  return db
}

/**
 * Resolve a readable SQLite path: local db → /tmp db → gunzip cwd .gz → /tmp.
 * Optional BOARDSESH_DB_URL (http(s) to .db or .db.gz) as last resort.
 */
export async function ensureBoardseshDb(): Promise<string> {
  if (ensurePromise) return ensurePromise
  ensurePromise = (async () => {
    const local = localDbPath()
    if (fs.existsSync(local)) return local

    const tmp = tmpDbPath()
    if (fs.existsSync(tmp)) return tmp

    const gz = localGzPath()
    if (fs.existsSync(gz)) {
      const raw = fs.readFileSync(gz)
      fs.writeFileSync(tmp, gunzipSync(raw))
      return tmp
    }

    const url = process.env.BOARDSESH_DB_URL?.trim()
    if (url) {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`BOARDSESH_DB_URL fetch failed: HTTP ${res.status}`)
      }
      const buf = Buffer.from(await res.arrayBuffer())
      const isGz =
        url.endsWith('.gz') ||
        (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b)
      fs.writeFileSync(tmp, isGz ? gunzipSync(buf) : buf)
      return tmp
    }

    throw new Error(
      'Boardsesh DB missing. Locally: npm run sync:climbs. ' +
        'On Vercel: ensure build runs scripts/ensure-boardsesh-db.mjs (see package.json).',
    )
  })().catch((err) => {
    ensurePromise = null
    throw err
  })

  return ensurePromise
}

function getDb(): DatabaseSync {
  const local = localDbPath()
  if (fs.existsSync(local)) return openDb(local)
  const tmp = tmpDbPath()
  if (fs.existsSync(tmp)) return openDb(tmp)
  throw new Error(
    'Boardsesh DB not ready. Call ensureBoardseshDb() first (API routes do this).',
  )
}

function searchRowsHasExtras(db: DatabaseSync): boolean {
  if (hasExtraCols != null) return hasExtraCols
  try {
    const cols = db.prepare('PRAGMA table_info(search_rows)').all() as Array<{
      name: string
    }>
    const names = new Set(cols.map((c) => c.name))
    hasExtraCols =
      names.has('hold_count') && names.has('frame_count') && names.has('is_route')
  } catch {
    hasExtraCols = false
  }
  return hasExtraCols
}

export function getBoardseshMeta(): BoardseshMeta | null {
  try {
    const row = getDb().prepare('SELECT * FROM meta LIMIT 1').get() as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    return {
      source: String(row.source ?? 'boardsesh'),
      board_type: String(row.board_type ?? 'kilter'),
      layout_id: Number(row.layout_id ?? 1),
      size_id: Number(row.size_id ?? SIZE_ID),
      built_at: (row.built_at as string) ?? null,
      watermark_updated_at: (row.watermark_updated_at as string) ?? null,
      full_row_count:
        (row.full_row_count as number) ?? (row.row_count as number) ?? null,
      subset_row_count:
        (row.subset_row_count as number) ?? (row.row_count as number) ?? null,
    }
  } catch {
    return null
  }
}

function hasSearchRows(db: DatabaseSync): boolean {
  try {
    const row = db
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='search_rows'",
      )
      .get() as { ok?: number } | undefined
    return !!row
  } catch {
    return false
  }
}

export function searchClimbs(params: SearchParams = {}): SearchResult {
  const db = getDb()
  if (!hasSearchRows(db)) {
    throw new Error(
      'search_rows missing — re-run: node scripts/sync-boardsesh.mjs',
    )
  }

  const extras = searchRowsHasExtras(db)

  // undefined or < 0 → all angles (one list row per climb×angle); else degrees
  const angleRaw = params.selectedAngle
  const allAngles =
    angleRaw == null || !Number.isFinite(angleRaw) || angleRaw < 0
  const angleUsed = allAngles ? -1 : angleRaw
  const limit = Math.min(Math.max(params.numResults ?? 25, 1), 100)
  const offset = Math.max(params.offset ?? 0, 0)
  const sort =
    SORT_SQL[params.selectedSort ?? 'Popularity Desc'] ??
    SORT_SQL['Popularity Desc']
  const minAscents = Math.max(params.minAscents ?? 0, 0)
  const minDifficulty = params.minDifficulty
  const maxDifficulty = params.maxDifficulty
  const minQuality = params.minQuality
  const hasGradeFilter =
    minDifficulty != null ||
    maxDifficulty != null ||
    (minQuality != null && minQuality > 0) ||
    minAscents > 0

  const where: string[] = []
  const filterBinds: Record<string, string | number> = {}

  if (!allAngles) {
    where.push('r.angle = @angle')
    filterBinds.angle = angleUsed
  }

  if (params.name?.trim()) {
    where.push('r.name LIKE @name')
    filterBinds.name = `%${params.name.trim()}%`
  }
  if (params.setter?.trim()) {
    where.push('r.setter LIKE @setter')
    filterBinds.setter = `%${params.setter.trim()}%`
  }
  if (minAscents > 0) {
    where.push('r.ascents >= @minAscents')
    filterBinds.minAscents = minAscents
  }
  if (minDifficulty != null && Number.isFinite(minDifficulty)) {
    where.push('r.difficulty >= @minDifficulty')
    filterBinds.minDifficulty = minDifficulty
  }
  if (maxDifficulty != null && Number.isFinite(maxDifficulty)) {
    where.push('r.difficulty <= @maxDifficulty')
    filterBinds.maxDifficulty = maxDifficulty
  }
  if (minQuality != null && minQuality > 0) {
    where.push('r.quality >= @minQuality')
    filterBinds.minQuality = minQuality
  }

  const kind = params.climbKind ?? 'both'
  if (kind === 'boulders') {
    where.push(
      extras
        ? 'COALESCE(r.is_route, 0) = 0'
        : `(r.frames IS NULL OR instr(r.frames, ',"') = 0)`,
    )
  } else if (kind === 'routes') {
    where.push(
      extras ? 'r.is_route = 1' : `instr(r.frames, ',"') > 0`,
    )
  }

  // Hold search: every selected placement must appear (role-agnostic `p{id}r`)
  const placements = (params.requiredPlacements ?? [])
    .map((n) => Math.floor(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0)
  const uniquePlacements = [...new Set(placements)].slice(0, 40)
  for (let i = 0; i < uniquePlacements.length; i++) {
    const id = uniquePlacements[i]!
    const key = `hold${i}`
    // frames tokens look like p1234r13 — match placement only
    where.push(`instr(r.frames, @${key}) > 0`)
    filterBinds[key] = `p${id}r`
  }

  if (hasGradeFilter || params.requireGrade) {
    where.push('r.difficulty IS NOT NULL')
  }

  const whereSql = where.length > 0 ? where.join(' AND ') : '1=1'

  const countRow = db
    .prepare(`SELECT COUNT(*) AS n FROM search_rows r WHERE ${whereSql}`)
    .get(filterBinds) as { n: number }

  const selectExtras = extras
    ? ', r.hold_count, r.frame_count, r.is_route'
    : ''

  const rows = db
    .prepare(
      `SELECT
         r.uuid,
         r.name,
         r.setter,
         r.frames,
         r.published_at,
         r.created_at,
         r.angle,
         r.difficulty,
         r.ascents,
         r.quality
         ${selectExtras}
       FROM search_rows r
       WHERE ${whereSql}
       ORDER BY ${sort}
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...filterBinds, limit, offset }) as Array<{
    uuid: string
    name: string
    setter: string | null
    frames: string
    published_at: string | null
    created_at: string | null
    angle: number
    difficulty: number | null
    ascents: number | null
    quality: number | null
    hold_count?: number | null
    frame_count?: number | null
    is_route?: number | null
  }>

  const climbs: Climb[] = rows.map((r) => {
    const frames = r.frames ?? ''
    let holdCount = r.hold_count ?? undefined
    let frameCount = r.frame_count ?? undefined
    let isRoute =
      r.is_route != null ? r.is_route === 1 : frames.includes(',"')

    if (holdCount == null || frameCount == null) {
      const stats = analyzeClimbFrames(frames)
      holdCount = stats.holdCount
      frameCount = stats.frameCount
      isRoute = stats.isRoute
    }

    return {
      id: r.uuid.toLowerCase(),
      name: r.name,
      grade: difficultyToGrade(r.difficulty),
      angle: Number(r.angle),
      frames,
      setter: r.setter ?? undefined,
      difficulty: r.difficulty,
      ascents: r.ascents,
      quality: r.quality,
      holdCount: holdCount ?? undefined,
      moveCount: isRoute ? holdCount : undefined,
      frameCount: frameCount != null && frameCount > 0 ? frameCount : undefined,
      publishedAt: r.published_at,
      source: 'boardsesh',
    }
  })

  return {
    results_count: countRow.n,
    climbs,
    meta: getBoardseshMeta(),
    angleUsed,
  }
}

/**
 * Autocomplete setters (authors) from local Boardsesh DB.
 * Boardsesh itself has no public live search API — only CDN SQLite snapshots.
 */
export function searchSetters(query: string, limit = 12): string[] {
  const q = query.trim()
  if (q.length < 1) return []
  const db = getDb()
  if (!hasSearchRows(db)) return []

  const cap = Math.min(Math.max(limit, 1), 30)
  const rows = db
    .prepare(
      `SELECT DISTINCT r.setter AS setter
       FROM search_rows r
       WHERE r.setter IS NOT NULL
         AND r.setter != ''
         AND r.setter LIKE @q ESCAPE '\\'
       ORDER BY r.setter COLLATE NOCASE ASC
       LIMIT @limit`,
    )
    .all({
      q: `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`,
      limit: cap,
    }) as Array<{ setter: string }>

  return rows.map((r) => r.setter).filter(Boolean)
}

export { SIZE_ID, DEFAULT_ANGLE }
