'use client'

import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { getBoardMeta, listEditablePlacements } from '@/lib/aurora/board'
import { MobileBoardScroller } from '@/components/MobileBoardScroller'

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
 * Hold-search board: same chrome as Set (ui-card, layer images, markers).
 * Phone: pinch-zoom + pan via react-zoom-pan-pinch.
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
  const lastPtr = useRef(0)

  const hit = (placementId: number, fromPointer = false) => {
    if (disabled) return
    if (fromPointer) lastPtr.current = performance.now()
    else if (performance.now() - lastPtr.current < 450) return
    onToggle(placementId)
  }

  const ptr = (placementId: number) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      e.preventDefault()
      e.stopPropagation()
      hit(placementId, true)
    },
    onClick: (e: React.MouseEvent) => {
      e.preventDefault()
      hit(placementId, false)
    },
  })

  return (
    <div className={className}>
      {/* Same outer chrome as SetStudio board */}
      <section className="ui-card overflow-hidden p-0">
        <div className="border-b border-border px-3 py-2 text-[11px] text-muted sm:px-4">
          Tap holds to filter · all selected required ·{' '}
          <span className="text-faint">{meta.sizeName}</span>
          {selected.size > 0 ? (
            <span className="text-muted"> · {selected.size} selected</span>
          ) : null}
        </div>
        <MobileBoardScroller>
          <div className="relative w-full touch-none select-none">
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
                    style={{ touchAction: 'none' }}
                    className="board-hold-hit transition-opacity hover:fill-accent/20 hover:stroke-accent/50"
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
                    style={{ touchAction: 'none' }}
                    className="hold-marker board-hold-hit"
                    {...ptr(p.placementId)}
                  />
                )
              })}
            </svg>
          </div>
        </MobileBoardScroller>
      </section>
    </div>
  )
}
