'use client'

import type { BoardHold } from '@/types'
import { getBoardMeta } from '@/lib/aurora/board'

interface KilterBoardProps {
  holds: BoardHold[]
  className?: string
  /** Placement ids flagged bad (playground feedback) */
  flaggedIds?: ReadonlySet<number> | number[]
  /** Tap hold to flag / unflag (playground) */
  onHoldClick?: (placementId: number) => void
}

/**
 * Board viewer in the style of hangtime examples/aurora:
 * layered set images (bolt-ons + screw-ons) + SVG circles for active holds.
 */
export function KilterBoard({
  holds,
  className = '',
  flaggedIds,
  onHoldClick,
}: KilterBoardProps) {
  const meta = getBoardMeta()
  const { boardWidth, boardHeight, layers } = meta
  const flagged =
    flaggedIds instanceof Set
      ? flaggedIds
      : new Set(flaggedIds ?? [])
  const interactive = typeof onHoldClick === 'function'

  return (
    <div
      className={`w-full overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_12px_40px_-16px_rgb(0_0_0_/_0.55)] ${className}`}
    >
      <svg
        viewBox={`0 0 ${boardWidth} ${boardHeight}`}
        className={`h-auto w-full select-none ${interactive ? 'touch-manipulation cursor-crosshair' : 'touch-none'}`}
        preserveAspectRatio="xMidYMid meet"
        role={interactive ? 'group' : 'img'}
        aria-label={`${meta.layoutName} · ${meta.sizeName}${interactive ? ' · tap holds to flag bad' : ''}`}
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
        {holds.map((hold) => {
          const bad = flagged.has(hold.placementId)
          const stroke = bad ? '#f43f5e' : hold.color
          const r = bad ? hold.r * 1.12 : hold.r
          return (
            <g key={hold.placementId}>
              <circle
                className="hold-marker"
                cx={hold.cx}
                cy={hold.cy}
                r={r}
                fill={bad ? '#f43f5e' : hold.color}
                fillOpacity={bad ? 0.4 : 0.25}
                stroke={stroke}
                strokeWidth={Math.max(4, Math.round(hold.r / 5)) * (bad ? 1.35 : 1)}
                strokeOpacity={0.95}
                style={interactive ? { cursor: 'pointer' } : undefined}
                onClick={
                  interactive
                    ? (e) => {
                        e.stopPropagation()
                        onHoldClick(hold.placementId)
                      }
                    : undefined
                }
                onPointerDown={
                  interactive
                    ? (e) => {
                        // avoid parent scroll steal on mobile
                        if (e.pointerType === 'touch') e.preventDefault()
                      }
                    : undefined
                }
              />
              {bad && (
                <>
                  <line
                    x1={hold.cx - r * 0.45}
                    y1={hold.cy - r * 0.45}
                    x2={hold.cx + r * 0.45}
                    y2={hold.cy + r * 0.45}
                    stroke="#fff"
                    strokeWidth={Math.max(3, r * 0.18)}
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                  <line
                    x1={hold.cx + r * 0.45}
                    y1={hold.cy - r * 0.45}
                    x2={hold.cx - r * 0.45}
                    y2={hold.cy + r * 0.45}
                    stroke="#fff"
                    strokeWidth={Math.max(3, r * 0.18)}
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                </>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
