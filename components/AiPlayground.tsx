'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { generateBoulder, loadBoulderAi } from '@/lib/ai/boulder-ai'
import { applyPaintWithRules } from '@/lib/set-rules'
import { difficultyToGrade } from '@/lib/grades'
import {
  PaintBoard,
  holdsEqual,
  holdsToMap,
  mapToHolds,
  type PaintTool,
} from '@/components/PaintBoard'

/**
 * Hold-AR playground: generate + optional paint edit.
 * Feedback / Approve-tags removed (was for remix retrain loop).
 */
export function AiPlayground() {
  const [aiGrade, setAiGrade] = useState(16)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMeta, setAiMeta] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiReady, setAiReady] = useState(false)
  const [lastSeed, setLastSeed] = useState<number | null>(null)
  const [roleMap, setRoleMap] = useState<Map<number, number> | null>(null)
  const [originalMap, setOriginalMap] = useState<Map<number, number> | null>(
    null,
  )
  const [paintTool, setPaintTool] = useState<PaintTool>(13)
  const [ruleMsg, setRuleMsg] = useState<string | null>(null)

  useEffect(() => {
    void loadBoulderAi()
      .then((info) => {
        setAiReady(true)
        setAiMeta(
          info.builtAt
            ? `Hold AR · ONNX · ${info.builtAt.slice(0, 10)}`
            : 'Hold AR ready',
        )
      })
      .catch((e) => {
        setAiError(e instanceof Error ? e.message : 'AI failed to load')
      })
  }, [])

  const currentHoldsList = useMemo(
    () => (roleMap ? mapToHolds(roleMap) : []),
    [roleMap],
  )
  const originalHoldsList = useMemo(
    () => (originalMap ? mapToHolds(originalMap) : []),
    [originalMap],
  )
  const isEdited =
    !!roleMap &&
    !!originalMap &&
    !holdsEqual(currentHoldsList, originalHoldsList)

  const paintHold = (placementId: number) => {
    if (!roleMap) return
    const frames = [new Map(roleMap)]
    const result = applyPaintWithRules(frames, 0, placementId, paintTool)
    if (result.error) {
      setRuleMsg(result.error)
      window.setTimeout(() => setRuleMsg(null), 2200)
      return
    }
    setRoleMap(result.frames[0] ?? new Map())
    setRuleMsg(null)
  }

  const resetToAi = () => {
    if (!originalMap) return
    setRoleMap(new Map(originalMap))
    setRuleMsg(null)
  }

  const runAiGenerate = async () => {
    setAiBusy(true)
    setAiError(null)
    setRuleMsg(null)
    try {
      const result = await generateBoulder({
        model: 'hold-ar',
        grade: aiGrade,
      })
      const m = holdsToMap(result.holds)
      setRoleMap(new Map(m))
      setOriginalMap(new Map(m))
      setLastSeed(result.seed)
      setPaintTool(13)
      setAiMeta(
        [
          'hold-ar',
          `${result.meta.holdCount} holds`,
          `${result.meta.starts}S · ${result.meta.finishes}F`,
          `seed ${result.seed}`,
        ].join(' · '),
      )
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Generate failed')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <main className="ui-shell">
      <header className="app-header space-y-3">
        <div className="app-header-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon.svg"
            alt=""
            width={40}
            height={40}
            className="app-header-icon"
          />
          <div className="min-w-0">
            <p className="ui-eyebrow">Local ONNX · browser</p>
            <h1 className="app-header-title">Hold AR</h1>
          </div>
          <span className="ml-auto hidden rounded-full border border-border bg-surface/80 px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-faint sm:inline">
            playground
          </span>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Generate boulders with the on-device model and tweak holds with paint.
          Save drafts in{' '}
          <Link href="/?mode=set" className="text-accent hover:text-accent-hover">
            Set
          </Link>
          .
        </p>
      </header>

      <div className="mt-6 flex flex-col gap-4">
        <section className="ui-card w-full space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="ui-label !flex-row">Board</p>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
              {isEdited && (
                <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 font-medium text-amber-100">
                  edited
                </span>
              )}
              {lastSeed != null && <span>seed {lastSeed}</span>}
            </div>
          </div>

          {roleMap ? (
            <>
              <PaintBoard
                state={roleMap}
                original={originalMap}
                tool={paintTool}
                onToolChange={setPaintTool}
                onPaint={paintHold}
              />
              {ruleMsg && (
                <p className="text-xs text-amber-100">{ruleMsg}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="ui-btn-quiet text-xs"
                  onClick={resetToAi}
                  disabled={!isEdited}
                >
                  Reset to AI gen
                </button>
              </div>
            </>
          ) : (
            <div className="flex min-h-[min(70vw,28rem)] w-full items-center justify-center rounded-3xl border border-dashed border-border bg-canvas-soft/40 px-4 py-16 text-center text-sm text-faint">
              Generate a boulder — then paint holds if you want to tweak
            </div>
          )}
        </section>

        <section className="ui-card w-full space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="ui-label !flex-row">AI · Hold AR</p>
              <p className="mt-0.5 text-[11px] text-faint">
                Local ONNX transformer · generate and optionally edit
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
            className="ui-btn-primary w-full sm:w-auto sm:min-w-[12rem]"
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
                <code className="text-muted">
                  public/ai/boulder/hold-ar-v1.onnx
                </code>
              </span>
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
