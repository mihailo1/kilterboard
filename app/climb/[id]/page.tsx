import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BackToClimbs } from '@/components/BackToClimbs'
import { FramePlayer } from '@/components/FramePlayer'
import { OpenInSetButton } from '@/components/OpenInSetButton'
import { getBoardMeta, frameCount } from '@/lib/aurora/board'
import { getClimbById } from '@/lib/climbs'
import type { Climb } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

function climbFromQuery(
  id: string,
  sp: Record<string, string | string[] | undefined>,
): Climb | null {
  const frames = first(sp.frames)
  const name = first(sp.name)
  if (!frames || !name) return null

  const angle = Number(first(sp.angle) ?? '40')
  return {
    id,
    name,
    grade: first(sp.grade) || '—',
    angle: Number.isFinite(angle) ? angle : 40,
    frames,
    setter: first(sp.setter),
    notes: first(sp.notes),
    source: 'boardsesh',
  }
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { id } = await params
  const sp = await searchParams
  const climb = climbFromQuery(id, sp) ?? getClimbById(id)
  return {
    title: climb ? `${climb.name} · Kilterboard` : 'Climb · Kilterboard',
  }
}

export default async function ClimbPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const sp = await searchParams
  const climb = climbFromQuery(id, sp) ?? getClimbById(id)
  if (!climb) notFound()

  const meta = getBoardMeta()
  const frames = climb.frames ?? ''
  const nFrames = frameCount(frames)

  const from = first(sp.from)

  return (
    <main className="ui-shell">
      <div>
        <BackToClimbs from={from} />
      </div>

      <header className="app-header space-y-3">
        <h1 className="app-header-title text-2xl sm:text-3xl">{climb.name}</h1>
        {climb.notes && <p className="text-sm text-muted">{climb.notes}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-bold text-accent ring-1 ring-accent/25">
            {climb.grade}
          </span>
          <span className="ui-badge">@{climb.angle}°</span>
          {climb.setter && <span className="ui-badge">{climb.setter}</span>}
          {nFrames > 1 && (
            <span className="rounded-full bg-accent-soft/60 px-3 py-1 text-sm font-medium text-accent ring-1 ring-accent/20">
              {nFrames} frames
            </span>
          )}
        </div>
        <p className="ui-meta">
          {meta.layoutName} · {meta.sizeName}
        </p>
        <OpenInSetButton name={climb.name} frames={frames} />
      </header>

      <FramePlayer frames={frames} climbName={climb.name} />

      <p className="ui-meta leading-relaxed">
        Catalog:{' '}
        <a
          href="https://www.boardsesh.com"
          target="_blank"
          rel="noopener noreferrer"
          className="ui-link"
        >
          Boardsesh
        </a>{' '}
        daily snapshots
        {climb.source && climb.source !== 'boardsesh' && (
          <span className="text-faint"> ({climb.source})</span>
        )}
        {' · '}
        layout / BLE via Aurora BoardLib +{' '}
        <a
          href="https://github.com/Stevie-Ray/hangtime-grip-connect"
          target="_blank"
          rel="noopener noreferrer"
          className="ui-link"
        >
          grip-connect
        </a>
      </p>
    </main>
  )
}
