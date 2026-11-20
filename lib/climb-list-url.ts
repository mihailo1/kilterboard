/**
 * Preserve Climbs list filters across detail navigation.
 *
 * List state lives in `/?name=…&sort=…` (see ClimbList).
 * Opening a climb stores that query as `from` on the climb URL and in sessionStorage
 * so “All climbs” can restore filters.
 */

import type { Climb } from '@/types'

export const CLIMB_LIST_QS_KEY = 'kb:climb-list-qs'

/** True if `from` is a safe relative query string (no open redirect). */
export function isSafeListQuery(from: string | null | undefined): boolean {
  if (from == null || from === '') return false
  if (from.includes('://') || from.startsWith('//')) return false
  if (from.startsWith('/') || from.startsWith('?')) return false
  if (from.includes('\n') || from.includes('\r')) return false
  return true
}

/** `from` query value → href for the climbs list or hold search. */
export function listHrefFromQuery(from: string | null | undefined): string {
  if (!isSafeListQuery(from)) return '/'
  const qs = from as string
  try {
    const params = new URLSearchParams(qs)
    if (params.get('view') === 'holds') {
      params.delete('view')
      const q = params.toString()
      return q ? `/holds?${q}` : '/holds'
    }
  } catch {
    /* fall through */
  }
  return `/?${qs}`
}

/** Label for back link from climb detail. */
export function listBackLabel(from: string | null | undefined): string {
  if (from == null || from === '') return 'All climbs'
  try {
    if (new URLSearchParams(from).get('view') === 'holds') return 'Hold search'
  } catch {
    /* ignore */
  }
  return 'All climbs'
}

export function readStoredListQuery(): string {
  if (typeof window === 'undefined') return ''
  try {
    return sessionStorage.getItem(CLIMB_LIST_QS_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeStoredListQuery(qs: string): void {
  if (typeof window === 'undefined') return
  try {
    if (qs) sessionStorage.setItem(CLIMB_LIST_QS_KEY, qs)
    else sessionStorage.removeItem(CLIMB_LIST_QS_KEY)
  } catch {
    /* private mode */
  }
}

/**
 * Climb detail URL. Pass `listQs` (current `/?…` filters) so “All climbs”
 * can restore search/filters via the `from` param.
 */
export function buildClimbHref(climb: Climb, listQs = ''): string {
  const qs = new URLSearchParams({
    name: climb.name,
    grade: climb.grade,
    angle: String(climb.angle),
    frames: climb.frames,
  })
  if (climb.setter) qs.set('setter', climb.setter)
  if (climb.ascents != null)
    qs.set('notes', `${climb.ascents.toLocaleString()} ascents`)
  if (listQs) qs.set('from', listQs)
  return `/climb/${climb.id}?${qs.toString()}`
}
