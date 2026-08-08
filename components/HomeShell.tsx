'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppBrand } from '@/components/AppBrand'
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
  const searchParams = useSearchParams()
  const mode: HomeMode = searchParams.get('mode') === 'set' ? 'set' : 'climbs'

  return (
    <main className="ui-shell">
      <header className="app-header">
        <AppBrand title={mode === 'set' ? 'Set' : 'Climbs'} />
      </header>

      {mode === 'climbs' ? <ClimbList /> : <SetStudio />}
    </main>
  )
}
