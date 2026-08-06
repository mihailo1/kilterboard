import { NextRequest, NextResponse } from 'next/server'
import { ensureBoardseshDb, searchSetters } from '@/lib/boardsesh'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** GET /api/setters?q=miha — autocomplete climb authors from local Boardsesh DB */
export async function GET(request: NextRequest) {
  try {
    await ensureBoardseshDb()
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Boardsesh database not found'
    return NextResponse.json(
      { error: message, setters: [] },
      { status: 503 },
    )
  }

  const q = request.nextUrl.searchParams.get('q') ?? ''
  const limit = Math.min(
    Math.max(Number(request.nextUrl.searchParams.get('limit') ?? '12'), 1),
    30,
  )

  try {
    const setters = searchSetters(q, limit)
    return NextResponse.json({ setters, source: 'boardsesh-local' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to search setters'
    return NextResponse.json({ error: message, setters: [] }, { status: 500 })
  }
}
