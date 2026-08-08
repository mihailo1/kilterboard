'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  listHrefFromQuery,
  readStoredListQuery,
  writeStoredListQuery,
} from '@/lib/climb-list-url'

interface BackToClimbsProps {
  /** Decoded `from` search param from the climb URL (list query string). */
  from?: string | null
}

/** “All climbs” — restores prior list filters via `from` or sessionStorage. */
export function BackToClimbs({ from }: BackToClimbsProps) {
  const [href, setHref] = useState(() => listHrefFromQuery(from))

  useEffect(() => {
    if (from) {
      writeStoredListQuery(from)
      setHref(listHrefFromQuery(from))
      return
    }
    const stored = readStoredListQuery()
    if (stored) setHref(listHrefFromQuery(stored))
  }, [from])

  return (
    <Link href={href} className="ui-link inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden>←</span> All climbs
    </Link>
  )
}
