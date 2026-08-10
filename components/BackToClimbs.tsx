'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  listBackLabel,
  listHrefFromQuery,
  readStoredListQuery,
  writeStoredListQuery,
} from '@/lib/climb-list-url'

interface BackToClimbsProps {
  /** Decoded `from` search param from the climb URL (list query string). */
  from?: string | null
}

/** Back to list — restores prior filters via `from` or sessionStorage. */
export function BackToClimbs({ from }: BackToClimbsProps) {
  const [href, setHref] = useState(() => listHrefFromQuery(from))
  const [label, setLabel] = useState(() => listBackLabel(from))

  useEffect(() => {
    if (from) {
      writeStoredListQuery(from)
      setHref(listHrefFromQuery(from))
      setLabel(listBackLabel(from))
      return
    }
    const stored = readStoredListQuery()
    if (stored) {
      setHref(listHrefFromQuery(stored))
      setLabel(listBackLabel(stored))
    }
  }, [from])

  return (
    <Link href={href} className="ui-link inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden>←</span> {label}
    </Link>
  )
}
