'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Climb } from '@/types'
import { DIFFICULTY_GRADES, GRADE_OPTIONS, gradeTone } from '@/lib/grades'
import {
  ASCENT_PRESETS,
  BOARDS_ESH_SORT_OPTIONS,
  QUALITY_PRESETS,
} from '@/lib/boardsesh-client'
import { DualRangeSlider, SingleRangeSlider } from '@/components/RangeSliders'
import { HoldPickBoard } from '@/components/HoldPickBoard'
import { writeStoredListQuery } from '@/lib/climb-list-url'
import { buildClimbHref } from '@/components/ClimbList'

const PAGE_SIZE = 25
const DEFAULT_MIN_DIFF = 10
const DEFAULT_MAX_DIFF = 33
const DEFAULT_ANGLE = 40
const DEFAULT_SORT = 'Popularity Desc'
const ANGLE_MIN = 0
const ANGLE_MAX = 70
const ANGLE_STEP = 5
/** Marker in list `from` so BackToClimbs returns to /holds */
export const HOLDS_VIEW_MARKER = 'view=holds'

function gradeLabel(d: number): string {
  return DIFFICULTY_GRADES[d] ?? String(d)
}

function clampAngle(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_ANGLE
  const stepped = Math.round(n / ANGLE_STEP) * ANGLE_STEP
  return Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, stepped))
}

function clampDiff(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MIN_DIFF
  return Math.min(DEFAULT_MAX_DIFF, Math.max(DEFAULT_MIN_DIFF, Math.round(n)))
}

function parseHolds(raw: string | null): number[] {
  if (!raw) return []
  return [
    ...new Set(
      raw
        .split(/[,+\s]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.floor(n)),
    ),
  ].slice(0, 40)
}

interface MetaInfo {
  built_at?: string | null
}

interface FilterState {
  holds: number[]
  name: string
  setter: string
  angle: number
  angleEnabled: boolean
  minDifficulty: number
  maxDifficulty: number
  sort: string
  minAscents: number
  minQuality: number
  numResults: number
}

function parseFromSearch(sp: URLSearchParams): FilterState {
  const angleRaw = sp.get('angle')
  let angleEnabled = false
  let angle = DEFAULT_ANGLE
  if (angleRaw === 'all' || angleRaw === '-1' || angleRaw == null || angleRaw === '') {
    angleEnabled = false
  } else {
    angleEnabled = true
    angle = clampAngle(Number(angleRaw))
  }
  const minDiff = sp.has('minDifficulty')
    ? clampDiff(Number(sp.get('minDifficulty')))
    : DEFAULT_MIN_DIFF
  const maxDiff = sp.has('maxDifficulty')
    ? clampDiff(Number(sp.get('maxDifficulty')))
    : DEFAULT_MAX_DIFF
  const sortRaw = sp.get('sort') ?? DEFAULT_SORT
  const sortOk = BOARDS_ESH_SORT_OPTIONS.some((s) => s.value === sortRaw)
  const minAscents = Math.max(0, Number(sp.get('minAscents') ?? '0') || 0)
  const minQuality = Math.max(0, Number(sp.get('minQuality') ?? '0') || 0)
  const nRaw = Number(sp.get('n') ?? String(PAGE_SIZE))
  const numResults = Number.isFinite(nRaw)
    ? Math.min(100, Math.max(PAGE_SIZE, Math.round(nRaw)))
    : PAGE_SIZE

  return {
    holds: parseHolds(sp.get('holds')),
    name: sp.get('name') ?? '',
    setter: sp.get('setter') ?? '',
    angle,
    angleEnabled,
    minDifficulty: Math.min(minDiff, maxDiff),
    maxDifficulty: Math.max(minDiff, maxDiff),
    sort: sortOk ? sortRaw : DEFAULT_SORT,
    minAscents,
    minQuality,
    numResults,
  }
}

