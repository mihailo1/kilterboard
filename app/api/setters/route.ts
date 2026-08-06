import { NextRequest, NextResponse } from 'next/server'
import { boardseshDbExists, searchSetters } from '@/lib/boardsesh'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/setters?q=miha — autocomplete climb authors from local Boardsesh DB */
export async function GET(request: NextRequest) {
  if (!boardseshDbExists()) {
    return NextResponse.json(
      { error: 'Boardsesh database not found', setters: [] },
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
