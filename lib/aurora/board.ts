/**
 * Kilter 12×12 kickboard layout resolution.
 * Ported from hangtime-grip-connect examples/aurora (BoardLib tables).
 *
 * Route frames `p{placementId}r{roleId}` resolve as:
 *   placement_id → hole_id → leds.position  (BLE)
 *   hole (x,y) + product_size edges → SVG cx/cy  (screen)
 *   role_id → placement_roles.led_color / screen_color
 */

import holesRaw from '@/data/kilter/holes.json'
import ledsRaw from '@/data/kilter/leds.json'
import layoutsRaw from '@/data/kilter/layouts.json'
import placementRolesRaw from '@/data/kilter/placement_roles.json'
import placementsRaw from '@/data/kilter/placements.json'
import productSizesRaw from '@/data/kilter/product_sizes.json'
import productSizesLayoutsSetsRaw from '@/data/kilter/product_sizes_layouts_sets.json'
import setsRaw from '@/data/kilter/sets.json'
import type { AuroraLedPlacement } from '@hangtime/grip-connect'
import type { BoardHold, Climb, HoldRole, HoldRoleId } from '@/types'

export const KILTER_LAYOUT_ID = 1
export const KILTER_SIZE_ID = 10
export const KILTER_SET_IDS = [1, 20] as const

interface HoleRow {
  id: number
  product_id: number
  name: string
  x: number
  y: number
  mirrored_hole_id: number | null
}

interface PlacementRow {
  id: number
  layout_id: number
  hole_id: number
  set_id: number
}

interface LedRow {
  id: number
  product_size_id: number
  hole_id: number
  position: number
}

interface PlacementRoleRow {
  id: number
  product_id: number
  position: number
  name: string
  full_name: string
  led_color: string
  screen_color: string
}

interface ProductSizeRow {
  id: number
  product_id: number
  edge_left: number
  edge_right: number
  edge_bottom: number
  edge_top: number
  name: string
  description: string
}

interface ProductSizeLayoutSetRow {
  id: number
  product_size_id: number
  layout_id: number
  set_id: number
  image_filename: string
}

interface SetRow {
  id: number
  name: string
}

const holes = holesRaw as HoleRow[]
const placements = placementsRaw as PlacementRow[]
const leds = ledsRaw as LedRow[]
const roles = placementRolesRaw as PlacementRoleRow[]
const productSizes = productSizesRaw as ProductSizeRow[]
const psls = productSizesLayoutsSetsRaw as ProductSizeLayoutSetRow[]
const sets = setsRaw as SetRow[]
const layouts = layoutsRaw as { id: number; name: string }[]

const size = productSizes.find((s) => s.id === KILTER_SIZE_ID)!
const holeById = new Map(holes.map((h) => [h.id, h]))
const placementById = new Map(placements.map((p) => [p.id, p]))
const roleById = new Map(roles.map((r) => [r.id, r]))

/** placement_id → LED position for size 10 */
const ledPositionByPlacementId = new Map<number, number>()
for (const led of leds) {
  if (led.product_size_id !== KILTER_SIZE_ID) continue
  for (const p of placements) {
    if (p.hole_id === led.hole_id) {
      ledPositionByPlacementId.set(p.id, led.position)
    }
  }
}

const ROLE_NAME_MAP: Record<string, HoldRole> = {
  start: 'start',
  middle: 'hand',
  finish: 'finish',
  foot: 'foot',
}

/**
 * Newer Boardsesh/Kilter climbs sometimes use product-scoped role ids
 * (e.g. 42–45) instead of classic 12–15. Each product has 4 consecutive
 * roles: start, middle, finish, foot.
 */
const ROLE_BASES = [12, 20, 24, 28, 32, 36, 42, 46, 50] as const

export function normalizeRoleId(roleId: number): HoldRoleId {
  for (const base of ROLE_BASES) {
    if (roleId >= base && roleId < base + 4) {
      return (12 + (roleId - base)) as HoldRoleId
    }
  }
  if (roleId === 12 || roleId === 13 || roleId === 14 || roleId === 15 || roleId === 20) {
    return roleId as HoldRoleId
  }
  // Unknown → treat as middle hold so something still lights up
  return 13
}

