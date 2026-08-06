'use client'

import { useMemo, type CSSProperties } from 'react'
import {
  boardHoldAt,
  getBoardMeta,
  listEditablePlacements,
} from '@/lib/aurora/board'
import type { HoldRole, HoldRoleId } from '@/types'

export type PaintTool = HoldRoleId | 'erase'

/** Explicit Kilter screen colors — do not derive from other maps. */
const ROLE_HEX: Record<number, string> = {
  12: '#00DD00', // start — green
  13: '#00FFFF', // hand — cyan
  14: '#FF00FF', // finish — magenta
  15: '#FFA500', // foot — orange
  20: '#00DD00',
}

const ROLE_TOOLS: {
  id: HoldRoleId
  role: HoldRole
  short: string
  hex: string
}[] = [
  { id: 12, role: 'start', short: 'Start', hex: ROLE_HEX[12]! },
  { id: 13, role: 'hand', short: 'Hand', hex: ROLE_HEX[13]! },
  { id: 14, role: 'finish', short: 'Finish', hex: ROLE_HEX[14]! },
  { id: 15, role: 'foot', short: 'Foot', hex: ROLE_HEX[15]! },
]

function colorForRole(roleId: unknown): string {
  const n = Number(roleId)
  return ROLE_HEX[n] ?? '#FFFFFF'
}

interface PaintBoardProps {
  /** placementId → roleId */
  state: Map<number, number>
  tool: PaintTool
  onToolChange: (tool: PaintTool) => void
  onPaint: (placementId: number) => void
  /** Show “changed from original” markers */
  original?: Map<number, number> | null
  className?: string
  disabled?: boolean
}

/**
 * Palette-mode interactive board (tap empty holds to add, tap painted to
 * recolor/erase). Shared by AI playground for edit-after-gen feedback.
 */
