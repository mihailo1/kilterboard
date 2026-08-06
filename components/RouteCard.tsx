import Link from 'next/link'
import type { Climb } from '@/types'

interface RouteCardProps {
  climb: Climb
}

export function RouteCard({ climb }: RouteCardProps) {
  return (
    <Link
      href={`/climb/${climb.id}`}
      className="group block rounded-2xl border border-slate-800 bg-slate-900/80 p-4 transition hover:-translate-y-0.5 hover:border-sky-500/40 hover:bg-slate-900 hover:shadow-lg hover:shadow-sky-500/5"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-50 group-hover:text-sky-300">
            {climb.name}
          </h2>
          {climb.notes && <p className="mt-1 text-sm text-slate-400">{climb.notes}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-bold text-sky-300">
          {climb.grade}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-md bg-slate-800 px-2 py-1">@{climb.angle}°</span>
        {climb.setter && <span>{climb.setter}</span>}
        <span className="ml-auto text-slate-600 transition group-hover:text-sky-400">Open →</span>
      </div>
    </Link>
  )
}
