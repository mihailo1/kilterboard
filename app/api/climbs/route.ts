import { NextRequest, NextResponse } from 'next/server'
import {
  boardseshDbExists,
  ensureBoardseshDb,
  getBoardseshMeta,
  searchClimbs,
  type ClimbKindFilter,
} from '@/lib/boardsesh'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** Cold start may gunzip ~120MB DB into /tmp */
export const maxDuration = 60

function num(sp: URLSearchParams, key: string): number | undefined {
  const raw = sp.get(key)
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export async function GET(request: NextRequest) {
  try {
    await ensureBoardseshDb()
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Boardsesh database not found. Run: npm run sync:climbs'
    return NextResponse.json(
      {
        error: message,
        meta: null,
        hint: boardseshDbExists()
          ? 'DB path found but failed to open — check logs'
          : 'DB not in deploy bundle. Vercel build must run ensure-boardsesh-db.mjs',
      },
      { status: 503 },
    )
  }

  const sp = request.nextUrl.searchParams
  const angleRaw = sp.get('angle')
  /** Default: all angles. `all` / `-1` / omit → every angle; else degrees */
  let selectedAngle = -1
  if (angleRaw === 'all' || angleRaw === '-1' || angleRaw == null || angleRaw === '') {
    selectedAngle = -1
  } else {
    const n = Number(angleRaw)
    selectedAngle = Number.isFinite(n) ? n : -1
  }

  const kindRaw = (sp.get('kind') ?? sp.get('climbKind') ?? 'both').toLowerCase()
  const climbKind: ClimbKindFilter =
    kindRaw === 'boulders' || kindRaw === 'boulder'
      ? 'boulders'
      : kindRaw === 'routes' || kindRaw === 'route'
        ? 'routes'
        : 'both'

  try {
    const result = searchClimbs({
      name: sp.get('name') ?? '',
      setter: sp.get('setter') ?? '',
      selectedAngle,
      selectedSort: sp.get('sort') ?? 'Popularity Desc',
      numResults: Math.min(Math.max(Number(sp.get('numResults') ?? '25'), 1), 100),
      offset: Math.max(Number(sp.get('offset') ?? '0'), 0),
      minAscents: Math.max(num(sp, 'minAscents') ?? 0, 0),
      minDifficulty: num(sp, 'minDifficulty'),
      maxDifficulty: num(sp, 'maxDifficulty'),
      minQuality: num(sp, 'minQuality'),
      climbKind,
    })

    return NextResponse.json({
      results_count: result.results_count,
      climbs: result.climbs,
      meta: result.meta ?? getBoardseshMeta(),
      angleUsed: result.angleUsed,
      source: 'boardsesh',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to query climbs'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
