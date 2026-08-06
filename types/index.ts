/** Role id used in Aurora frames (p{placement}r{role}) */
export type HoldRoleId = 12 | 13 | 14 | 15 | 20

export type HoldRole = 'start' | 'hand' | 'finish' | 'foot'

/** A single lit hold on the board (screen + BLE). */
export interface BoardHold {
  /** Placement id from Aurora frames */
  placementId: number
  /** LED position for BLE packets (leds table) */
  ledPosition: number
  roleId: HoldRoleId
  role: HoldRole
  /** CSS color for SVG (screen_color, with #) */
  color: string
  /** Hex without # for AuroraBoard.led() (led_color) */
  ledColor: string
  /** SVG coordinates */
  cx: number
  cy: number
  /** Circle radius scaled to board image */
  r: number
}

export interface Climb {
  id: string
  name: string
  grade: string
  angle: number
  /** Aurora frames string: p{placementId}r{roleId}... */
  frames: string
  setter?: string
  notes?: string
  source?: string
  /** Raw display_difficulty for coloring / filters */
  difficulty?: number | null
  ascents?: number | null
  quality?: number | null
  /** Holds on first frame (all roles). Boulders use this in the list. */
  holdCount?: number
  /** Multi-frame route: hand moves, feet excluded, adjacent overlap not re-counted. */
  moveCount?: number
  /** Number of Aurora frames (1 = boulder). */
  frameCount?: number
  publishedAt?: string | null
}

export type BluetoothStatus =
  | 'unsupported'
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'setting'
  | 'error'
