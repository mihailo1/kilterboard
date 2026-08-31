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
import { SingleRangeSlider } from '@/components/RangeSliders'

const PACE_MIN_MS = 200
const PACE_MAX_MS = 6000
const PACE_STEP_MS = 50
const PACE_PRESETS_MS = [300, 500, 800, 1200, 1500, 2000, 3000, 4500, 6000]

const DEFAULT_PACE_MS = 1500

function fmtPace(ms: number): string {
  const s = ms / 1000
  return `${Number.isInteger(s) ? s.toFixed(0) : s.toFixed(1)}s`
}

function fmtDuration(ms: number): string {
  const totalSec = ms / 1000
  if (totalSec < 60) {
    return `${Number.isInteger(totalSec) ? totalSec.toFixed(0) : totalSec.toFixed(1)}s`
  }
  const m = Math.floor(totalSec / 60)
  const s = Math.round(totalSec % 60)
  return `${m}m ${s}s`
}

const WORK_PRESETS = [10, 15, 20, 30, 45, 60]
const REST_PRESETS = [30, 45, 60, 90, 120]

type LoopMode = 'off' | 'loop' | 'pingpong'
type IntervalPhase = 'idle' | 'work' | 'rest' | 'done'

interface FramePlayerProps {
  frames: string
  climbName?: string
  /** When false, only Connect + frame transport (no second board). Default true. */
  showBoard?: boolean
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function playCue(kind: 'work' | 'rest' | 'tick' | 'done') {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const freqs: Record<typeof kind, number[]> = {
      work: [660, 990],
      rest: [440],
      tick: [520],
      done: [880, 660, 990],
    }
    let t = ctx.currentTime
    for (const f of freqs[kind]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.18)
      t += 0.12
    }
    window.setTimeout(() => ctx.close(), 500)
  } catch {
    /* audio unavailable */
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* unsupported */
  }
}

function IconPlay({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M7.5 5.2v13.6c0 .8.9 1.3 1.6.9l10.6-6.8a1 1 0 0 0 0-1.7L9.1 4.3c-.7-.4-1.6.1-1.6.9Z"
        fill="currentColor"
      />
    </svg>
  )
}

function IconPause({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  )
}

function IconSkipBack({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="M6 5v14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M18.5 6 9 12l9.5 6Z" fill="currentColor" />
    </svg>
  )
}

function IconSkipForward({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="M18 5v14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M5.5 6 15 12l-9.5 6Z" fill="currentColor" />
    </svg>
  )
}

