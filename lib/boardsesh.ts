/**
 * Query Boardsesh-derived local SQLite (12×12 kickboard subset).
 * Uses denormalized `search_rows` (angle × climb stats) for fast filters.
 * DB built by: node scripts/sync-boardsesh.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { analyzeClimbFrames } from '@/lib/aurora/board'
import { difficultyToGrade } from '@/lib/grades'
import type { Climb } from '@/types'

const SIZE_ID = 10
const DEFAULT_ANGLE = 40

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

function dbPath(): string {
  return path.join(process.cwd(), 'data', 'boardsesh', 'kilter-12x12.db')
}

export function boardseshDbExists(): boolean {
  return fs.existsSync(dbPath())
}

let cachedDb: DatabaseSync | null = null

function getDb(): DatabaseSync {
  const p = dbPath()
  if (!fs.existsSync(p)) {
    throw new Error('Boardsesh DB missing. Run: node scripts/sync-boardsesh.mjs')
  }
  if (!cachedDb) {
    cachedDb = new DatabaseSync(p, { readOnly: true })
    try {
      cachedDb.exec('PRAGMA query_only=ON')
    } catch {
      /* older sqlite */
    }
  }
  return cachedDb
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
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='search_rows'")
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

  // undefined or < 0 → all angles (one list row per climb×angle); else degrees
  const angleRaw = params.selectedAngle
  const allAngles =
    angleRaw == null || !Number.isFinite(angleRaw) || angleRaw < 0
  const angleUsed = allAngles ? -1 : angleRaw
  const limit = Math.min(Math.max(params.numResults ?? 25, 1), 100)
  const offset = Math.max(params.offset ?? 0, 0)
  const sort =
    SORT_SQL[params.selectedSort ?? 'Popularity Desc'] ?? SORT_SQL['Popularity Desc']
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
  // Multi-frame routes use Aurora delimiter `,"` between deltas
  const kind = params.climbKind ?? 'both'
  if (kind === 'boulders') {
    where.push(`(r.frames IS NULL OR instr(r.frames, ',"') = 0)`)
  } else if (kind === 'routes') {
    where.push(`instr(r.frames, ',"') > 0`)
  }
  if (hasGradeFilter || params.requireGrade) {
    where.push('r.difficulty IS NOT NULL')
  }

  const whereSql = where.length > 0 ? where.join(' AND ') : '1=1'

  const countRow = db
    .prepare(`SELECT COUNT(*) AS n FROM search_rows r WHERE ${whereSql}`)
    .get(filterBinds) as { n: number }

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
  }>

  const climbs: Climb[] = rows.map((r) => {
    const frames = r.frames ?? ''
    const stats = analyzeClimbFrames(frames)
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
      holdCount: stats.holdCount,
      moveCount: stats.isRoute ? stats.moveCount : undefined,
      frameCount: stats.frameCount > 0 ? stats.frameCount : undefined,
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
