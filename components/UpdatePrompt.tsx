'use client'

import { useEffect, useState } from 'react'
import { acceptUpdate, postponeUpdate, useNotices } from '@/lib/notices'
import { shortVersion } from '@/lib/version'

const UPDATE_TIMEOUT_MS = 6000

/**
 * Small non-blocking banner while a new service worker waits. Nothing happens
 * until the user taps "Update"; "Later" hides it until the next app open.
 * Drafts and settings live in localStorage and are not touched by an update.
 */
export function UpdatePrompt() {
  const { update } = useNotices()
  const [busy, setBusy] = useState(false)
  const [stalled, setStalled] = useState(false)

  // If the new worker never takes over (no controllerchange), stop spinning.
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => {
      setBusy(false)
      setStalled(true)
    }, UPDATE_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [busy])

  if (!update) return null

  const label = update.version
    ? `New version ${shortVersion(update.version)} available`
    : 'A new version is available'

  return (
    <div className="notice-card notice-row" role="status" aria-live="polite">
      <p className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-ink">{label}</p>
      <button
        type="button"
        className="ui-btn-quiet !rounded-xl !px-3 !py-2 text-xs"
        onClick={postponeUpdate}
        disabled={busy}
      >
        Later
      </button>
      <button
        type="button"
        className="ui-btn-primary !rounded-xl !px-3 !py-2 text-xs"
        disabled={busy}
        onClick={() => {
          if (acceptUpdate()) {
            setStalled(false)
            setBusy(true)
          }
        }}
      >
        {busy ? 'Updating…' : stalled ? 'Try again' : 'Update'}
      </button>
    </div>
  )
}
