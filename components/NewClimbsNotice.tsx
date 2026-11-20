'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { buildClimbHref } from '@/lib/climb-list-url'
import { setNotice } from '@/lib/notices'
import type { Climb } from '@/types'

const SEEN_KEY = 'kilterboard:climbs-seen-until'
const DELAY_MS = 2000 // after the update prompt and What's new had a chance
const MAX_LINKS = 5

function get(key: string): string | null | undefined {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return undefined // storage unavailable
  }
}

function set(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

interface NewClimbs {
  latest: string | null
  count: number
  climbs: Climb[]
}

/**
 * "N new climbs since your last visit".
 * - First visit: silently remember the newest publish date in the catalog.
 * - Later: if the catalog has climbs published after it, show them once and
 *   move the mark forward. Offline: nothing (no request, nothing recorded).
 */
export function NewClimbsNotice({ blocked }: { blocked: boolean }) {
  const [fresh, setFresh] = useState<NewClimbs | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (blocked || fresh || !navigator.onLine) return
    const since = get(SEEN_KEY)
    if (since === undefined) return
    let cancelled = false
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ limit: String(MAX_LINKS) })
      if (since) qs.set('since', since)
      fetch(`/api/climbs/new?${qs}`)
        .then((res) => (res.ok ? (res.json() as Promise<NewClimbs>) : null))
        .then((data) => {
          if (cancelled || !data?.latest) return
          if (!since) {
            set(SEEN_KEY, data.latest)
            return
          }
          if (data.count > 0) {
            set(SEEN_KEY, data.latest)
            setFresh(data)
          }
        })
        .catch(() => {})
    }, DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [blocked, fresh])

  useEffect(() => {
    setNotice({ newClimbs: !!fresh })
    return () => setNotice({ newClimbs: false })
  }, [fresh])

  if (!fresh || blocked) return null

  const dismiss = () => setFresh(null)
  const { count, climbs } = fresh

  return (
    <section className="notice-card" aria-label="New climbs">
      <div className="notice-row">
        <p className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-ink">
          {count === 1 ? '1 new climb' : `${count.toLocaleString()} new climbs`} since your last visit
        </p>
        {!open && (
          <button
            type="button"
            className="ui-btn-ghost !rounded-xl !px-3 !py-2 text-xs"
            onClick={() => setOpen(true)}
          >
            Show
          </button>
        )}
        <button
          type="button"
          className="ui-btn-quiet !rounded-xl !px-2 !py-2 text-xs"
          aria-label="Dismiss new climbs"
          onClick={dismiss}
        >
          ✕
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1 text-sm">
          {climbs.map((c) => (
            <li key={c.id}>
              <Link href={buildClimbHref(c)} className="ui-link" onClick={dismiss}>
                {c.name}
              </Link>
              <span className="text-faint">
                {' '}
                · {c.grade} @{c.angle}°
              </span>
            </li>
          ))}
          {count > climbs.length && (
            <li className="text-muted">
              and {(count - climbs.length).toLocaleString()} more. Sort Climbs by Newest to see them
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