export interface BoardLayer {
  setId: number
  setName: string
  /** Public URL under /img/kilter/… */
  imageUrl: string
}

export interface BoardRenderMeta {
  boardWidth: number
  boardHeight: number
  edgeLeft: number
  edgeRight: number
  edgeBottom: number
  edgeTop: number
  xSpacing: number
  ySpacing: number
  holdRadius: number
  layers: BoardLayer[]
  layoutName: string
  sizeName: string
}

/** Fixed render size matching hangtime fallback (1080 × aspect of edges) */
function getBoardMetrics(): BoardRenderMeta {
  const edgeLeft = size.edge_left
  const edgeRight = size.edge_right
  const edgeBottom = size.edge_bottom
  const edgeTop = size.edge_top
  const coordinateWidth = Math.max(1, edgeRight - edgeLeft)
  const coordinateHeight = Math.max(1, edgeTop - edgeBottom)
  const boardWidth = 1080
  const boardHeight = Math.round((boardWidth * coordinateHeight) / coordinateWidth)
  const xSpacing = boardWidth / coordinateWidth
  const ySpacing = boardHeight / coordinateHeight

  const layers: BoardLayer[] = KILTER_SET_IDS.map((setId) => {
    const row = psls.find(
      (r) =>
        r.product_size_id === KILTER_SIZE_ID &&
        r.layout_id === KILTER_LAYOUT_ID &&
        r.set_id === setId,
    )
    const set = sets.find((s) => s.id === setId)
    return {
      setId,
      setName: set?.name ?? String(setId),
      imageUrl: row ? `/img/kilter/${row.image_filename}` : '',
    }
  }).filter((l) => l.imageUrl)

  return {
    boardWidth,
    boardHeight,
    edgeLeft,
    edgeRight,
    edgeBottom,
    edgeTop,
    xSpacing,
    ySpacing,
    holdRadius: xSpacing * 4,
    layers,
    layoutName: layouts[0]?.name ?? 'Kilter Board Original',
    sizeName: size.name,
  }
}

let cachedMeta: BoardRenderMeta | null = null
export function getBoardMeta(): BoardRenderMeta {
  if (!cachedMeta) cachedMeta = getBoardMetrics()
  return cachedMeta
}

function holeToSvg(x: number, y: number, meta: BoardRenderMeta) {
  return {
    cx: (x - meta.edgeLeft) * meta.xSpacing,
    cy: meta.boardHeight - (y - meta.edgeBottom) * meta.ySpacing,
    r: meta.holdRadius,
  }
}

/**
 * Aurora multi-frame format (lead / circuit climbs):
 *   frame0,"frame1,"frame2,"…
 * Each frame is a **delta** applied on top of the previous board state:
 *   p{placementId}r{roleId}  — set / recolor hold
 *   x{placementId}           — clear hold
 * Single-frame climbs are just `p…r…p…r…` with no `,"` separators.
 */
export function splitFrameDeltas(frames: string): string[] {
  if (!frames?.trim()) return []
  // Keep empty deltas — multi-frame routes may have no-change steps (`frame0,"`)
  return frames.split(',"').map((s) => s.replace(/^"+|"+$/g, '').trim())
}

export type FrameOp =
  | { type: 'set'; placementId: number; roleId: number }
  | { type: 'clear'; placementId: number }

/** Tokenize one frame delta into set/clear ops (order preserved). */
export function parseFrameOps(delta: string): FrameOp[] {
  const ops: FrameOp[] = []
  const re = /([px])(\d+)(?:r(\d+))?/g
  let match: RegExpExecArray | null
  while ((match = re.exec(delta)) !== null) {
    const op = match[1]
    const placementId = Number(match[2])
    if (!Number.isFinite(placementId)) continue
    if (op === 'x') {
      ops.push({ type: 'clear', placementId })
    } else if (op === 'p' && match[3] != null) {
      const roleId = Number(match[3])
      if (Number.isFinite(roleId)) {
        ops.push({ type: 'set', placementId, roleId })
      }
    }
  }
  return ops
}

