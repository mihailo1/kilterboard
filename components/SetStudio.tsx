'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  boardHoldAt,
  encodeFramesFromStates,
  getBoardMeta,
  holdsFromRoleMap,
  holdsToLedPlacements,
  listEditablePlacements,
} from '@/lib/aurora/board'
import { BluetoothSet } from '@/components/BluetoothSet'
import {
  isBoardConnected,
  setLeds,
} from '@/lib/aurora/device'
import { ROLE_DISPLAY } from '@/lib/roles'
import { applyPaintWithRules } from '@/lib/set-rules'
import {
  deleteDraft,
  framesFromSerializable,
  getActiveDraftId,
  getDraft,
  isDraftDirty,
  listDrafts,
  namelessDraftTitle,
  newDraftId,
  type SetDraft,
  type SetKind,
  upsertDraft,
} from '@/lib/set-drafts'
import { generateBoulder, loadBoulderAi } from '@/lib/ai/boulder-ai'
import { difficultyToGrade } from '@/lib/grades'
import type { HoldRole, HoldRoleId } from '@/types'
import Link from 'next/link'

type PaintTool = HoldRoleId | 'erase'
/** palette = pick tool then tap; gesture = hold + swipe direction for role */
type InputMode = 'palette' | 'gesture'

const INPUT_MODE_KEY = 'kilterboard:set-input-mode:v1'

const ROLE_TOOLS: { id: HoldRoleId; role: HoldRole; short: string; hint: string }[] =
  [
    { id: 12, role: 'start', short: 'Start', hint: 'S · max 2 · first frames' },
    { id: 13, role: 'hand', short: 'Hand', hint: 'H' },
    { id: 14, role: 'finish', short: 'Finish', hint: 'F · max 2 · last frames' },
    { id: 15, role: 'foot', short: 'Foot', hint: 'T' },
  ]

function loadInputMode(): InputMode {
  if (typeof window === 'undefined') return 'gesture'
  const v = localStorage.getItem(INPUT_MODE_KEY)
  return v === 'palette' ? 'palette' : 'gesture'
}

function saveInputMode(mode: InputMode) {
  if (typeof window === 'undefined') return
  localStorage.setItem(INPUT_MODE_KEY, mode)
}

type GestureZone = 'center' | 'up' | 'right' | 'down' | 'left'

/** Direction from drag; distance &lt; deadPx → center (erase). */
function zoneFromDelta(dx: number, dy: number, deadPx: number): GestureZone {
  const dist = Math.hypot(dx, dy)
  if (dist < deadPx) return 'center'
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left'
  }
  return dy > 0 ? 'down' : 'up'
}

function toolFromZone(zone: GestureZone): PaintTool {
  if (zone === 'center') return 'erase'
  if (zone === 'up') return 12
  if (zone === 'right') return 13
  if (zone === 'down') return 14
  return 15
}

function cloneMap(m: Map<number, number>): Map<number, number> {
  return new Map(m)
}

function emptyFrame(): Map<number, number> {
  return new Map()
}

function formatDraftWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function SetStudio() {
  const meta = getBoardMeta()
  const placements = useMemo(() => listEditablePlacements(), [])
  const hydrated = useRef(false)

  const [draftId, setDraftId] = useState(() => newDraftId())
  const [kind, setKind] = useState<SetKind>('boulder')
  const [tool, setTool] = useState<PaintTool>(13)
  const [frames, setFrames] = useState<Map<number, number>[]>(() => [emptyFrame()])
  const [frameIndex, setFrameIndex] = useState(0)
  const [name, setName] = useState('')
  const [ruleMsg, setRuleMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [drafts, setDrafts] = useState<SetDraft[]>([])
  const [showDrafts, setShowDrafts] = useState(false)
  const [inputMode, setInputMode] = useState<InputMode>('gesture')
  const [pushBle, setPushBle] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [aiGrade, setAiGrade] = useState(16)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMeta, setAiMeta] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiReady, setAiReady] = useState(false)
  const createdAtRef = useRef(new Date().toISOString())

  // Restore active draft + input mode on mount
  useEffect(() => {
    setInputMode(loadInputMode())
    const activeId = getActiveDraftId()
    const d = activeId ? getDraft(activeId) : null
    if (d) {
      setDraftId(d.id)
      setName(d.name.startsWith('Nameless draft') ? '' : d.name)
      setKind(d.kind)
      setFrames(framesFromSerializable(d.frames))
      setFrameIndex(Math.min(d.frameIndex, Math.max(0, d.frames.length - 1)))
      createdAtRef.current = d.createdAt
    }
    setDrafts(listDrafts())
    hydrated.current = true

    void loadBoulderAi()
      .then((info) => {
        setAiReady(true)
        setAiMeta(
          info.builtAt
            ? `Hold AR · local ONNX · ${info.builtAt.slice(0, 10)}`
            : 'Hold AR ready',
        )
      })
      .catch((e) => {
        setAiError(e instanceof Error ? e.message : 'AI failed to load')
      })
  }, [])

  const setInputModePersist = (mode: InputMode) => {
    setInputMode(mode)
    saveInputMode(mode)
  }

  const safeIndex = Math.min(frameIndex, Math.max(0, frames.length - 1))
  const current = frames[safeIndex] ?? emptyFrame()

  const holds = useMemo(() => holdsFromRoleMap(current), [current])
  const framesString = useMemo(() => encodeFramesFromStates(frames), [frames])
  const dirty = isDraftDirty(frames)

  // Auto-push LEDs when frame/holds change (if connected)
  useEffect(() => {
    if (!pushBle || !isBoardConnected()) return
    if (holds.length === 0) return
    void setLeds(holdsToLedPlacements(holds)).catch(() => {})
  }, [holds, pushBle, safeIndex])

  // Multi-frame play advances editor frame
  useEffect(() => {
    if (!playing || frames.length <= 1) return
    const id = window.setTimeout(() => {
      setFrameIndex((i) => {
        if (i + 1 < frames.length) return i + 1
        setPlaying(false)
        return i
      })
    }, 1500)
    return () => window.clearTimeout(id)
  }, [playing, safeIndex, frames.length])

  const roleCounts = useMemo(() => {
    const c: Record<HoldRole, number> = {
      start: 0,
      hand: 0,
      finish: 0,
      foot: 0,
    }
    for (const h of holds) c[h.role] = (c[h.role] ?? 0) + 1
    return c
  }, [holds])

  // Auto-save draft whenever user has started setting
  useEffect(() => {
    if (!hydrated.current) return
    if (!dirty && !name.trim()) return

    const t = window.setTimeout(() => {
      const displayName = name.trim() || namelessDraftTitle(new Date(createdAtRef.current))
      upsertDraft({
        id: draftId,
        name: displayName,
        kind: frames.length > 1 ? 'route' : kind,
        frames,
        frameIndex: safeIndex,
        createdAt: createdAtRef.current,
      })
      // Keep input empty for nameless until user types — but store real title
      if (!name.trim()) {
        // show nameless title in drafts list only; leave field as placeholder
      }
      setDrafts(listDrafts())
    }, 400)
    return () => window.clearTimeout(t)
  }, [draftId, name, kind, frames, safeIndex, dirty])

  const flashRule = (msg: string) => {
    setRuleMsg(msg)
    window.setTimeout(() => setRuleMsg(null), 2800)
  }

  const paintHold = useCallback(
    (placementId: number) => {
      const result = applyPaintWithRules(frames, safeIndex, placementId, tool)
      if (result.error) {
        flashRule(result.error)
        return
      }
      setFrames(result.frames)
      if (result.frames.length > 1) setKind('route')
    },
    [frames, safeIndex, tool],
  )

  const clearFrame = () => {
    setFrames((prev) => {
      let next = prev.map(cloneMap)
      const ids = [...(next[safeIndex]?.keys() ?? [])]
      for (const id of ids) {
        next = applyPaintWithRules(next, safeIndex, id, 'erase').frames
      }
      return next
    })
  }

  const clearAllHolds = () => {
    setFrames([emptyFrame()])
    setFrameIndex(0)
  }

  const newDraft = () => {
    const id = newDraftId()
    createdAtRef.current = new Date().toISOString()
    setDraftId(id)
    setName('')
    setKind('boulder')
    setFrames([emptyFrame()])
    setFrameIndex(0)
    setDrafts(listDrafts())
  }

  const loadDraft = (d: SetDraft) => {
    setDraftId(d.id)
    setName(d.name.startsWith('Nameless draft') ? '' : d.name)
    setKind(d.kind)
    setFrames(framesFromSerializable(d.frames))
    setFrameIndex(Math.min(d.frameIndex, Math.max(0, d.frames.length - 1)))
    createdAtRef.current = d.createdAt
    setShowDrafts(false)
    // ensure active
    upsertDraft({
      id: d.id,
      name: d.name,
      kind: d.kind,
      frames: framesFromSerializable(d.frames),
      frameIndex: d.frameIndex,
      createdAt: d.createdAt,
    })
  }

  const removeDraft = (id: string) => {
    deleteDraft(id)
    setDrafts(listDrafts())
    if (id === draftId) newDraft()
  }

  const addFrame = () => {
    setFrames((prev) => {
      const last = prev[prev.length - 1] ?? emptyFrame()
      return [...prev.map(cloneMap), cloneMap(last)]
    })
    setFrameIndex(frames.length)
    setKind('route')
  }

  const removeFrame = () => {
    if (frames.length <= 1) return
    setFrames((prev) => {
      const next = prev.filter((_, idx) => idx !== safeIndex)
      return next.length ? next : [emptyFrame()]
    })
    setFrameIndex((i) => Math.max(0, Math.min(i, frames.length - 2)))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      ) {
        return
      }
      const k = e.key.toLowerCase()
      if (k === 's') setTool(12)
      else if (k === 'h') setTool(13)
      else if (k === 'f') setTool(14)
      else if (k === 't') setTool(15)
      else if (k === 'e' || k === 'backspace') setTool('erase')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const copyFrames = async () => {
    try {
      await navigator.clipboard.writeText(framesString)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      flashRule('Clipboard blocked')
    }
  }

  const openPreview = () => {
    if (!framesString) return
    const id = crypto.randomUUID().replace(/-/g, '')
    const title =
      name.trim() ||
      namelessDraftTitle(new Date(createdAtRef.current))
    const qs = new URLSearchParams({
      name: title,
      grade: '—',
      angle: '40',
      frames: framesString,
      setter: 'you',
    })
    window.open(`/climb/${id}?${qs.toString()}`, '_blank')
  }

  const runAiGenerate = async () => {
    setAiBusy(true)
    setAiError(null)
    try {
      const result = await generateBoulder({
        model: 'hold-ar',
        grade: aiGrade,
      })
      const m = new Map<number, number>()
      for (const [id, role] of result.holds) {
        m.set(id, role)
      }
      setFrames([m])
      setFrameIndex(0)
      setKind('boulder')
      setAiMeta(
        `hold-ar · ${result.meta.holdCount} holds · ${result.meta.starts} starts · ${result.meta.finishes} finishes · seed ${result.seed}`,
      )
      if (!name.trim()) {
        setName(`AI AR · ${difficultyToGrade(aiGrade)}`)
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Generate failed')
    } finally {
      setAiBusy(false)
    }
  }

  const climbName =
    name.trim() || namelessDraftTitle(new Date(createdAtRef.current))

  return (
    <div className="flex flex-col gap-4 pb-36 sm:pb-10">
      {/* Drafts bar */}
      <section className="ui-card space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="ui-btn-ghost text-xs"
            onClick={() => setShowDrafts((v) => !v)}
          >
            {showDrafts ? 'Hide drafts' : `Drafts (${drafts.length})`}
          </button>
          <button type="button" className="ui-btn-ghost text-xs" onClick={newDraft}>
            New
          </button>
          <span className="ml-auto text-[11px] text-faint">
            {dirty ? 'Auto-saved on this device' : 'Empty · starts as draft when you set'}
          </span>
        </div>

        {showDrafts && (
          <ul className="max-h-48 space-y-1 overflow-auto rounded-2xl border border-border bg-canvas-soft/40 p-1">
            {drafts.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted">No drafts yet</li>
            )}
            {drafts.map((d) => (
              <li
                key={d.id}
                className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${
                  d.id === draftId ? 'bg-accent-soft' : 'hover:bg-surface-2'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => loadDraft(d)}
                >
                  <span className="block truncate text-sm font-medium text-ink-soft">
                    {d.name}
                  </span>
                  <span className="text-[10px] text-faint">
                    {d.kind} · {d.frames.length} fr · {formatDraftWhen(d.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="ui-btn-quiet px-2 py-1 text-[10px]"
                  onClick={() => removeDraft(d.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-label !flex-row mr-1">Type</span>
          {(
            [
              { id: 'boulder' as const, label: 'Boulder', hint: '1 frame' },
              { id: 'route' as const, label: 'Route', hint: 'multi-frame' },
            ] as const
          ).map((k) => (
            <button
              key={k.id}
              type="button"
              title={k.hint}
              onClick={() => {
                setKind(k.id)
                if (k.id === 'boulder' && frames.length > 1) {
                  setFrames([cloneMap(frames[safeIndex] ?? emptyFrame())])
                  setFrameIndex(0)
                }
              }}
              className={kind === k.id ? 'ui-chip ui-chip-active' : 'ui-chip'}
            >
              {k.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] tabular-nums text-faint">
            {holds.length} lit
            {frames.length > 1
              ? ` · frame ${safeIndex + 1}/${frames.length}`
              : ''}
          </span>
        </div>

        {(kind === 'route' || frames.length > 1) && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="ui-btn-ghost px-3 py-2 text-xs"
              disabled={safeIndex <= 0}
              onClick={() => setFrameIndex((i) => Math.max(0, i - 1))}
            >
              ◀
            </button>
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
              {frames.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setFrameIndex(i)}
                  className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    i === safeIndex
                      ? 'bg-accent text-[#120f1c]'
                      : 'bg-surface-2 text-muted hover:text-ink-soft'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ui-btn-ghost px-3 py-2 text-xs"
              disabled={safeIndex >= frames.length - 1}
              onClick={() =>
                setFrameIndex((i) => Math.min(frames.length - 1, i + 1))
              }
            >
              ▶
            </button>
            <button
              type="button"
              className="ui-btn-primary px-3 py-2 text-xs"
              onClick={addFrame}
            >
              + Frame
            </button>
            <button
              type="button"
              className="ui-btn-quiet px-2 py-2 text-xs"
              disabled={frames.length <= 1}
              onClick={removeFrame}
              title="Remove this frame"
            >
              ✕
            </button>
          </div>
        )}

        <label className="ui-label">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={namelessDraftTitle(new Date(createdAtRef.current))}
            className="ui-field"
          />
        </label>

        {ruleMsg && (
          <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {ruleMsg}
          </p>
        )}
      </section>

      {/* Local AI — Hold AR ONNX only; feedback sandbox is /playground */}
      <section className="ui-card space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="ui-label !flex-row">AI · Hold AR</p>
            <p className="mt-0.5 text-[11px] text-faint">
              Local ONNX next-hold transformer · mask + polish · Web Worker
            </p>
          </div>
          {aiMeta && (
            <span className="text-[10px] text-muted">{aiMeta}</span>
          )}
        </div>

        <label className="ui-label">
          Grade
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={10}
                max={33}
                step={1}
                value={aiGrade}
                onChange={(e) => setAiGrade(Number(e.target.value))}
                className="w-full"
                aria-valuetext={difficultyToGrade(aiGrade)}
              />
              <span className="min-w-[4.5rem] shrink-0 text-right text-xs font-semibold text-accent">
                {difficultyToGrade(aiGrade)}
              </span>
            </div>
            <div className="flex justify-between text-[10px] text-faint">
              <span>4a/V0</span>
              <span className="text-muted">difficulty {aiGrade}</span>
              <span>8c+/V16</span>
            </div>
          </div>
        </label>

        <button
          type="button"
          onClick={() => void runAiGenerate()}
          disabled={aiBusy || !aiReady}
          className="ui-btn-primary w-full"
        >
          {aiBusy
            ? 'Generating…'
            : !aiReady
              ? 'Loading model…'
              : 'Generate boulder'}
        </button>

        {aiError && (
          <p className="text-xs text-rose-200">
            {aiError}
            <span className="mt-1 block text-faint">
              Needs{' '}
              <code className="text-muted">public/ai/boulder/hold-ar-v1.onnx</code>
              {' · '}export via{' '}
              <code className="text-muted">npm run ml:export-onnx</code>
            </span>
          </p>
        )}

        <p className="text-[11px] leading-snug text-faint">
          Sandbox without drafts:{' '}
          <Link
            href="/playground"
            className="font-medium text-accent hover:text-accent-hover"
          >
            /playground
          </Link>
          .
        </p>
      </section>

      {/* Connect above the only board */}
      <section className="ui-card space-y-3 p-4 sm:p-5">
        <h2 className="ui-label !flex-row">Light on board</h2>
        <BluetoothSet holds={holds} climbName={climbName} />
        {frames.length > 1 && (
          <>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={pushBle}
                onChange={(e) => setPushBle(e.target.checked)}
                className="rounded border-border bg-surface-2 text-accent"
              />
              Auto-update LEDs when frame changes (if connected)
            </label>
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border pt-3">
              <button
                type="button"
                className="ui-btn-ghost px-3"
                disabled={safeIndex <= 0}
                onClick={() => {
                  setPlaying(false)
                  setFrameIndex(0)
                }}
              >
                ⏮
              </button>
              <button
                type="button"
                className="ui-btn-ghost px-3"
                disabled={safeIndex <= 0}
                onClick={() => {
                  setPlaying(false)
                  setFrameIndex((i) => Math.max(0, i - 1))
                }}
              >
                ◀
              </button>
              <button
                type="button"
                className="ui-btn-primary min-w-[5.5rem]"
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                className="ui-btn-ghost px-3"
                disabled={safeIndex >= frames.length - 1}
                onClick={() => {
                  setPlaying(false)
                  setFrameIndex((i) => Math.min(frames.length - 1, i + 1))
                }}
              >
                ▶
              </button>
              <button
                type="button"
                className="ui-btn-ghost px-3"
                onClick={() => {
                  setPlaying(false)
                  setFrameIndex(frames.length - 1)
                }}
              >
                ⏭
              </button>
            </div>
          </>
        )}
      </section>

      {/* Input mode */}
      <section className="ui-card space-y-2 p-3 sm:p-4">
        <p className="ui-label !flex-row">Set method</p>
        <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-border bg-surface-2/50 p-1">
          <button
            type="button"
            onClick={() => setInputModePersist('gesture')}
            className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              inputMode === 'gesture'
                ? 'bg-accent text-[#120f1c]'
                : 'text-muted hover:text-ink-soft'
            }`}
          >
            Swipe
          </button>
          <button
            type="button"
            onClick={() => setInputModePersist('palette')}
            className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              inputMode === 'palette'
                ? 'bg-accent text-[#120f1c]'
                : 'text-muted hover:text-ink-soft'
            }`}
          >
            Palette
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-faint">
          {inputMode === 'gesture'
            ? 'Press a hold, drag ↑ Start · → Hand · ↓ Finish · ← Foot · stay in center or tap to erase.'
            : 'Pick a role below, then tap holds. Tap again to clear.'}
        </p>
      </section>

      {/* Interactive board (only board) */}
      <section className="ui-card overflow-hidden p-0">
        <div className="border-b border-border px-3 py-2 text-[11px] text-muted sm:px-4">
          {inputMode === 'gesture' ? 'Hold & swipe' : 'Tap to paint'} · start max
          2 · finish max 2 ·{' '}
          <span className="text-faint">{meta.sizeName}</span>
        </div>
        <InteractiveBoard
          placements={placements}
          state={current}
          tool={tool}
          inputMode={inputMode}
          onPaint={paintHold}
          onGesturePaint={(placementId, gestureTool) => {
            const result = applyPaintWithRules(
              frames,
              safeIndex,
              placementId,
              gestureTool,
            )
            if (result.error) {
              flashRule(result.error)
              return
            }
            setFrames(result.frames)
            if (result.frames.length > 1) setKind('route')
          }}
        />
      </section>

      {/* Sticky palette — only in palette mode */}
      <section className="ui-card sticky z-20 space-y-3 p-3 shadow-[0_12px_40px_-12px_rgb(0_0_0_/_0.65)] max-sm:bottom-[calc(var(--app-dock-clearance)+0.35rem)] sm:static sm:bottom-auto sm:p-4">
        {inputMode === 'palette' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                Paint tool
              </p>
              <div className="flex flex-wrap gap-1.5 text-[10px] text-faint">
                {ROLE_TOOLS.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: ROLE_DISPLAY[t.role].hex }}
                    />
                    {roleCounts[t.role]}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
              {ROLE_TOOLS.map((t) => {
                const active = tool === t.id
                const hex = ROLE_DISPLAY[t.role].hex
                return (
                  <button
                    key={t.id}
                    type="button"
                    title={t.hint}
                    onClick={() => setTool(t.id)}
                    className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-2xl border px-1 py-2 text-center transition active:scale-[0.97] sm:min-h-[3.75rem] ${
                      active
                        ? 'border-transparent shadow-[0_0_0_2px_var(--color-canvas),0_0_0_4px_var(--ring)]'
                        : 'border-border bg-surface-2 hover:bg-surface-3'
                    }`}
                    style={
                      active
                        ? ({
                            backgroundColor: `${hex}22`,
                            color: hex,
                            ['--ring' as string]: hex,
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    <span
                      className="h-3 w-3 rounded-full sm:h-3.5 sm:w-3.5"
                      style={{
                        backgroundColor: hex,
                        boxShadow: `0 0 10px ${hex}88`,
                      }}
                    />
                    <span className="text-[11px] font-bold sm:text-xs">
                      {t.short}
                    </span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setTool('erase')}
                className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-2xl border px-1 py-2 transition active:scale-[0.97] sm:min-h-[3.75rem] ${
                  tool === 'erase'
                    ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                    : 'border-border bg-surface-2 text-muted hover:bg-surface-3'
                }`}
              >
                <span className="text-sm">⌫</span>
                <span className="text-[11px] font-bold sm:text-xs">Erase</span>
              </button>
            </div>
          </>
        )}

        {inputMode === 'gesture' && (
          <div className="rounded-2xl border border-border bg-canvas-soft/40 p-3">
            <p className="mb-2 text-center text-[11px] font-medium text-muted">
              Swipe guide
            </p>
            <div className="mx-auto grid w-40 grid-cols-3 grid-rows-3 gap-1 text-center text-[10px] font-semibold">
              <span />
              <span className="rounded-lg py-2" style={{ color: ROLE_DISPLAY.start.hex }}>
                ↑ Start
              </span>
              <span />
              <span className="rounded-lg py-2" style={{ color: ROLE_DISPLAY.foot.hex }}>
                ← Foot
              </span>
              <span className="rounded-lg bg-rose-500/15 py-2 text-rose-200">
                · Erase
              </span>
              <span className="rounded-lg py-2" style={{ color: ROLE_DISPLAY.hand.hex }}>
                Hand →
              </span>
              <span />
              <span className="rounded-lg py-2" style={{ color: ROLE_DISPLAY.finish.hex }}>
                ↓ Finish
              </span>
              <span />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={clearFrame} className="ui-btn-ghost text-xs">
            Clear frame
          </button>
          <button type="button" onClick={clearAllHolds} className="ui-btn-quiet text-xs">
            Reset holds
          </button>
          <button
            type="button"
            onClick={copyFrames}
            disabled={!framesString}
            className="ui-btn-ghost text-xs"
          >
            {copied ? 'Copied frames' : 'Copy frames'}
          </button>
          <button
            type="button"
            onClick={openPreview}
            disabled={!framesString}
            className="ui-btn-ghost text-xs"
          >
            Open preview
          </button>
        </div>
      </section>
    </div>
  )
}

function InteractiveBoard({
  placements,
  state,
  tool,
  inputMode,
  onPaint,
  onGesturePaint,
}: {
  placements: ReturnType<typeof listEditablePlacements>
  state: Map<number, number>
  tool: PaintTool
  inputMode: InputMode
  onPaint: (placementId: number) => void
  onGesturePaint: (placementId: number, gestureTool: PaintTool) => void
}) {
  const meta = getBoardMeta()
  const { boardWidth, boardHeight, layers } = meta
  const wrapRef = useRef<HTMLDivElement>(null)

  const [gesture, setGesture] = useState<{
    placementId: number
    zone: GestureZone
  } | null>(null)
  const dragRef = useRef<{
    placementId: number
    startX: number
    startY: number
    pointerId: number
  } | null>(null)

  const painted = useMemo(() => {
    const map = new Map<number, { color: string; roleId: number }>()
    for (const [id, roleId] of state) {
      const h = boardHoldAt(id, roleId as HoldRoleId)
      if (h) map.set(id, { color: h.color, roleId })
    }
    return map
  }, [state])

  // Dead zone = erase; past that = direction. Sized for thumbs on phones.
  const DEAD = 44
  const PREVIEW_LOCK = 56

  const endGesture = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = clientX - drag.startX
      const dy = clientY - drag.startY
      const zone = zoneFromDelta(dx, dy, DEAD)
      onGesturePaint(drag.placementId, toolFromZone(zone))
      dragRef.current = null
      setGesture(null)
    },
    [onGesturePaint],
  )

  useEffect(() => {
    if (inputMode !== 'gesture') return

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      e.preventDefault()
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      // Slightly larger preview dead zone so HUD doesn’t jump early
      const zone = zoneFromDelta(dx, dy, PREVIEW_LOCK)
      setGesture({
        placementId: drag.placementId,
        zone,
      })
    }
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      endGesture(e.clientX, e.clientY)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [inputMode, endGesture])

  const startGesture = (placementId: number, e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      placementId,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
    }
    setGesture({
      placementId,
      zone: 'center',
    })
    try {
      wrapRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const cursor =
    inputMode === 'gesture'
      ? 'cursor-pointer'
      : tool === 'erase'
        ? 'cursor-cell'
        : 'cursor-crosshair'

  const hitProps = (placementId: number) =>
    inputMode === 'gesture'
      ? {
          onPointerDown: (e: ReactPointerEvent) =>
            startGesture(placementId, e),
        }
      : {
          onClick: () => onPaint(placementId),
          onPointerDown: (e: ReactPointerEvent) => {
            if (e.pointerType === 'touch') {
              e.preventDefault()
              onPaint(placementId)
            }
          },
        }

  return (
    <div ref={wrapRef} className={`relative w-full touch-none select-none ${cursor}`}>
      <svg
        viewBox={`0 0 ${boardWidth} ${boardHeight}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Set holds on board"
      >
        {layers.map((layer) => (
          <image
            key={layer.setId}
            href={layer.imageUrl}
            width={boardWidth}
            height={boardHeight}
          />
        ))}

        {placements.map((p) => {
          const hit = painted.get(p.placementId)
          if (hit) return null
          return (
            <circle
              key={`g-${p.placementId}`}
              cx={p.cx}
              cy={p.cy}
              r={p.r * 0.62}
              fill="rgb(255 255 255 / 0.05)"
              stroke="rgb(255 255 255 / 0.14)"
              strokeWidth={1.5}
              className="transition-opacity hover:fill-accent/20 hover:stroke-accent/50"
              {...hitProps(p.placementId)}
            />
          )
        })}

        {placements.map((p) => {
          const hit = painted.get(p.placementId)
          if (!hit) return null
          return (
            <circle
              key={`a-${p.placementId}`}
              cx={p.cx}
              cy={p.cy}
              r={p.r}
              fill={hit.color}
              fillOpacity={0.28}
              stroke={hit.color}
              strokeWidth={Math.max(4, Math.round(p.r / 5))}
              strokeOpacity={0.95}
              className="hold-marker"
              {...hitProps(p.placementId)}
            />
          )
        })}
      </svg>

      {/*
        Gesture HUD: always centered in the viewport (not under the finger),
        so it never clips off-screen. Safe top margin for notches.
      */}
      {gesture && (
        <div
          className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4"
          style={{
            top: 'max(4.5rem, calc(env(safe-area-inset-top, 0px) + 3.5rem))',
            bottom: 'max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 4rem))',
            alignItems: 'center',
          }}
          aria-hidden
        >
          <div className="relative aspect-square w-[min(72vw,17.5rem)] max-h-[min(52vh,17.5rem)]">
            {/* dim backdrop disc */}
            <div className="absolute inset-[8%] rounded-full bg-canvas/75 shadow-[0_16px_48px_-8px_rgb(0_0_0_/_0.65)] ring-1 ring-border backdrop-blur-md" />

            {(
              [
                {
                  zone: 'up' as const,
                  cls: 'left-1/2 top-[4%] -translate-x-1/2',
                  label: 'Start',
                  hex: ROLE_DISPLAY.start.hex,
                },
                {
                  zone: 'right' as const,
                  cls: 'right-[4%] top-1/2 -translate-y-1/2',
                  label: 'Hand',
                  hex: ROLE_DISPLAY.hand.hex,
                },
                {
                  zone: 'down' as const,
                  cls: 'bottom-[4%] left-1/2 -translate-x-1/2',
                  label: 'Finish',
                  hex: ROLE_DISPLAY.finish.hex,
                },
                {
                  zone: 'left' as const,
                  cls: 'left-[4%] top-1/2 -translate-y-1/2',
                  label: 'Foot',
                  hex: ROLE_DISPLAY.foot.hex,
                },
              ] as const
            ).map((arm) => {
              const active = gesture.zone === arm.zone
              return (
                <div
                  key={arm.zone}
                  className={`absolute min-w-[4.25rem] rounded-2xl px-3 py-2.5 text-center text-xs font-bold transition duration-100 sm:min-w-[4.75rem] sm:text-sm ${arm.cls} ${
                    active ? 'z-10 scale-110' : 'scale-100'
                  }`}
                  style={{
                    backgroundColor: active ? arm.hex : 'rgb(38 36 30 / 0.95)',
                    color: active ? '#120f1c' : arm.hex,
                    boxShadow: active
                      ? `0 0 0 3px ${arm.hex}55, 0 10px 28px rgb(0 0 0 / 0.5)`
                      : '0 8px 20px rgb(0 0 0 / 0.35)',
                  }}
                >
                  {arm.label}
                </div>
              )
            })}

            <div
              className={`absolute left-1/2 top-1/2 flex h-[4.5rem] w-[4.5rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-xs font-bold shadow-lg sm:h-[5rem] sm:w-[5rem] sm:text-sm ${
                gesture.zone === 'center'
                  ? 'bg-rose-500 text-white ring-[3px] ring-rose-300/80'
                  : 'bg-surface-2 text-rose-200 ring-1 ring-border'
              }`}
            >
              <span className="text-lg leading-none">⌫</span>
              <span>Erase</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