function toSearchParams(f: FilterState): URLSearchParams {
  const qs = new URLSearchParams()
  qs.set('view', 'holds')
  if (f.holds.length) qs.set('holds', f.holds.join(','))
  if (f.name.trim()) qs.set('name', f.name.trim())
  if (f.setter.trim()) qs.set('setter', f.setter.trim())
  if (f.angleEnabled) qs.set('angle', String(f.angle))
  if (f.sort !== DEFAULT_SORT) qs.set('sort', f.sort)
  if (f.minAscents > 0) qs.set('minAscents', String(f.minAscents))
  if (f.minDifficulty > DEFAULT_MIN_DIFF) {
    qs.set('minDifficulty', String(f.minDifficulty))
  }
  if (f.maxDifficulty < DEFAULT_MAX_DIFF) {
    qs.set('maxDifficulty', String(f.maxDifficulty))
  }
  if (f.minQuality > 0) qs.set('minQuality', String(f.minQuality))
  if (f.numResults > PAGE_SIZE) qs.set('n', String(f.numResults))
  return qs
}

export function HoldSearch() {
  return (
    <Suspense
      fallback={
        <div className="h-64 animate-pulse rounded-3xl border border-border bg-surface/50" />
      }
    >
      <HoldSearchInner />
    </Suspense>
  )
}

function HoldSearchInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initial = useMemo(() => parseFromSearch(searchParams), [])

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initial.holds),
  )
  const [climbs, setClimbs] = useState<Climb[]>([])
  const [total, setTotal] = useState(0)
  const [meta, setMeta] = useState<MetaInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(
    () => initial.minQuality > 0,
  )
  const [filtersOpen, setFiltersOpen] = useState(true)

  const [name, setName] = useState(initial.name)
  const [setter, setSetter] = useState(initial.setter)
  const [angle, setAngle] = useState(initial.angle)
  const [angleEnabled, setAngleEnabled] = useState(initial.angleEnabled)
  const [minDifficulty, setMinDifficulty] = useState(initial.minDifficulty)
  const [maxDifficulty, setMaxDifficulty] = useState(initial.maxDifficulty)
  const [angleQ, setAngleQ] = useState(initial.angle)
  const [minDiffQ, setMinDiffQ] = useState(initial.minDifficulty)
  const [maxDiffQ, setMaxDiffQ] = useState(initial.maxDifficulty)
  const [sort, setSort] = useState(initial.sort)
  const [minAscents, setMinAscents] = useState(initial.minAscents)
  const [minQuality, setMinQuality] = useState(initial.minQuality)
  const [numResults, setNumResults] = useState(initial.numResults)
  const [nameQ, setNameQ] = useState(initial.name)
  const [setterQ, setSetterQ] = useState(initial.setter)
  const [setterSuggestions, setSetterSuggestions] = useState<string[]>([])
  const [setterSuggestOpen, setSetterSuggestOpen] = useState(false)
  const setterBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipPageReset = useRef(false)
  const lastWrittenQs = useRef(toSearchParams(initial).toString())

  const holdsKey = useMemo(
    () => [...selected].sort((a, b) => a - b).join(','),
    [selected],
  )

  const filterState: FilterState = useMemo(
    () => ({
      holds: holdsKey ? holdsKey.split(',').map(Number) : [],
      name: nameQ,
      setter: setterQ,
      angle: angleQ,
      angleEnabled,
      minDifficulty: minDiffQ,
      maxDifficulty: maxDiffQ,
      sort,
      minAscents,
      minQuality,
      numResults,
    }),
    [
      holdsKey,
      nameQ,
      setterQ,
      angleQ,
      angleEnabled,
      minDiffQ,
      maxDiffQ,
      sort,
      minAscents,
      minQuality,
      numResults,
    ],
  )

  const listQs = useMemo(() => toSearchParams(filterState).toString(), [filterState])

  useEffect(() => {
    const t = setTimeout(() => setNameQ(name), 300)
    return () => clearTimeout(t)
  }, [name])
  useEffect(() => {
    const t = setTimeout(() => setSetterQ(setter), 300)
    return () => clearTimeout(t)
  }, [setter])
  useEffect(() => {
    const t = setTimeout(() => setAngleQ(angle), 120)
    return () => clearTimeout(t)
  }, [angle])
  useEffect(() => {
    const t = setTimeout(() => {
      setMinDiffQ(minDifficulty)
      setMaxDiffQ(maxDifficulty)
    }, 120)
    return () => clearTimeout(t)
  }, [minDifficulty, maxDifficulty])

  useEffect(() => {
    const q = setter.trim()
    if (q.length < 1) {
      setSetterSuggestions([])
      return
    }
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/setters?q=${encodeURIComponent(q)}&limit=10`,
          )
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'suggest failed')
          setSetterSuggestions((data.setters as string[]) ?? [])
        } catch {
          setSetterSuggestions([])
        }
      })()
    }, 200)
    return () => clearTimeout(t)
  }, [setter])

  useEffect(() => {
    if (skipPageReset.current) {
      skipPageReset.current = false
      return
    }
    setNumResults(PAGE_SIZE)
  }, [
    holdsKey,
    nameQ,
    setterQ,
    angleQ,
    angleEnabled,
    sort,
    minAscents,
    minDiffQ,
    maxDiffQ,
    minQuality,
  ])

  useEffect(() => {
    writeStoredListQuery(listQs)
    if (listQs === lastWrittenQs.current) return
    lastWrittenQs.current = listQs
    const href = listQs ? `${pathname}?${listQs}` : pathname
    router.replace(href, { scroll: false })
  }, [listQs, pathname, router])

  useEffect(() => {
    const current = searchParams.toString()
    if (current === lastWrittenQs.current) return
    const parsed = parseFromSearch(searchParams)
    lastWrittenQs.current = toSearchParams(parsed).toString()
    setSelected(new Set(parsed.holds))
    setName(parsed.name)
    setNameQ(parsed.name)
    setSetter(parsed.setter)
    setSetterQ(parsed.setter)
    setAngle(parsed.angle)
    setAngleQ(parsed.angle)
    setAngleEnabled(parsed.angleEnabled)
    setMinDifficulty(parsed.minDifficulty)
    setMaxDifficulty(parsed.maxDifficulty)
    setMinDiffQ(parsed.minDifficulty)
    setMaxDiffQ(parsed.maxDifficulty)
    setSort(parsed.sort)
    setMinAscents(parsed.minAscents)
    setMinQuality(parsed.minQuality)
    setNumResults(parsed.numResults)
  }, [searchParams])

  const load = useCallback(async () => {
    if (!holdsKey) {
      setClimbs([])
      setTotal(0)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        holds: holdsKey,
        kind: 'boulders',
        name: nameQ,
        setter: setterQ,
        angle: angleEnabled ? String(angleQ) : 'all',
        sort,
        numResults: String(numResults),
        minAscents: String(minAscents),
      })
      if (minDiffQ > DEFAULT_MIN_DIFF) qs.set('minDifficulty', String(minDiffQ))
      if (maxDiffQ < DEFAULT_MAX_DIFF) qs.set('maxDifficulty', String(maxDiffQ))
      if (minQuality > 0) qs.set('minQuality', String(minQuality))

      const res = await fetch(`/api/climbs?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setClimbs(data.climbs as Climb[])
      setTotal(data.results_count as number)
      setMeta((data.meta as MetaInfo) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load climbs')
      setClimbs([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [
    holdsKey,
    nameQ,
    setterQ,
    angleQ,
    angleEnabled,
    sort,
    numResults,
    minAscents,
    minDiffQ,
    maxDiffQ,
    minQuality,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const toggleHold = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearHolds = () => setSelected(new Set())

  const clearAll = () => {
    clearHolds()
    setName('')
    setSetter('')
    setAngle(DEFAULT_ANGLE)
    setAngleQ(DEFAULT_ANGLE)
    setAngleEnabled(false)
    setSort(DEFAULT_SORT)
    setMinAscents(0)
    setMinDifficulty(DEFAULT_MIN_DIFF)
    setMaxDifficulty(DEFAULT_MAX_DIFF)
    setMinDiffQ(DEFAULT_MIN_DIFF)
    setMaxDiffQ(DEFAULT_MAX_DIFF)
    setMinQuality(0)
  }

  const builtLabel = meta?.built_at
    ? new Date(meta.built_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null

  return (
    <div className="flex flex-col gap-5">
      {/* Boulders-only notice */}
      <div className="rounded-2xl border border-accent/25 bg-accent-soft/40 px-4 py-3 text-sm text-ink-soft">
        <p className="font-semibold text-accent">Hold search · boulders only</p>
        <p className="mt-1 text-xs text-muted">
          Select holds on the board. Results are single-frame boulders that
          include <strong className="font-medium text-ink-soft">all</strong>{' '}
          selected holds (any role). Multi-frame routes are not searched.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-ink sm:text-[0.9375rem]">
            Select holds
          </h2>
          {selected.size > 0 ? (
            <button
              type="button"
              onClick={clearHolds}
              className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-muted ring-1 ring-border transition hover:bg-surface-3 hover:text-accent"
            >
              Clear holds
            </button>
          ) : (
            <span className="shrink-0 text-[11px] text-faint">Tap board</span>
          )}
        </div>
        <HoldPickBoard selected={selected} onToggle={toggleHold} />
      </div>

      <section className="ui-card-sticky space-y-3 sm:space-y-4">
        {/* Fields + compact filter chip on the same baseline (no extra row) */}
        <div className="flex items-end gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:gap-3">
            <label className="ui-label min-w-0">
              Name
              <input
                type="search"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                className="ui-field"
              />
            </label>
            <div className="ui-label relative min-w-0">
              <span>Setter</span>
              <input
                type="search"
                value={setter}
                onChange={(e) => {
                  setSetter(e.target.value)
                  setSetterSuggestOpen(true)
                }}
                onFocus={() => setSetterSuggestOpen(true)}
                onBlur={() => {
                  setterBlurTimer.current = setTimeout(
                    () => setSetterSuggestOpen(false),
                    150,
                  )
                }}
                placeholder="Setter"
                className="ui-field"
                autoComplete="off"
              />
              {setterSuggestOpen && setterSuggestions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-auto rounded-2xl border border-border bg-surface-2 py-1 shadow-lg">
                  {setterSuggestions.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm text-ink-soft hover:bg-accent-soft hover:text-accent"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSetter(s)
                          setSetterQ(s)
                          setSetterSuggestOpen(false)
                        }}
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className="ui-filter-chip"
            aria-expanded={filtersOpen}
            aria-controls="hold-search-filters"
            aria-label={filtersOpen ? 'Hide filters' : 'Show filters'}
            title={filtersOpen ? 'Hide filters' : 'Show filters'}
          >
            <FilterChevron open={filtersOpen} />
          </button>
        </div>

        {filtersOpen && (
          <div id="hold-search-filters" className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="ui-label !flex-row">Angle</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!angleEnabled}
                  onClick={() => setAngleEnabled((v) => !v)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    !angleEnabled
                      ? 'bg-accent-soft text-accent ring-1 ring-accent/30'
                      : 'bg-surface-2 text-muted'
                  }`}
                >
                  All angles
                </button>
              </div>
              {angleEnabled ? (
                <SingleRangeSlider
                  min={ANGLE_MIN}
                  max={ANGLE_MAX}
                  step={ANGLE_STEP}
                  value={angle}
                  onChange={setAngle}
                  formatValue={(v) => `${v}°`}
                  minLabel="0°"
                  maxLabel="70°"
                />
              ) : (
                <p className="text-xs text-muted">Showing every board angle.</p>
              )}
            </div>

            <div className="space-y-2">
              <span className="ui-label !flex-row">Grade</span>
              <DualRangeSlider
                min={DEFAULT_MIN_DIFF}
                max={DEFAULT_MAX_DIFF}
                step={1}
                minValue={minDifficulty}
                maxValue={maxDifficulty}
                onChange={(lo, hi) => {
                  setMinDifficulty(lo)
                  setMaxDifficulty(hi)
                }}
                formatValue={gradeLabel}
                minLabel={GRADE_OPTIONS[0]?.label}
                maxLabel={GRADE_OPTIONS[GRADE_OPTIONS.length - 1]?.label}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="ui-label">
                Sort
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="ui-field"
                >
                  {BOARDS_ESH_SORT_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="space-y-2">
                <span className="ui-label !flex-row">Min ascents</span>
                <div className="flex flex-wrap gap-1.5">
                  {ASCENT_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setMinAscents(p.value)}
                      className={
                        minAscents === p.value
                          ? 'ui-chip ui-chip-active'
                          : 'ui-chip'
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="text-xs font-medium text-muted hover:text-accent"
              >
                {advancedOpen ? '▾ Less filters' : '▸ More filters'}
              </button>
              {advancedOpen && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {QUALITY_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setMinQuality(p.value)}
                      className={
                        minQuality === p.value
                          ? 'ui-chip bg-warn/15 text-warn ring-1 ring-warn/30'
                          : 'ui-chip'
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {(selected.size > 0 ||
          nameQ ||
          setterQ ||
          angleEnabled ||
          minAscents > 0 ||
          minDiffQ > DEFAULT_MIN_DIFF ||
          maxDiffQ < DEFAULT_MAX_DIFF ||
          minQuality > 0) && (
          <div className="ui-divider flex flex-wrap gap-1.5 pt-3">
            {selected.size > 0 && (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent ring-1 ring-accent/25">
                {selected.size} hold{selected.size === 1 ? '' : 's'}
              </span>
            )}
            <button
              type="button"
              onClick={clearAll}
              className="ml-auto text-[11px] font-medium text-faint hover:text-accent"
            >
              Reset all
            </button>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))] text-xs text-muted">
        <span>
          {!holdsKey ? (
            <span className="text-faint">Select at least one hold to search</span>
          ) : loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              Loading…
            </span>
          ) : (
            <>
              <strong className="tabular-nums text-ink-soft">
                {total.toLocaleString()}
              </strong>{' '}
              boulders
              {climbs.length > 0 && climbs.length < total && (
                <span className="text-faint"> · showing {climbs.length}</span>
              )}
            </>
          )}
          {builtLabel && <span className="text-faint"> · {builtLabel}</span>}
        </span>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <section className="flex flex-col gap-2.5">
        {climbs.map((climb) => (
          <HoldClimbRow key={`${climb.id}-${climb.angle}`} climb={climb} listQs={listQs} />
        ))}
        {!loading && holdsKey && climbs.length === 0 && !error && (
          <div className="ui-empty">
            <p className="text-sm font-medium text-ink-soft">No boulders match</p>
            <p className="mt-1.5 text-xs text-faint">
              Try fewer holds or wider grade / angle
            </p>
          </div>
        )}
      </section>

      {climbs.length > 0 && climbs.length < total && (
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            skipPageReset.current = true
            setNumResults((n) => n + PAGE_SIZE)
          }}
          className="ui-btn-ghost w-full py-3.5"
        >
          {loading ? 'Loading…' : `Show more · ${PAGE_SIZE} more`}
        </button>
      )}
    </div>
  )
}

function FilterChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`h-4 w-4 transition-transform duration-300 ease-out ${open ? 'rotate-180' : ''}`}
      aria-hidden
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function HoldClimbRow({ climb, listQs }: { climb: Climb; listQs: string }) {
  const href = buildClimbHref(climb, listQs)
  const tone = gradeTone(climb.difficulty ?? null)
  const quality =
    climb.quality != null && climb.quality > 0 ? climb.quality.toFixed(1) : null

  return (
    <Link href={href} className="climb-row">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold text-ink group-hover:text-accent sm:text-base">
          {climb.name}
        </h2>
        <p className="mt-1 truncate text-xs text-muted">
          {climb.setter || 'Unknown setter'}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] text-muted">
          {climb.ascents != null && (
            <span className="rounded-lg bg-surface-2 px-1.5 py-0.5 ring-1 ring-border">
              {climb.ascents} ascents
            </span>
          )}
          {quality && (
            <span className="rounded-lg bg-surface-2 px-1.5 py-0.5 text-warn ring-1 ring-border">
              ★ {quality}
            </span>
          )}
          {climb.holdCount != null && climb.holdCount > 0 && (
            <span className="rounded-lg bg-surface-2 px-1.5 py-0.5 ring-1 ring-border">
              {climb.holdCount} holds
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
          {climb.grade}
        </span>
        <span className="text-[11px] text-faint">@{climb.angle}°</span>
      </div>
    </Link>
  )
}
