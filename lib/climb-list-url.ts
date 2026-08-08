/**
 * Preserve Climbs list filters across detail navigation.
 *
 * List state lives in `/?name=…&sort=…` (see ClimbList).
 * Opening a climb stores that query as `from` on the climb URL and in sessionStorage
 * so “All climbs” can restore filters.
 */

export const CLIMB_LIST_QS_KEY = 'kb:climb-list-qs'

/** True if `from` is a safe relative query string (no open redirect). */
export function isSafeListQuery(from: string | null | undefined): boolean {
  if (from == null || from === '') return false
  if (from.includes('://') || from.startsWith('//')) return false
  if (from.startsWith('/') || from.startsWith('?')) return false
  if (from.includes('\n') || from.includes('\r')) return false
  return true
}

/** `from` query value → href for the climbs list. */
export function listHrefFromQuery(from: string | null | undefined): string {
  if (!isSafeListQuery(from)) return '/'
  return `/?${from}`
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
