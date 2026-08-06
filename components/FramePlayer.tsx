'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoardHold } from '@/types'
import { parseFrameSequence } from '@/lib/aurora/board'
import { KilterBoard } from '@/components/KilterBoard'
import { BluetoothSet } from '@/components/BluetoothSet'
import { ROLE_DISPLAY } from '@/lib/roles'
import {
  isBoardConnected,
  setLeds,
} from '@/lib/aurora/device'
import { holdsToLedPlacements } from '@/lib/aurora/board'

const PACE_OPTIONS = [
  { label: '0.8s', ms: 800 },
  { label: '1.5s', ms: 1500 },
  { label: '2.5s', ms: 2500 },
  { label: '4s', ms: 4000 },
] as const

const DEFAULT_PACE_MS = 1500

interface FramePlayerProps {
  frames: string
  climbName?: string
  /** When false, only Connect + frame transport (no second board). Default true. */
  showBoard?: boolean
}

/**
 * Multi-frame (lead/circuit) climb player.
 * Aurora stores sequences as deltas separated by `,"` with p…r… / x… ops.
 */
export function FramePlayer({
  frames,
  climbName,
  showBoard = true,
}: FramePlayerProps) {
  const sequence = useMemo(() => parseFrameSequence(frames), [frames])
  const total = sequence.length
  const multi = total > 1

  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [paceMs, setPaceMs] = useState(DEFAULT_PACE_MS)
  const [loop, setLoop] = useState(false)
  const [pushBle, setPushBle] = useState(true)

  // Reset when climb changes
  useEffect(() => {
    setIndex(0)
    setPlaying(false)
  }, [frames])

  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1)
  const holds: BoardHold[] = sequence[safeIndex] ?? []

  // Auto-advance
  useEffect(() => {
    if (!playing || !multi) return
    const id = window.setTimeout(() => {
      setIndex((i) => {
        if (i + 1 < total) return i + 1
        if (loop) return 0
        setPlaying(false)
        return i
      })
    }, paceMs)
    return () => window.clearTimeout(id)
  }, [playing, safeIndex, paceMs, multi, total, loop])

  // Push current frame to board when connected (optional)
  const lastPushed = useRef<string>('')
  useEffect(() => {
    if (!pushBle || !isBoardConnected()) return
    const key = `${safeIndex}:${holds.map((h) => `${h.placementId}:${h.roleId}`).join(',')}`
    if (key === lastPushed.current) return
    lastPushed.current = key
    const placements = holdsToLedPlacements(holds)
    void setLeds(placements).catch(() => {
      /* user can re-Set manually */
    })
  }, [holds, safeIndex, pushBle])

  const go = useCallback(
    (next: number) => {
      if (total === 0) return
      setIndex(Math.max(0, Math.min(total - 1, next)))
    },
    [total],
  )

  const roleCounts = useMemo(() => {
    return holds.reduce(
      (acc, h) => {
        acc[h.role] = (acc[h.role] ?? 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )
  }, [holds])

  return (
    <div className="flex flex-col gap-4">
      <section className="ui-card space-y-1 p-4 sm:p-5">
        <h2 className="ui-label mb-3 !flex-row">Light on board</h2>
        <BluetoothSet holds={holds} climbName={climbName} />
        {multi && (
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={pushBle}
              onChange={(e) => setPushBle(e.target.checked)}
              className="rounded border-border bg-surface-2 text-accent focus:ring-accent/40"
            />
            Auto-update LEDs when frame changes (if connected)
          </label>
        )}
      </section>

      {showBoard && <KilterBoard holds={holds} />}

      {multi && (
        <section className="ui-card p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="ui-label !flex-row">Frame sequence</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {safeIndex + 1}
                <span className="text-faint"> / {total}</span>
                <span className="ml-2 text-xs font-normal text-muted">
                  · {holds.length} holds lit
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                Pace
                <select
                  value={paceMs}
                  onChange={(e) => setPaceMs(Number(e.target.value))}
                  className="rounded-xl border border-border bg-surface-2 px-2 py-1 text-xs text-ink"
                >
                  {PACE_OPTIONS.map((p) => (
                    <option key={p.ms} value={p.ms}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setLoop((v) => !v)}
                className={loop ? 'ui-chip ui-chip-active' : 'ui-chip'}
                title="Loop playback"
              >
                Loop
              </button>
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            step={1}
            value={safeIndex}
            onChange={(e) => {
              setPlaying(false)
              go(Number(e.target.value))
            }}
            className="mb-4 w-full"
            aria-label="Frame"
          />

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPlaying(false)
                go(0)
              }}
              className="ui-btn-ghost px-3"
              title="First frame"
            >
              ⏮
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false)
                go(safeIndex - 1)
              }}
              disabled={safeIndex <= 0}
              className="ui-btn-ghost px-3"
              title="Previous"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="ui-btn-primary min-w-[5.5rem]"
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false)
                go(safeIndex + 1)
              }}
              disabled={safeIndex >= total - 1}
              className="ui-btn-ghost px-3"
              title="Next"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false)
                go(total - 1)
              }}
              className="ui-btn-ghost px-3"
              title="Last frame"
            >
              ⏭
            </button>
          </div>
        </section>
      )}

      {showBoard && (
        <section className="flex flex-wrap gap-3 text-xs text-muted">
          {Object.entries(ROLE_DISPLAY).map(([key, { label, hex }]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full shadow-sm"
                style={{ backgroundColor: hex }}
              />
              {label}
              {roleCounts[key] ? ` · ${roleCounts[key]}` : ''}
            </span>
          ))}
          <span className="ml-auto text-faint">
            {holds.length} holds
            {multi ? ` · frame ${safeIndex + 1}/${total}` : ''}
          </span>
        </section>
      )}
    </div>
  )
}