function applyOps(
  state: Map<number, number>,
  ops: FrameOp[],
): Map<number, number> {
  const next = new Map(state)
  for (const op of ops) {
    if (op.type === 'clear') next.delete(op.placementId)
    else next.set(op.placementId, op.roleId)
  }
  return next
}

/** placementId → raw roleId after each frame (cumulative). */
export function resolveRoleStates(frames: string): Map<number, number>[] {
  const deltas = splitFrameDeltas(frames)
  if (deltas.length === 0) return []
  const states: Map<number, number>[] = []
  let state = new Map<number, number>()
  for (const delta of deltas) {
    state = applyOps(state, parseFrameOps(delta))
    states.push(state)
  }
  return states
}

function holdFromPlacement(
  placementId: number,
  rawRoleId: number,
  meta: BoardRenderMeta,
): BoardHold | null {
  const roleId = normalizeRoleId(rawRoleId)
  const placement = placementById.get(placementId)
  if (!placement) return null

  const hole = holeById.get(placement.hole_id)
  if (!hole) return null

  // Clip to product size bounds (hangtime filters the same way)
  if (
    hole.x <= meta.edgeLeft ||
    hole.x >= meta.edgeRight ||
    hole.y <= meta.edgeBottom ||
    hole.y >= meta.edgeTop
  ) {
    return null
  }

  const ledPosition = ledPositionByPlacementId.get(placementId)
  if (ledPosition === undefined) return null

  // Prefer classic product-1 roles for colors (12–15)
  const role = roleById.get(roleId) ?? roleById.get(rawRoleId)
  const ledColor = role?.led_color ?? 'FFFFFF'
  const screenColor = role?.screen_color ?? ledColor
  const roleName = ROLE_NAME_MAP[role?.name ?? ''] ?? 'hand'
  const { cx, cy, r } = holeToSvg(hole.x, hole.y, meta)

  return {
    placementId,
    ledPosition,
    roleId,
    role: roleName,
    color: `#${screenColor}`,
    ledColor,
    cx,
    cy,
    r,
  }
}

function holdsFromRoleState(state: Map<number, number>): BoardHold[] {
  const meta = getBoardMeta()
  const holds: BoardHold[] = []
  for (const [placementId, rawRoleId] of state) {
    const hold = holdFromPlacement(placementId, rawRoleId, meta)
    if (hold) holds.push(hold)
  }
  return holds
}

/**
 * Full sequence of board states for multi-frame climbs.
 * Index 0 = after first delta, last = final lit state.
 */
export function parseFrameSequence(frames: string): BoardHold[][] {
  return resolveRoleStates(frames).map(holdsFromRoleState)
}

export function frameCount(frames: string): number {
  return splitFrameDeltas(frames).length
}

/** Hand roles only (start / middle / finish) — not feet. */
export function isHandRoleId(roleId: number): boolean {
  const n = normalizeRoleId(roleId)
  return n === 12 || n === 13 || n === 14
}

export interface ClimbFrameStats {
  /** Number of Aurora frames (1 = boulder) */
  frameCount: number
  /** True when multi-frame (route / lead) */
  isRoute: boolean
  /** Holds lit on first frame (all roles) — boulder list stat */
  holdCount: number
  /**
   * Hand moves: unique hand holds across the sequence where a
   * hold that stays lit on the next frame is only counted once. Implemented
   * as “new hand placement vs previous frame” summed over frames — feet excluded.
   */
  moveCount: number
}

/**
 * Stats for list UI: boulders → holdCount; routes → moveCount + frameCount.
 */
export function analyzeClimbFrames(frames: string | null | undefined): ClimbFrameStats {
  if (!frames?.trim()) {
    return { frameCount: 0, isRoute: false, holdCount: 0, moveCount: 0 }
  }
  const states = resolveRoleStates(frames)
  const n = states.length
  if (n === 0) {
    return { frameCount: 0, isRoute: false, holdCount: 0, moveCount: 0 }
  }

  const first = states[0]!
  const holdCount = first.size

  // New hand holds vs previous frame (adjacent continuity not re-counted)
  let moveCount = 0
  let prevHands = new Set<number>()
  for (const state of states) {
    const hands = new Set<number>()
    for (const [placementId, roleId] of state) {
      if (isHandRoleId(roleId)) hands.add(placementId)
    }
    for (const id of hands) {
      if (!prevHands.has(id)) moveCount++
    }
    prevHands = hands
  }

  return {
    frameCount: n,
    isRoute: n > 1,
    holdCount,
    moveCount,
  }
}

