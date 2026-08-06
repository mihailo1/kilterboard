/** Client-safe constants (no node:sqlite). */

/**
 * Climb shape by Aurora frames:
 * - boulder = single frame (no `,"` deltas)
 * - route = multi-frame lead/circuit (`,"` + p/x deltas)
 * - both = no filter (default)
 */
export type ClimbKind = 'both' | 'boulders' | 'routes'

export const CLIMB_KIND_OPTIONS = [
  { value: 'both' as const, label: 'Both', hint: 'Boulders + routes' },
  { value: 'boulders' as const, label: 'Boulders', hint: 'Single frame' },
  { value: 'routes' as const, label: 'Routes', hint: 'Multi-frame' },
] as const

export function isClimbKind(v: string | null | undefined): v is ClimbKind {
  return v === 'both' || v === 'boulders' || v === 'routes'
}

export const BOARDS_ESH_SORT_OPTIONS = [
  { value: 'Popularity Desc', label: 'Popular' },
  { value: 'Newest', label: 'Newest' },
  { value: 'Grade Asc', label: 'Grade ↑' },
  { value: 'Grade Desc', label: 'Grade ↓' },
  { value: 'Quality Desc', label: 'Quality' },
  { value: 'Name A-Z', label: 'Name A–Z' },
  { value: 'Name Z-A', label: 'Name Z–A' },
  { value: 'Popularity Asc', label: 'Least climbed' },
] as const

export const ANGLE_OPTIONS = [
  -1, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70,
] as const

/** Quick-pick angles shown as chips */
export const ANGLE_CHIPS = [-1, 20, 30, 40, 45, 50, 60] as const

export const ASCENT_PRESETS = [
  { value: 0, label: 'Any' },
  { value: 1, label: '≥1' },
  { value: 5, label: '≥5' },
  { value: 20, label: '≥20' },
  { value: 100, label: '≥100' },
] as const

export const QUALITY_PRESETS = [
  { value: 0, label: 'Any' },
  { value: 2.5, label: '★★+ ' },
  { value: 3, label: '★★★' },
  { value: 3.5, label: '★★★+' },
  { value: 4, label: '★★★★' },
] as const
