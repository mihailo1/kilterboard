import { getPlacementRoles } from '@/lib/aurora/board'
import type { HoldRole, HoldRoleId } from '@/types'

/** Screen colors from Kilter placement_roles (hangtime BoardLib). */
export const ROLE_COLORS: Record<HoldRoleId, string> = {
  12: '00DD00', // start (screen)
  13: '00FFFF', // middle
  14: 'FF00FF', // finish
  15: 'FFA500', // foot
  20: '00DD00',
}

export const ROLE_LABELS: Record<HoldRoleId, HoldRole> = {
  12: 'start',
  13: 'hand',
  14: 'finish',
  15: 'foot',
  20: 'start',
}

export const ROLE_DISPLAY: Record<HoldRole, { label: string; hex: string }> = {
  start: { label: 'Start', hex: '#00DD00' },
  hand: { label: 'Hand', hex: '#00FFFF' },
  finish: { label: 'Finish', hex: '#FF00FF' },
  foot: { label: 'Foot', hex: '#FFA500' },
}

export function isHoldRoleId(value: number): value is HoldRoleId {
  return value === 12 || value === 13 || value === 14 || value === 15 || value === 20
}

export function hexToCss(hex: string): string {
  return hex.startsWith('#') ? hex : `#${hex}`
}

export function roleLegend() {
  return getPlacementRoles().map((r) => ({
    key: r.name,
    label: r.fullName,
    hex: r.screenColor,
  }))
}