function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path
        d="M15 5.5 8 12l7 6.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path
        d="M9 5.5 16 12l-7 6.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconRepeat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path
        d="M17 2.5 20 5.5 17 8.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 11V9a4 4 0 0 1 4-4h12"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 21.5 4 18.5 7 15.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 13v2a4 4 0 0 1-4 4H4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPingPong({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path
        d="M4 8h11l-3-3M15 8l-3 3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 16H9l3 3M9 16l3-3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconBell({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path
        d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function IconBellOff({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path
        d="M6 10a6 6 0 0 1 10.2-4.3M18 10c0 4 1.5 5.5 1.5 5.5H8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4.5 15.5H6M9.5 18.5a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M3.5 3.5l17 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

function IconSquare({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  )
}

function IconTimer({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 9v4l3 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 2.5h5M12 5v-2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function IntervalRing({
  fraction,
  time,
  phaseLabel,
  colorClass,
}: {
  fraction: number
  time: string
  phaseLabel: string
  colorClass: string
}) {
  const size = 176
  const stroke = 10
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.min(1, Math.max(0, fraction)))
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          className="text-surface-3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={colorClass}
          style={{ transition: 'stroke-dashoffset 0.2s linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{phaseLabel}</span>
        <span className="text-4xl font-bold tabular-nums text-ink">{time}</span>
      </div>
    </div>
  )
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
  const [loopMode, setLoopMode] = useState<LoopMode>('off')
  const [direction, setDirection] = useState<1 | -1>(1)
  const [pushBle, setPushBle] = useState(true)

  // Interval (work/rest) training
  const [ivWorkSec, setIvWorkSec] = useState(30)
  const [ivRestSec, setIvRestSec] = useState(45)
  const [ivRounds, setIvRounds] = useState(5)
  const [ivInfinite, setIvInfinite] = useState(false)
  const [ivResetEachRound, setIvResetEachRound] = useState(true)
  const [ivSound, setIvSound] = useState(true)
  const [ivPhase, setIvPhase] = useState<IntervalPhase>('idle')
  const [ivPaused, setIvPaused] = useState(false)
  const [ivRound, setIvRound] = useState(0)
  const [ivRemainingMs, setIvRemainingMs] = useState(0)

  const ivRunning = ivPhase === 'work' || ivPhase === 'rest'
  const prevWholeSecRef = useRef<number | null>(null)

  // Reset when climb changes
  useEffect(() => {
    setIndex(0)
    setPlaying(false)
    setDirection(1)
    setIvPhase('idle')
    setIvPaused(false)
    setIvRound(0)
    setIvRemainingMs(0)
  }, [frames])

  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1)
  const holds: BoardHold[] = sequence[safeIndex] ?? []

  const go = useCallback(
    (next: number) => {
      if (total === 0) return
      setIndex(Math.max(0, Math.min(total - 1, next)))
    },
    [total],
  )

  // Auto-advance frames — plain loop, ping-pong, or forced forward-loop during interval work
  useEffect(() => {
    if (!playing || !multi) return
    const id = window.setTimeout(() => {
      setIndex((i) => {
        const atEnd = i >= total - 1
        const atStart = i <= 0

        if (ivPhase === 'work') {
          return atEnd ? 0 : i + 1
        }

        if (loopMode === 'pingpong') {
          if (direction === 1) {
            if (!atEnd) return i + 1
            setDirection(-1)
            return Math.max(0, i - 1)
          }
          if (!atStart) return i - 1
          setDirection(1)
          return Math.min(total - 1, i + 1)
        }

        if (!atEnd) return i + 1
        if (loopMode === 'loop') return 0
        setPlaying(false)
        return i
      })
    }, paceMs)
    return () => window.clearTimeout(id)
  }, [playing, safeIndex, paceMs, multi, total, loopMode, direction, ivPhase])

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

  const roleCounts = useMemo(() => {
    return holds.reduce(
      (acc, h) => {
        acc[h.role] = (acc[h.role] ?? 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )
  }, [holds])

  // Keyboard shortcuts: space = play/pause, ←/→ = step. Disabled while an interval session runs.
  useEffect(() => {
    if (!multi) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (ivRunning) return
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.code === 'ArrowRight') {
        setPlaying(false)
        go(safeIndex + 1)
      } else if (e.code === 'ArrowLeft') {
        setPlaying(false)
        go(safeIndex - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [multi, ivRunning, go, safeIndex])

  // Always-fresh phase-transition handler (avoids stale closures inside the ticking effect)
  const onIvPhaseEndRef = useRef<() => void>(() => {})
  onIvPhaseEndRef.current = () => {
    if (ivPhase === 'work') {
      const isLastRound = !ivInfinite && ivRound >= ivRounds
      if (isLastRound) {
        setIvPhase('done')
        setPlaying(false)
        if (ivSound) {
          playCue('done')
          vibrate([120, 80, 120, 80, 200])
        }
        return
      }
      setIvPhase('rest')
      setPlaying(false)
      setIvRemainingMs(ivRestSec * 1000)
      if (ivSound) {
        playCue('rest')
        vibrate(150)
      }
      return
    }
    if (ivPhase === 'rest') {
      const nextRound = ivRound + 1
      if (ivResetEachRound) go(0)
      setIvRound(nextRound)
      setIvPhase('work')
      setPlaying(true)
      setIvRemainingMs(ivWorkSec * 1000)
      if (ivSound) {
        playCue('work')
        vibrate([60, 40, 60])
      }
    }
  }

  // Countdown tick
  useEffect(() => {
    if (!ivRunning || ivPaused) return
    const id = window.setInterval(() => {
      setIvRemainingMs((ms) => Math.max(0, ms - 200))
    }, 200)
    return () => window.clearInterval(id)
  }, [ivRunning, ivPaused])

  // "3, 2, 1…" prep beeps near the end of rest
  useEffect(() => {
    if (!ivRunning) {
      prevWholeSecRef.current = null
      return
    }
    const wholeSec = Math.ceil(ivRemainingMs / 1000)
    if (ivSound && ivPhase === 'rest' && wholeSec !== prevWholeSecRef.current && wholeSec > 0 && wholeSec <= 3) {
      playCue('tick')
    }
    prevWholeSecRef.current = wholeSec
  }, [ivRemainingMs, ivRunning, ivPhase, ivSound])

  // Fire the phase transition once the countdown hits zero
  useEffect(() => {
    if (!ivRunning || ivPaused) return
    if (ivRemainingMs > 0) return
    onIvPhaseEndRef.current()
  }, [ivRemainingMs, ivRunning, ivPaused])

  const startInterval = useCallback(() => {
    if (!multi) return
    setDirection(1)
    if (ivResetEachRound) go(0)
    setIvRound(1)
    setIvPaused(false)
    setIvPhase('work')
    setPlaying(true)
    setIvRemainingMs(ivWorkSec * 1000)
    prevWholeSecRef.current = null
    if (ivSound) {
      playCue('work')
      vibrate([60, 40, 60])
    }
  }, [multi, ivResetEachRound, go, ivWorkSec, ivSound])

  const togglePauseInterval = useCallback(() => {
    setIvPaused((p) => {
      const next = !p
      setPlaying(!next && ivPhase === 'work')
      return next
    })
  }, [ivPhase])

  const stopInterval = useCallback(() => {
    setIvPhase('idle')
    setIvPaused(false)
    setIvRound(0)
    setIvRemainingMs(0)
    setPlaying(false)
  }, [])

  const skipRest = useCallback(() => {
    if (ivPhase !== 'rest' || ivPaused) return
    onIvPhaseEndRef.current()
  }, [ivPhase, ivPaused])

  const ivPhaseTotalMs = ivPhase === 'work' ? ivWorkSec * 1000 : ivPhase === 'rest' ? ivRestSec * 1000 : 0
  const ivFraction = ivPhaseTotalMs > 0 ? ivRemainingMs / ivPhaseTotalMs : 0

  const loopIcon =
    loopMode === 'pingpong' ? <IconPingPong className="h-4 w-4" /> : <IconRepeat className="h-4 w-4" />
  const loopTitle =
    loopMode === 'off' ? 'Loop: off — click to loop' : loopMode === 'loop' ? 'Loop: on — click for ping-pong' : 'Ping-pong — click to turn off'

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
        <section className="ui-card space-y-5 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
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
            <button
              type="button"
              onClick={() =>
                setLoopMode((m) => (m === 'off' ? 'loop' : m === 'loop' ? 'pingpong' : 'off'))
              }
              disabled={ivRunning}
              className={loopMode !== 'off' ? 'ui-chip ui-chip-active' : 'ui-chip'}
              title={loopTitle}
            >
              <span className="inline-flex items-center gap-1">
                {loopIcon}
                {loopMode === 'pingpong' ? 'Ping-pong' : 'Loop'}
              </span>
            </button>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="ui-label !flex-row">Pace</p>
              <span className="text-[11px] text-faint">
                Full run <span className="font-semibold text-muted">{fmtDuration((total - 1) * paceMs)}</span>
              </span>
            </div>
            <SingleRangeSlider
              min={PACE_MIN_MS}
              max={PACE_MAX_MS}
              step={PACE_STEP_MS}
              value={paceMs}
              onChange={setPaceMs}
              formatValue={fmtPace}
              minLabel="Fast"
              maxLabel="Slow"
              disabled={ivRunning}
            />
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {PACE_PRESETS_MS.map((ms) => (
                <button
                  key={ms}
                  type="button"
                  onClick={() => setPaceMs(ms)}
                  disabled={ivRunning}
                  className={ms === paceMs ? 'ui-chip ui-chip-active' : 'ui-chip'}
                >
                  {fmtPace(ms)}
                </button>
              ))}
            </div>
          </div>

          {ivRunning && (
            <p className="text-xs text-muted">
              Playback is driven by the interval session below — pause it to take manual control.
            </p>
          )}

          <fieldset disabled={ivRunning} className="m-0 border-0 p-0 disabled:opacity-40">
            <SingleRangeSlider
              min={0}
              max={Math.max(1, total - 1)}
              step={1}
              value={safeIndex}
              onChange={(v) => {
                setPlaying(false)
                go(v)
              }}
              formatValue={(v) => `${v + 1} / ${total}`}
              minLabel="1"
              maxLabel={String(total)}
              disabled={ivRunning}
            />

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPlaying(false)
                  go(0)
                }}
                className="ui-btn-ghost px-3"
                title="First frame"
              >
                <IconSkipBack className="h-4 w-4" />
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
                <IconChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="ui-btn-primary min-w-[5.5rem]"
              >
                <span className="inline-flex items-center gap-1.5">
                  {playing ? <IconPause className="h-4 w-4" /> : <IconPlay className="h-4 w-4" />}
                  {playing ? 'Pause' : 'Play'}
                </span>
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
                <IconChevronRight className="h-4 w-4" />
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
                <IconSkipForward className="h-4 w-4" />
              </button>
            </div>
          </fieldset>

          <p className="hidden text-center text-[11px] text-faint sm:block">
            Space to play/pause · ← → to step
          </p>
        </section>
      )}

      {multi && (
        <section className="ui-card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="ui-label !flex-row items-center gap-1.5">
              <IconTimer className="h-3.5 w-3.5" />
              Interval training
            </p>
            {ivPhase !== 'idle' && (
              <button
                type="button"
                onClick={() => setIvSound((s) => !s)}
                className="ui-filter-chip"
                title={ivSound ? 'Mute cues' : 'Enable sound + vibration cues'}
              >
                {ivSound ? <IconBell className="h-4 w-4" /> : <IconBellOff className="h-4 w-4" />}
              </button>
            )}
          </div>

          {ivPhase === 'idle' || ivPhase === 'done' ? (
            <div className="space-y-4">
              {ivPhase === 'done' && (
                <div className="rounded-2xl border border-success/25 bg-success/10 px-4 py-3 text-sm text-ink-soft">
                  Session complete — {ivRound} round{ivRound === 1 ? '' : 's'} done. Nice work.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="ui-label">
                  Work (s)
                  <input
                    type="number"
                    min={5}
                    max={600}
                    step={5}
                    value={ivWorkSec}
                    onChange={(e) => setIvWorkSec(Math.max(5, Number(e.target.value) || 5))}
                    className="ui-field ui-field-sm"
                  />
                </label>
                <label className="ui-label">
                  Rest (s)
                  <input
                    type="number"
                    min={0}
                    max={600}
                    step={5}
                    value={ivRestSec}
                    onChange={(e) => setIvRestSec(Math.max(0, Number(e.target.value) || 0))}
                    className="ui-field ui-field-sm"
                  />
                </label>
                <label className="ui-label">
                  Rounds
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={ivRounds}
                    disabled={ivInfinite}
                    onChange={(e) => setIvRounds(Math.max(1, Number(e.target.value) || 1))}
                    className="ui-field ui-field-sm disabled:opacity-40"
                  />
                </label>
                <label className="ui-label justify-end">
                  <span className="opacity-0 sm:opacity-100">&nbsp;</span>
                  <button
                    type="button"
                    onClick={() => setIvInfinite((v) => !v)}
                    className={ivInfinite ? 'ui-chip ui-chip-active w-full justify-center' : 'ui-chip w-full justify-center'}
                  >
                    ∞ Infinite
                  </button>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-faint">Work presets</span>
                {WORK_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setIvWorkSec(s)}
                    className={s === ivWorkSec ? 'ui-chip ui-chip-active' : 'ui-chip'}
                  >
                    {s}s
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-faint">Rest presets</span>
                {REST_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setIvRestSec(s)}
                    className={s === ivRestSec ? 'ui-chip ui-chip-active' : 'ui-chip'}
                  >
                    {s}s
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-muted">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ivResetEachRound}
                    onChange={(e) => setIvResetEachRound(e.target.checked)}
                    className="rounded border-border bg-surface-2 text-accent focus:ring-accent/40"
                  />
                  Restart sequence each round
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ivSound}
                    onChange={(e) => setIvSound(e.target.checked)}
                    className="rounded border-border bg-surface-2 text-accent focus:ring-accent/40"
                  />
                  Sound + vibration cues
                </label>
              </div>

              <button type="button" onClick={startInterval} className="ui-btn-primary w-full">
                <span className="inline-flex items-center gap-1.5">
                  <IconPlay className="h-4 w-4" />
                  Start interval training
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span
                  className={
                    ivPhase === 'work'
                      ? 'ui-chip ui-chip-active'
                      : 'ui-chip bg-warn/15 text-warn ring-1 ring-warn/30'
                  }
                >
                  {ivPhase === 'work' ? 'Work — climbing' : 'Rest'}
                </span>
                <span className="ui-chip">
                  Round {ivRound}
                  {ivInfinite ? '' : ` / ${ivRounds}`}
                </span>
                {ivPaused && <span className="ui-chip">Paused</span>}
              </div>

              <IntervalRing
                fraction={ivFraction}
                time={fmtClock(ivRemainingMs)}
                phaseLabel={ivPhase === 'work' ? 'Climb' : 'Rest'}
                colorClass={ivPhase === 'work' ? 'text-accent' : 'text-warn'}
              />

              <div className="flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={togglePauseInterval} className="ui-btn-primary min-w-[7rem]">
                  {ivPaused ? 'Resume' : 'Pause'}
                </button>
                {ivPhase === 'rest' && !ivPaused && (
                  <button type="button" onClick={skipRest} className="ui-btn-ghost px-4">
                    Skip rest
                  </button>
                )}
                <button type="button" onClick={stopInterval} className="ui-btn-ghost px-3" title="Stop session">
                  <IconSquare className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
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
