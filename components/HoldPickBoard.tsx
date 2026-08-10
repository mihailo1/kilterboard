'use client'

import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { getBoardMeta, listEditablePlacements } from '@/lib/aurora/board'

/** Violet selection — same marker language as Set painted holds */
const SELECT_HEX = '#A78BFA'

interface HoldPickBoardProps {
  /** Selected placement IDs (any role counts in search). */
  selected: Set<number>
  onToggle: (placementId: number) => void
  className?: string
  disabled?: boolean
}

/**
 * Tap holds on the 12×12 board (same visual as Set: product layer images +
 * ghost targets / painted markers). Role-agnostic selection for hold search.
 *
 * Mobile: pointerdown only + touch-none (avoids double-toggle and scroll steal).
 */
export function HoldPickBoard({
  selected,
  onToggle,
  className = '',
  disabled = false,
}: HoldPickBoardProps) {
  const meta = getBoardMeta()
  const { boardWidth, boardHeight, layers } = meta
  const placements = useMemo(() => listEditablePlacements(), [])
  /** Ignore synthetic click after touch pointerdown */
  const lastPtr = useRef(0)

  const hit = (placementId: number, fromPointer = false) => {
    if (disabled) return
    if (fromPointer) lastPtr.current = performance.now()
    else if (performance.now() - lastPtr.current < 450) return
    onToggle(placementId)
  }

  const ptr = (placementId: number) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      // Primary button / touch only
      if (e.button !== 0 && e.pointerType === 'mouse') return
      e.preventDefault()
      e.stopPropagation()
      hit(placementId, true)
    },
    // Fallback for environments that only fire click
    onClick: (e: React.MouseEvent) => {
      e.preventDefault()
      hit(placementId, false)
    },
  })

  return (
    <div className={className}>
      <div
        className={`relative w-full select-none overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_12px_40px_-16px_rgb(0_0_0_/_0.55)] touch-none ${
          disabled ? 'opacity-70' : 'cursor-pointer'
        }`}
      >
        <svg
          viewBox={`0 0 ${boardWidth} ${boardHeight}`}
          className="h-auto w-full touch-none"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Tap holds to include in boulder search"
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

          {placements.map((p) => {
            if (selected.has(p.placementId)) return null
            return (
              <circle
                key={`g-${p.placementId}`}
                cx={p.cx}
                cy={p.cy}
                r={p.r * 0.72}
                fill="rgb(255 255 255 / 0.05)"
                stroke="rgb(255 255 255 / 0.14)"
                strokeWidth={1.5}
                className="transition-opacity hover:fill-accent/20 hover:stroke-accent/50"
                style={{ touchAction: 'none' }}
                {...ptr(p.placementId)}
              />
            )
          })}

          {placements.map((p) => {
            if (!selected.has(p.placementId)) return null
            return (
              <circle
                key={`a-${p.placementId}`}
                cx={p.cx}
                cy={p.cy}
                r={p.r}
                fill={SELECT_HEX}
                fillOpacity={0.28}
                stroke={SELECT_HEX}
                strokeWidth={Math.max(4, Math.round(p.r / 5))}
                strokeOpacity={0.95}
                className="hold-marker"
                style={{ touchAction: 'none' }}
                {...ptr(p.placementId)}
              />
            )
          })}
        </svg>
      </div>
      <p className="mt-3 px-1 pb-0.5 text-center text-[11px] leading-snug text-faint sm:px-2">
        <span className="inline-block max-w-[22rem] text-balance">
          Tap to select · boulder must include all selected holds
          {selected.size > 0 ? (
            <span className="text-muted"> · {selected.size} selected</span>
          ) : null}
        </span>
      </p>
    </div>
  )
}
