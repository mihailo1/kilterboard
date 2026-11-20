import { NextRequest, NextResponse } from 'next/server'
import { ensureBoardseshDb, newClimbsSince } from '@/lib/boardsesh'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/climbs/new?since=<ISO>&limit=5
 * → { latest, count, climbs } — climbs published after `since`.
 * Without `since` only `latest` is returned (first visit: remember silently).
 */
export async function GET(request: NextRequest) {
  try {
    await ensureBoardseshDb()
    const sp = request.nextUrl.searchParams
    const raw = sp.get('since')
    const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null
    const limit = Number(sp.get('limit') ?? '5')
    return NextResponse.json(newClimbsSince(since, Number.isFinite(limit) ? limit : 5))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to check new climbs'
    return NextResponse.json({ error: message }, { status: 503 })
  }
}