export function PaintBoard({
  state,
  tool,
  onToolChange,
  onPaint,
  original = null,
  className = '',
  disabled = false,
}: PaintBoardProps) {
  const meta = getBoardMeta()
  const { boardWidth, boardHeight, layers } = meta
  const placements = useMemo(() => listEditablePlacements(), [])

  const painted = useMemo(() => {
    const map = new Map<number, { color: string; roleId: number }>()
    for (const [rawId, rawRole] of state) {
      const id = Number(rawId)
      const roleId = Number(rawRole)
      const h = boardHoldAt(id, roleId as HoldRoleId)
      if (!h) continue
      map.set(id, { color: colorForRole(roleId), roleId })
    }
    return map
  }, [state])

  const roleCounts = useMemo(() => {
    const c = { start: 0, hand: 0, finish: 0, foot: 0 }
    for (const r of state.values()) {
      const n = Number(r)
      if (n === 12) c.start++
      else if (n === 13) c.hand++
      else if (n === 14) c.finish++
      else if (n === 15) c.foot++
    }
    return c
  }, [state])

  const isChanged = (id: number) => {
    if (!original) return false
    const a = Number(state.get(id))
    // original may have been keyed with number or string
    const bRaw =
      original.get(id) ??
      original.get(Number(id)) ??
      // last resort: scan
      (() => {
        for (const [k, v] of original) {
          if (Number(k) === id) return v
        }
        return undefined
      })()
    if (bRaw === undefined) return true // added by user
    return Number(bRaw) !== a
  }

  const hit = (placementId: number) => {
    if (disabled) return
    onPaint(placementId)
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div
        className={`relative w-full select-none overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_12px_40px_-16px_rgb(0_0_0_/_0.55)] ${
          disabled ? 'opacity-70' : 'touch-manipulation'
        } ${tool === 'erase' ? 'cursor-cell' : 'cursor-crosshair'}`}
      >
        <svg
          viewBox={`0 0 ${boardWidth} ${boardHeight}`}
          className="h-auto w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Edit holds on board"
        >
          {layers.map((layer) => (
            <image
              key={layer.setId}
              href={layer.imageUrl}
              width={boardWidth}
              height={boardHeight}
              pointerEvents="none"
            />
          ))}

          {/* Ghost targets for empty placements */}
          {placements.map((p) => {
            if (painted.has(p.placementId)) return null
            return (
              <circle
                key={`g-${p.placementId}`}
                cx={p.cx}
                cy={p.cy}
                r={p.r * 0.62}
                fill="rgb(255 255 255 / 0.05)"
                stroke="rgb(255 255 255 / 0.14)"
                strokeWidth={1.5}
                className="transition-opacity hover:fill-white/10 hover:stroke-white/40"
                onClick={() => hit(p.placementId)}
                onPointerDown={(e) => {
                  if (e.pointerType === 'touch') {
                    e.preventDefault()
                    hit(p.placementId)
                  }
                }}
              />
            )
          })}

          {/* Active holds — stroke ALWAYS matches role color (never amber/foot-like “changed” tint) */}
          {placements.map((p) => {
            const hitPaint = painted.get(p.placementId)
            if (!hitPaint) return null
            const changed = isChanged(p.placementId)
            const roleColor = hitPaint.color
            return (
              <g key={`a-${p.placementId}`}>
                {/* Optional outer ring for edits — white, not orange */}
                {changed && (
                  <circle
                    cx={p.cx}
                    cy={p.cy}
                    r={p.r * 1.22}
                    fill="none"
                    stroke="rgb(255 255 255 / 0.85)"
                    strokeWidth={Math.max(2, Math.round(p.r / 8))}
                    strokeDasharray={`${Math.max(4, p.r / 3)} ${Math.max(3, p.r / 4)}`}
                    pointerEvents="none"
                  />
                )}
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={p.r}
                  fill={roleColor}
                  fillOpacity={0.28}
                  stroke={roleColor}
                  strokeWidth={Math.max(4, Math.round(p.r / 5))}
                  strokeOpacity={0.95}
                  onClick={() => hit(p.placementId)}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'touch') {
                      e.preventDefault()
                      hit(p.placementId)
                    }
                  }}
                />
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-faint">
          Paint: pick role, tap empty to add · tap painted to set role · Erase
          clears. White dashed ring = changed vs AI gen.
        </p>
        <div className="flex flex-wrap gap-1.5 text-[10px] text-faint">
          {ROLE_TOOLS.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
                style={{ backgroundColor: t.hex }}
              />
              <span style={{ color: t.hex }}>{t.short[0]}</span>
              {roleCounts[t.role]}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {ROLE_TOOLS.map((t) => {
          const active = tool === t.id
          const hex = t.hex
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => onToolChange(t.id)}
              className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-2xl border-2 px-1 py-2 text-center transition active:scale-[0.97] ${
                active ? 'bg-surface-2' : 'bg-surface-2/80 hover:bg-surface-3'
              }`}
              style={
                {
                  borderColor: active ? hex : `${hex}66`,
                  backgroundColor: active ? `${hex}28` : undefined,
                  boxShadow: active ? `0 0 0 1px ${hex}55 inset` : undefined,
                } as CSSProperties
              }
            >
              <span
                className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-white/25"
                style={{
                  backgroundColor: hex,
                  boxShadow: `0 0 8px ${hex}`,
                }}
                aria-hidden
              />
              <span
                className="text-[11px] font-bold"
                style={{ color: active ? hex : 'var(--color-ink-soft)' }}
              >
                {t.short}
              </span>
            </button>
          )
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onToolChange('erase')}
          className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-2xl border-2 px-1 py-2 text-center transition active:scale-[0.97] ${
            tool === 'erase'
              ? 'border-rose-400 bg-rose-500/15 text-rose-100'
              : 'border-border bg-surface-2 text-muted hover:bg-surface-3'
          }`}
        >
          <span className="text-sm font-bold">×</span>
          <span className="text-[11px] font-bold">Erase</span>
        </button>
      </div>
    </div>
  )
}

export function holdsToMap(
  holds: Array<[number, number]>,
): Map<number, number> {
  const m = new Map<number, number>()
  for (const pair of holds) {
    if (!pair || pair.length < 2) continue
    const id = Number(pair[0])
    const role = Number(pair[1])
    if (!Number.isFinite(id) || !Number.isFinite(role)) continue
    m.set(id, role)
  }
  return m
}

export function mapToHolds(m: Map<number, number>): Array<[number, number]> {
  return Array.from(m.entries()).map(
    ([id, role]) => [Number(id), Number(role)] as [number, number],
  )
}

export function holdsEqual(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
): boolean {
  if (a.length !== b.length) return false
  const sa = [...a]
    .map(([id, r]) => [Number(id), Number(r)] as [number, number])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const sb = [...b]
    .map(([id, r]) => [Number(id), Number(r)] as [number, number])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1])
  return sa.every((p, i) => p[0] === sb[i]![0] && p[1] === sb[i]![1])
}