/**
 * Parse Aurora frames into board holds for SVG + BLE.
 * Multi-frame: returns the **first** frame state (start of sequence).
 * Use `parseFrameSequence` + player for lead/circuit climbs.
 */
export function parseFrames(frames: string): BoardHold[] {
  const seq = parseFrameSequence(frames)
  return seq[0] ?? []
}

/** Final cumulative board state (end of multi-frame sequence). */
export function parseFramesFinal(frames: string): BoardHold[] {
  const seq = parseFrameSequence(frames)
  if (seq.length === 0) return []
  return seq[seq.length - 1] ?? []
}

export function holdsFromClimb(climb: Climb): BoardHold[] {
  return parseFrames(climb.frames)
}

/** Payload for @hangtime/grip-connect AuroraBoard.led() */
export function holdsToLedPlacements(holds: BoardHold[]): AuroraLedPlacement[] {
  return holds.map((h) => ({
    position: h.ledPosition,
    color: h.ledColor.replace(/^#/, ''),
  }))
}

export function getPlacementRoles() {
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    ledColor: `#${r.led_color}`,
    screenColor: `#${r.screen_color}`,
  }))
}

export interface EditablePlacement {
  placementId: number
  ledPosition: number
  cx: number
  cy: number
  r: number
  setId: number
}

/** All clickable placements in size 10 / layout 1 (bolt-ons + screw-ons). */
export function listEditablePlacements(): EditablePlacement[] {
  const meta = getBoardMeta()
  const out: EditablePlacement[] = []
  for (const p of placements) {
    if (p.layout_id !== KILTER_LAYOUT_ID) continue
    if (!(KILTER_SET_IDS as readonly number[]).includes(p.set_id)) continue
    const hole = holeById.get(p.hole_id)
    if (!hole) continue
    if (
      hole.x <= meta.edgeLeft ||
      hole.x >= meta.edgeRight ||
      hole.y <= meta.edgeBottom ||
      hole.y >= meta.edgeTop
    ) {
      continue
    }
    const ledPosition = ledPositionByPlacementId.get(p.id)
    if (ledPosition === undefined) continue
    const { cx, cy, r } = holeToSvg(hole.x, hole.y, meta)
    out.push({
      placementId: p.id,
      ledPosition,
      cx,
      cy,
      r: r * 0.92,
      setId: p.set_id,
    })
  }
  return out
}

/** BoardHold for a placement + classic role id (12–15). */
export function boardHoldAt(
  placementId: number,
  roleId: HoldRoleId,
): BoardHold | null {
  return holdFromPlacement(placementId, roleId, getBoardMeta())
}

export function holdsFromRoleMap(
  state: Map<number, number> | Record<number, number>,
): BoardHold[] {
  const map =
    state instanceof Map
      ? state
      : new Map(Object.entries(state).map(([k, v]) => [Number(k), v]))
  return holdsFromRoleState(map)
}

/**
 * Encode absolute frame states → Aurora multi-frame string.
 * Frame 0 is absolute; later frames are deltas (`p…r…` / `x…`) joined by `,"`.
 */
export function encodeFramesFromStates(
  states: Array<Map<number, number>>,
): string {
  if (states.length === 0) return ''
  const parts: string[] = []
  let prev = new Map<number, number>()
  for (const state of states) {
    let delta = ''
    for (const id of prev.keys()) {
      if (!state.has(id)) delta += `x${id}`
    }
    for (const [id, role] of state) {
      if (prev.get(id) !== role) delta += `p${id}r${role}`
    }
    parts.push(delta)
    prev = new Map(state)
  }
  // Preserve multi-frame even when later deltas are empty (identical absolute states)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!
  return parts.join(',"')
}
