'use client'

import { Suspense, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ClimbList } from '@/components/ClimbList'
import { SetStudio } from '@/components/SetStudio'

export type HomeMode = 'climbs' | 'set'

export function HomeShell() {
  return (
    <Suspense
      fallback={
        <main className="ui-shell">
          <div className="h-14 animate-pulse rounded-[1.35rem] bg-surface/60" />
        </main>
      }
    >
      <HomeShellInner />
    </Suspense>
  )
}

function HomeShellInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const modeParam = searchParams.get('mode')
  const mode: HomeMode = modeParam === 'set' ? 'set' : 'climbs'

  const setMode = useCallback(
    (next: HomeMode) => {
      if (next === 'set') {
        router.replace(`${pathname}?mode=set`, { scroll: false })
        return
      }
      const qs = new URLSearchParams(searchParams.toString())
      qs.delete('mode')
      const s = qs.toString()
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  return (
    <main className="ui-shell">
      <header className="app-header">
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
            <p className="ui-eyebrow">Kilter · 12×12 + kickboard</p>
            <h1 className="app-header-title">
              {mode === 'set' ? 'Set' : 'Climbs'}
            </h1>
          </div>
        </div>

        {/* Desktop mode switch — mobile uses the floating dock */}
        <ModeSwitch mode={mode} onChange={setMode} />
      </header>

      {mode === 'climbs' ? <ClimbList /> : <SetStudio />}
    </main>
  )
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: HomeMode
  onChange: (m: HomeMode) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Main mode"
      className="mode-switch relative hidden grid-cols-2 gap-1 rounded-[1.35rem] border border-border bg-surface/90 p-1.5 shadow-[0_1px_0_rgb(255_255_255_/_0.04)_inset,0_12px_40px_-20px_rgb(0_0_0_/_0.5)] sm:grid"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-1.5 top-1.5 w-[calc(50%-0.375rem)] rounded-[1.1rem] bg-accent shadow-[0_1px_0_rgb(255_255_255_/_0.14)_inset,0_8px_24px_-10px_rgb(139_92_246_/_0.55)] transition-transform duration-300 ease-out"
        style={{
          transform:
            mode === 'climbs' ? 'translateX(0)' : 'translateX(calc(100% + 0.25rem))',
          left: '0.375rem',
        }}
      />
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'climbs'}
        onClick={() => onChange('climbs')}
        className={`relative z-10 rounded-[1.1rem] px-4 py-3 text-center text-sm font-semibold tracking-tight transition-colors sm:text-base ${
          mode === 'climbs' ? 'text-[#120f1c]' : 'text-muted hover:text-ink-soft'
        }`}
      >
        Climbs
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'set'}
        onClick={() => onChange('set')}
        className={`relative z-10 rounded-[1.1rem] px-4 py-3 text-center text-sm font-semibold tracking-tight transition-colors sm:text-base ${
          mode === 'set' ? 'text-[#120f1c]' : 'text-muted hover:text-ink-soft'
        }`}
      >
        Set
      </button>
    </div>
  )
}
