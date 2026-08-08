'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Climb } from '@/types'
import { DIFFICULTY_GRADES, GRADE_OPTIONS, gradeTone } from '@/lib/grades'
import {
  ASCENT_PRESETS,
  BOARDS_ESH_SORT_OPTIONS,
  CLIMB_KIND_OPTIONS,
  isClimbKind,
  QUALITY_PRESETS,
  type ClimbKind,
} from '@/lib/boardsesh-client'
import { DualRangeSlider, SingleRangeSlider } from '@/components/RangeSliders'
import { writeStoredListQuery } from '@/lib/climb-list-url'

const PAGE_SIZE = 25
const DEFAULT_MIN_DIFF = 10
const DEFAULT_MAX_DIFF = 33
const DEFAULT_ANGLE = 40
const DEFAULT_SORT = 'Popularity Desc'
const DEFAULT_KIND: ClimbKind = 'both'
const ANGLE_MIN = 0
const ANGLE_MAX = 70
const ANGLE_STEP = 5

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

interface MetaInfo {
  built_at?: string | null
  watermark_updated_at?: string | null
  subset_row_count?: number | null
  full_row_count?: number | null
}

interface FilterState {
  name: string
  setter: string
  angle: number
  /** When false, API gets angle=all and shows every angle */
  angleEnabled: boolean
  minDifficulty: number
  maxDifficulty: number
  sort: string
  minAscents: number
  minQuality: number
  /** boulders = 1 frame; routes = multi-frame; both = default */
  climbKind: ClimbKind
  numResults: number
}

function parseFiltersFromSearch(sp: URLSearchParams): FilterState {
  const angleRaw = sp.get('angle')
  /** Default: all angles (angle filter off) */
  let angleEnabled = false
  let angle = DEFAULT_ANGLE
  if (angleRaw === 'all' || angleRaw === '-1' || angleRaw == null || angleRaw === '') {
    angleEnabled = false
    angle = DEFAULT_ANGLE
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
  const kindRaw = (sp.get('kind') ?? sp.get('climbKind') ?? DEFAULT_KIND).toLowerCase()
  const climbKind: ClimbKind = isClimbKind(kindRaw)
    ? kindRaw
    : kindRaw === 'boulder'
      ? 'boulders'
      : kindRaw === 'route'
        ? 'routes'
        : DEFAULT_KIND
  const nRaw = Number(sp.get('n') ?? String(PAGE_SIZE))
  const numResults = Number.isFinite(nRaw)
    ? Math.min(100, Math.max(PAGE_SIZE, Math.round(nRaw)))
    : PAGE_SIZE

  return {
    name: sp.get('name') ?? '',
    setter: sp.get('setter') ?? '',
    angle,
    angleEnabled,
    minDifficulty: Math.min(minDiff, maxDiff),
    maxDifficulty: Math.max(minDiff, maxDiff),
    sort: sortOk ? sortRaw : DEFAULT_SORT,
    minAscents,
    minQuality,
    climbKind,
    numResults,
  }
}

/** Only non-default params — shareable URLs stay short. */
function filtersToSearchParams(f: {
  name: string
  setter: string
  angle: number
  angleEnabled: boolean
  minDifficulty: number
  maxDifficulty: number
  sort: string
  minAscents: number
  minQuality: number
  climbKind: ClimbKind
  numResults: number
}): URLSearchParams {
  const qs = new URLSearchParams()
  if (f.name.trim()) qs.set('name', f.name.trim())
  if (f.setter.trim()) qs.set('setter', f.setter.trim())
  // Default is all angles — only write when filtering to a specific angle
  if (f.angleEnabled) {
    qs.set('angle', String(f.angle))
  }
  if (f.sort !== DEFAULT_SORT) qs.set('sort', f.sort)
  if (f.minAscents > 0) qs.set('minAscents', String(f.minAscents))
  if (f.minDifficulty > DEFAULT_MIN_DIFF) {
    qs.set('minDifficulty', String(f.minDifficulty))
  }
  if (f.maxDifficulty < DEFAULT_MAX_DIFF) {
    qs.set('maxDifficulty', String(f.maxDifficulty))
  }
  if (f.minQuality > 0) qs.set('minQuality', String(f.minQuality))
  if (f.climbKind !== DEFAULT_KIND) qs.set('kind', f.climbKind)
  if (f.numResults > PAGE_SIZE) qs.set('n', String(f.numResults))
  return qs
}

export function ClimbList() {
  return (
    <Suspense fallback={<ClimbListSkeleton />}>
      <ClimbListInner />
    </Suspense>
  )
}

function ClimbListSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="h-64 animate-pulse rounded-3xl border border-border bg-surface/50" />
      <SkeletonList />
    </div>
  )
}

function ClimbListInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initial = useMemo(
    () => parseFiltersFromSearch(searchParams),
    // only seed once from first URL; later we own state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const [climbs, setClimbs] = useState<Climb[]>([])
  const [total, setTotal] = useState(0)
  const [meta, setMeta] = useState<MetaInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(
    () => initial.minQuality > 0,
  )
  /** Extra filters (type/angle/grade/…) expanded; auto-collapses on scroll down */
  const [filtersOpen, setFiltersOpen] = useState(true)
  const filtersOpenRef = useRef(true)
  const filtersPinnedOpen = useRef(false)
  const lastScrollY = useRef(0)
  /** Ignore scroll briefly after open/close — layout shift was causing expand/collapse jitter */
  const scrollIgnoreUntil = useRef(0)

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
  const [climbKind, setClimbKind] = useState<ClimbKind>(initial.climbKind)
  const [numResults, setNumResults] = useState(initial.numResults)

  const [nameQ, setNameQ] = useState(initial.name)
  const [setterQ, setSetterQ] = useState(initial.setter)
  const [setterSuggestions, setSetterSuggestions] = useState<string[]>([])
  const [setterSuggestOpen, setSetterSuggestOpen] = useState(false)
  const setterBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Skip resetting page when numResults itself caused the filter-key change */
  const skipPageReset = useRef(false)
  /** Last query string we wrote — ignore matching searchParams updates */
  const lastWrittenQs = useRef(filtersToSearchParams(initial).toString())

  /** Current list filters as query string (for climb detail `from` + sessionStorage). */
  const listQs = useMemo(
    () =>
      filtersToSearchParams({
        name: nameQ,
        setter: setterQ,
        angle: angleQ,
        angleEnabled,
        minDifficulty: minDiffQ,
        maxDifficulty: maxDiffQ,
        sort,
        minAscents,
        minQuality,
        climbKind,
        numResults,
      }).toString(),
    [
      nameQ,
      setterQ,
      angleQ,
      angleEnabled,
      minDiffQ,
      maxDiffQ,
      sort,
      minAscents,
      minQuality,
      climbKind,
      numResults,
    ],
  )

  const applyFilters = useCallback((p: FilterState) => {
    // Keep restored `n` — don't let the filter-change effect reset the page
    skipPageReset.current = true
    setName(p.name)
    setNameQ(p.name)
    setSetter(p.setter)
    setSetterQ(p.setter)
    setAngle(p.angle)
    setAngleQ(p.angle)
    setAngleEnabled(p.angleEnabled)
    setMinDifficulty(p.minDifficulty)
    setMaxDifficulty(p.maxDifficulty)
    setMinDiffQ(p.minDifficulty)
    setMaxDiffQ(p.maxDifficulty)
    setSort(p.sort)
    setMinAscents(p.minAscents)
    setMinQuality(p.minQuality)
    setClimbKind(p.climbKind)
    setNumResults(p.numResults)
    if (p.minQuality > 0) setAdvancedOpen(true)
  }, [])

  const setFiltersOpenStable = useCallback((open: boolean) => {
    if (filtersOpenRef.current === open) return
    filtersOpenRef.current = open
    setFiltersOpen(open)
    // Layout height change shifts scroll — ignore next scroll events briefly
    scrollIgnoreUntil.current = performance.now() + 280
  }, [])

  // Auto-collapse on scroll down only; expand only near page top (no scroll-up expand → no jitter)
  useEffect(() => {
    lastScrollY.current = typeof window !== 'undefined' ? window.scrollY : 0

    const onScroll = () => {
      const y = window.scrollY
      const prev = lastScrollY.current
      const delta = y - prev
      lastScrollY.current = y

      if (performance.now() < scrollIgnoreUntil.current) return

      // Near top — always expand, clear manual pin
      if (y < 40) {
        filtersPinnedOpen.current = false
        setFiltersOpenStable(true)
        return
      }

      // User manually expanded — keep open until they collapse or return to top
      if (filtersPinnedOpen.current) return

      // Scroll down past threshold — collapse once (hysteresis: need y > 140)
      if (delta > 6 && y > 140) {
        setFiltersOpenStable(false)
      }
      // Do NOT expand on scroll-up mid-page — that fought sticky height and jittered
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [setFiltersOpenStable])

  const toggleFiltersOpen = useCallback(() => {
    const next = !filtersOpenRef.current
    filtersPinnedOpen.current = next // pin only when manually opening
    if (!next) filtersPinnedOpen.current = false
    setFiltersOpenStable(next)
  }, [setFiltersOpenStable])

  useEffect(() => {
    const t = setTimeout(() => setNameQ(name), 300)
    return () => clearTimeout(t)
  }, [name])

  useEffect(() => {
    const t = setTimeout(() => setSetterQ(setter), 300)
    return () => clearTimeout(t)
  }, [setter])

  // Setter author autocomplete from local Boardsesh DB (no remote Boardsesh search API)
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

  // Reset pagination when filters change (not when loading more)
  useEffect(() => {
    if (skipPageReset.current) {
      skipPageReset.current = false
      return
    }
    setNumResults(PAGE_SIZE)
  }, [
    nameQ,
    setterQ,
    angleQ,
    angleEnabled,
    sort,
    minAscents,
    minDiffQ,
    maxDiffQ,
    minQuality,
    climbKind,
  ])

  // Sync filters → browser URL + sessionStorage (state is source of truth while interacting)
  useEffect(() => {
    writeStoredListQuery(listQs)
    if (listQs === lastWrittenQs.current) return
    lastWrittenQs.current = listQs
    const href = listQs ? `${pathname}?${listQs}` : pathname
    router.replace(href, { scroll: false })
  }, [listQs, pathname, router])

  // Browser back/forward: rehydrate when URL changes externally
  useEffect(() => {
    const current = searchParams.toString()
    if (current === lastWrittenQs.current) return
    const parsed = parseFiltersFromSearch(searchParams)
    lastWrittenQs.current = filtersToSearchParams(parsed).toString()
    applyFilters(parsed)
  }, [searchParams, applyFilters])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
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
      if (climbKind !== DEFAULT_KIND) qs.set('kind', climbKind)

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
    climbKind,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const builtLabel = meta?.built_at
    ? new Date(meta.built_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = []
    if (nameQ.trim()) {
      chips.push({
        key: 'name',
        label: `Name: ${nameQ.trim()}`,
        clear: () => setName(''),
      })
    }
    if (setterQ.trim()) {
      chips.push({
        key: 'setter',
        label: `Setter: ${setterQ.trim()}`,
        clear: () => setSetter(''),
      })
    }
    // Default is all angles — chip only when a specific angle is selected
    if (angleEnabled) {
      chips.push({
        key: 'angle',
        label: `${angleQ}°`,
        clear: () => {
          setAngleEnabled(false)
          setAngle(DEFAULT_ANGLE)
          setAngleQ(DEFAULT_ANGLE)
        },
      })
    }
    if (minAscents > 0) {
      chips.push({
        key: 'ascents',
        label: `≥${minAscents} ascents`,
        clear: () => setMinAscents(0),
      })
    }
    if (minDiffQ > DEFAULT_MIN_DIFF || maxDiffQ < DEFAULT_MAX_DIFF) {
      chips.push({
        key: 'grade',
        label: `${gradeLabel(minDiffQ)} – ${gradeLabel(maxDiffQ)}`,
        clear: () => {
          setMinDifficulty(DEFAULT_MIN_DIFF)
          setMaxDifficulty(DEFAULT_MAX_DIFF)
          setMinDiffQ(DEFAULT_MIN_DIFF)
          setMaxDiffQ(DEFAULT_MAX_DIFF)
        },
      })
    }
    if (minQuality > 0) {
      chips.push({
        key: 'quality',
        label: `★ ≥ ${minQuality}`,
        clear: () => setMinQuality(0),
      })
    }
    if (climbKind !== DEFAULT_KIND) {
      chips.push({
        key: 'kind',
        label: climbKind === 'boulders' ? 'Boulders' : 'Routes',
        clear: () => setClimbKind(DEFAULT_KIND),
      })
    }
    return chips
  }, [
    nameQ,
    setterQ,
    angleQ,
    angleEnabled,
    minAscents,
    minDiffQ,
    maxDiffQ,
    minQuality,
    climbKind,
  ])

  const clearAll = () => {
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
    setClimbKind(DEFAULT_KIND)
  }

  const activeChipsRow =
    activeChips.length > 0 ? (
      <div className="ui-divider flex flex-wrap items-center gap-1.5 pt-4">
        {activeChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={chip.clear}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-soft ring-1 ring-border transition hover:bg-surface-3"
          >
            {chip.label}
            <span className="text-faint">×</span>
          </button>
        ))}
        <button
          type="button"
          onClick={clearAll}
          className="ml-auto text-[11px] font-medium text-faint transition hover:text-accent"
        >
          Reset all
        </button>
      </div>
    ) : null

  return (
    <div className="flex flex-col gap-5">
      {/* Filters card — search always visible; extras unmount when collapsed (no gap) */}
      <section className="ui-card-sticky">
        {/* Search + collapse control */}
        <div className="flex items-start gap-2">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <label className="ui-label">
              Name
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input
                  type="search"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Search climbs…"
                  className="ui-field ui-field-with-icon"
                />
              </div>
            </label>
            <div className="ui-label relative">
              <span>Setter</span>
              <input
                type="search"
                value={setter}
                onChange={(e) => {
                  setSetter(e.target.value)
                  setSetterSuggestOpen(true)
                }}
                onFocus={() => {
                  if (setterBlurTimer.current) clearTimeout(setterBlurTimer.current)
                  setSetterSuggestOpen(true)
                }}
                onBlur={() => {
                  // Delay so click on suggestion registers
                  setterBlurTimer.current = setTimeout(
                    () => setSetterSuggestOpen(false),
                    150,
                  )
                }}
                placeholder="Username"
                className="ui-field"
                autoComplete="off"
                role="combobox"
                aria-expanded={
                  setterSuggestOpen && setterSuggestions.length > 0
                }
                aria-autocomplete="list"
              />
              {setterSuggestOpen && setterSuggestions.length > 0 && (
                <ul
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-auto rounded-2xl border border-border bg-surface-2 py-1 shadow-[0_12px_40px_-12px_rgb(0_0_0_/_0.65)]"
                >
                  {setterSuggestions.map((s) => (
                    <li key={s} role="option">
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm text-ink-soft transition hover:bg-accent-soft hover:text-accent"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSetter(s)
                          setSetterQ(s)
                          setSetterSuggestOpen(false)
                          setSetterSuggestions([])
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
            onClick={toggleFiltersOpen}
            className="mt-5 shrink-0 rounded-2xl border border-border bg-surface-2 px-2.5 py-2.5 text-muted transition hover:border-accent/30 hover:bg-surface-3 hover:text-accent sm:mt-6"
            aria-expanded={filtersOpen}
            aria-controls="climb-filters-extra"
            title={filtersOpen ? 'Hide filters' : 'Show filters'}
          >
            <ChevronIcon open={filtersOpen} />
          </button>
        </div>

        {/* Extra filters — only mounted when open (avoids flex gap on zero-height child) */}
        {filtersOpen && (
          <div id="climb-filters-extra" className="space-y-5">
            {/* Boulders vs routes */}
            <div className="space-y-2">
              <span className="ui-label !flex-row !items-center">Type</span>
              <div className="flex flex-wrap gap-1.5">
                {CLIMB_KIND_OPTIONS.map((opt) => {
                  const active = climbKind === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setClimbKind(opt.value)}
                      title={opt.hint}
                      className={active ? 'ui-chip ui-chip-active' : 'ui-chip'}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-faint">
                Boulders = one frame · Routes = multi-frame lead / circuit
              </p>
            </div>

            {/* Angle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="ui-label !flex-row">Angle</span>
                <div className="flex items-center gap-2">
                  {angleEnabled && (
                    <div className="flex items-center gap-1">
                      {[20, 30, 40, 50].map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => setAngle(a)}
                          className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold transition ${
                            angle === a
                              ? 'bg-accent-soft text-accent'
                              : 'text-faint hover:text-ink-soft'
                          }`}
                        >
                          {a}°
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!angleEnabled}
                    onClick={() => setAngleEnabled((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                      !angleEnabled
                        ? 'bg-accent-soft text-accent ring-1 ring-accent/30'
                        : 'bg-surface-2 text-muted hover:text-ink-soft'
                    }`}
                    title={
                      angleEnabled
                        ? 'Show climbs at every board angle'
                        : 'Filter by a single angle'
                    }
                  >
                    <span
                      className={`relative h-3.5 w-6 shrink-0 rounded-full transition ${
                        !angleEnabled ? 'bg-accent' : 'bg-faint/50'
                      }`}
                      aria-hidden
                    >
                      <span
                        className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-ink shadow transition ${
                          !angleEnabled ? 'left-3' : 'left-0.5'
                        }`}
                      />
                    </span>
                    All angles
                  </button>
                </div>
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
                <p className="rounded-2xl border border-border bg-canvas-soft/60 px-3.5 py-2.5 text-xs text-muted">
                  Showing every angle — grades & ascents are per-angle. Toggle
                  off to pick one.
                </p>
              )}
            </div>

            {/* Grade */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="ui-label !flex-row">Grade</span>
                <button
                  type="button"
                  onClick={() => {
                    setMinDifficulty(DEFAULT_MIN_DIFF)
                    setMaxDifficulty(DEFAULT_MAX_DIFF)
                  }}
                  className="text-[11px] font-medium text-faint transition hover:text-accent"
                >
                  Full range
                </button>
              </div>
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

            {/* Sort + ascents */}
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
                  {ASCENT_PRESETS.map((p) => {
                    const active = minAscents === p.value
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setMinAscents(p.value)}
                        className={active ? 'ui-chip ui-chip-active' : 'ui-chip'}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Advanced */}
            <div>
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="text-xs font-medium text-muted transition hover:text-accent"
              >
                {advancedOpen ? '▾ Less filters' : '▸ More filters'}
              </button>
              {advancedOpen && (
                <div className="mt-3 space-y-2">
                  <span className="ui-label !flex-row">Min quality</span>
                  <div className="flex flex-wrap gap-1.5">
                    {QUALITY_PRESETS.map((p) => {
                      const active = minQuality === p.value
                      return (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => setMinQuality(p.value)}
                          className={
                            active
                              ? 'ui-chip bg-warn/15 text-warn ring-1 ring-warn/30 hover:bg-warn/15 hover:text-warn'
                              : 'ui-chip'
                          }
                        >
                          {p.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Active filter chips — always visible when any filter is set (open or collapsed) */}
        {activeChipsRow}
      </section>

      {/* Result meta */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              Loading…
            </span>
          ) : (
            <>
              <strong className="font-semibold tabular-nums text-ink-soft">
                {total.toLocaleString()}
              </strong>
              <span>matches</span>
              {climbs.length > 0 && climbs.length < total && (
                <span className="text-faint">· showing {climbs.length}</span>
              )}
              {!angleEnabled && <span className="text-faint">· all angles</span>}
            </>
          )}
          {builtLabel && <span className="text-faint">· {builtLabel}</span>}
        </span>
        <a
          href="https://www.boardsesh.com"
          target="_blank"
          rel="noopener noreferrer"
          className="ui-link text-faint"
        >
          Boardsesh ↗
        </a>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {/* List */}
      <section className="flex flex-col gap-2.5">
        {loading && climbs.length === 0 && <SkeletonList />}

        {climbs.map((climb) => (
          <ClimbRow
            key={`${climb.id}-${climb.angle}`}
            climb={climb}
            listQs={listQs}
          />
        ))}

        {!loading && climbs.length === 0 && !error && (
          <div className="ui-empty">
            <p className="text-sm font-medium text-ink-soft">No climbs match</p>
            <p className="mt-1.5 text-xs text-faint">
              Try widening grade or min. ascents
            </p>
            <button
              type="button"
              onClick={clearAll}
              className="mt-5 text-xs font-semibold text-accent hover:text-accent-hover"
            >
              Reset filters
            </button>
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

function isRouteClimb(climb: Climb): boolean {
  return (climb.frameCount != null && climb.frameCount > 1) || climb.frames.includes(',"')
}

function ClimbRow({ climb, listQs }: { climb: Climb; listQs: string }) {
  const href = buildClimbHref(climb, listQs)
  const tone = gradeTone(climb.difficulty ?? null)
  const quality =
    climb.quality != null && climb.quality > 0 ? climb.quality.toFixed(1) : null

  return (
    <Link href={href} className="climb-row">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold leading-snug text-ink transition group-hover:text-accent sm:text-base">
          {climb.name}
        </h2>
        <p className="mt-1 truncate text-xs text-muted">
          {climb.setter || 'Unknown setter'}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          {climb.ascents != null && (
            <span className="rounded-lg bg-surface-2 px-1.5 py-0.5 ring-1 ring-border">
              {formatCount(climb.ascents)} ascents
            </span>
          )}
          {quality && (
            <span className="rounded-lg bg-surface-2 px-1.5 py-0.5 text-warn ring-1 ring-border">
              ★ {quality}
            </span>
          )}
          {isRouteClimb(climb) ? (
            <>
              {climb.moveCount != null && climb.moveCount > 0 && (
                <span
                  className="rounded-lg bg-surface-2 px-1.5 py-0.5 ring-1 ring-border"
                  title="Hand moves: unique hands; adjacent frames not double-counted"
                >
                  {climb.moveCount} moves
                </span>
              )}
              {climb.frameCount != null && climb.frameCount > 1 && (
                <span className="rounded-lg bg-accent-soft px-1.5 py-0.5 text-accent ring-1 ring-accent/20">
                  {climb.frameCount} frames
                </span>
              )}
            </>
          ) : (
            climb.holdCount != null &&
            climb.holdCount > 0 && (
              <span className="rounded-lg bg-surface-2 px-1.5 py-0.5 ring-1 ring-border">
                {climb.holdCount} holds
              </span>
            )
          )}
          {climb.publishedAt && (
            <span className="rounded-lg bg-surface-2 px-1.5 py-0.5 text-faint ring-1 ring-border">
              {climb.publishedAt.slice(0, 10)}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
          {climb.grade}
        </span>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[11px] font-medium text-faint">
            @{climb.angle}°
          </span>
          {isRouteClimb(climb) && (
            <span className="text-[10px] font-semibold text-accent/90">
              route
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

function SkeletonList() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-[92px] animate-pulse rounded-3xl border border-border bg-surface/50"
        />
      ))}
    </>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="m21 21-4.3-4.3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
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

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}

/**
 * Climb detail URL. Pass `listQs` (current `/?…` filters) so “All climbs”
 * can restore search/filters via the `from` param.
 */
export function buildClimbHref(climb: Climb, listQs = ''): string {
  const qs = new URLSearchParams({
    name: climb.name,
    grade: climb.grade,
    angle: String(climb.angle),
    frames: climb.frames,
  })
  if (climb.setter) qs.set('setter', climb.setter)
  if (climb.ascents != null)
    qs.set('notes', `${climb.ascents.toLocaleString()} ascents`)
  if (listQs) qs.set('from', listQs)
  return `/climb/${climb.id}?${qs.toString()}`
}
