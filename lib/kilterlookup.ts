import type { Climb, HoldRoleId } from '@/types'

/** Kilter Lookup product size: 12×12 Original with kickboard */
export const PRODUCT_SIZE = 'product_size_id_10'
export const KILTERLOOKUP_BASE = 'https://www.kilterlookup.com'

/**
 * Kilter Lookup hold type → Aurora role id
 * 1 start, 2 hand, 3 foot, 4 finish
 */
const LOOKUP_ROLE_TO_AURORA: Record<number, HoldRoleId> = {
  1: 12, // start → green
  2: 13, // hand → cyan
  3: 15, // foot → yellow
  4: 14, // finish → magenta
}

export type AngleKey =
  | '00'
  | '05'
  | '10'
  | '15'
  | '20'
  | '25'
  | '30'
  | '35'
  | '40'
  | '45'
  | '50'
  | '55'
  | '60'
  | '65'
  | '70'

export interface KilterLookupClimb {
  uuid: string
  name: string
  setter: string
  campus: string
  holds: Record<string, number>
  '00'?: string
  '05'?: string
  '10'?: string
  '15'?: string
  '20'?: string
  '25'?: string
  '30'?: string
  '35'?: string
  '40'?: string
  '45'?: string
  '50'?: string
  '55'?: string
  '60'?: string
  '65'?: string
  '70'?: string
}

export interface KilterLookupResponse {
  results_count: number
  climbs: KilterLookupClimb[]
}

export interface SearchParams {
  name?: string
  setter?: string
  showCampusOnly?: boolean
  removeOtherLayouts?: boolean
  numResults?: number
  /** -1 or undefined = all angles */
  selectedAngle?: number
  selectedSort?: string
  lowGrade?: string
  highGrade?: string
}

export const SORT_OPTIONS = [
  'Popularity Desc',
  'Popularity Asc',
  'Grade Desc',
  'Grade Asc',
  'Name Z-A',
  'Name A-Z',
] as const

export const ANGLE_OPTIONS = [
  -1, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70,
] as const

/** Convert Kilter Lookup holds map → Aurora frames string */
export function holdsDictToFrames(holds: Record<string, number>): string {
  return Object.entries(holds)
    .map(([placementId, role]) => {
      const aurora = LOOKUP_ROLE_TO_AURORA[role]
      if (!aurora) return ''
      return `p${placementId}r${aurora}`
    })
    .filter(Boolean)
    .join('')
}

function angleKey(angle: number): AngleKey {
  return String(angle).padStart(2, '0') as AngleKey
}

/** Grade string for a climb at the selected angle (defaults to 40°) */
export function gradeAtAngle(climb: KilterLookupClimb, angle: number): string {
  const key = angle < 0 ? '40' : angleKey(angle)
  return climb[key] || climb['40'] || climb['50'] || '—'
}

export function lookupClimbToClimb(
  climb: KilterLookupClimb,
  selectedAngle: number = -1,
): Climb {
  const angle = selectedAngle < 0 ? 40 : selectedAngle
  return {
    id: climb.uuid.toLowerCase(),
    name: climb.name,
    grade: gradeAtAngle(climb, selectedAngle),
    angle,
    frames: holdsDictToFrames(climb.holds),
    setter: climb.setter,
    notes: climb.campus === 'true' ? 'Campus' : undefined,
    source: 'kilterlookup.com',
  }
}

export function buildFindUrl(params: SearchParams): string {
  const qs = new URLSearchParams()
  qs.set('name', params.name ?? '')
  qs.set('setter', params.setter ?? '')
  qs.set('showCampusOnly', String(params.showCampusOnly ?? false))
  qs.set('removeOtherLayouts', String(params.removeOtherLayouts ?? false))
  qs.set('numResults', String(params.numResults ?? 25))
  qs.set('selectedAngle', String(params.selectedAngle ?? -1))
  qs.set('selectedSort', params.selectedSort ?? 'Popularity Desc')
  qs.set('productSize', PRODUCT_SIZE)
  if (params.lowGrade) qs.set('lowGrade', params.lowGrade)
  if (params.highGrade) qs.set('highGrade', params.highGrade)
  return `${KILTERLOOKUP_BASE}/find?${qs.toString()}`
}

export async function fetchClimbs(params: SearchParams = {}): Promise<KilterLookupResponse> {
  const url = buildFindUrl(params)
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'kilterboard-app/0.1',
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Kilter Lookup error ${res.status}`)
  }
  return (await res.json()) as KilterLookupResponse
}
