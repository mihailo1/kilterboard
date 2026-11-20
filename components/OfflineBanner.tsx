'use client'

import { useEffect, useState } from 'react'
import { useOnline } from '@/lib/online'

const BACK_ONLINE_MS = 2500

/** Pill while offline; a short "back online" note when the connection returns. */
export function OfflineBanner() {
  const online = useOnline()
  const [wasOffline, setWasOffline] = useState(false)
  const [backOnline, setBackOnline] = useState(false)

  useEffect(() => {
    if (!online) {
      setWasOffline(true)
      setBackOnline(false)
      return
    }
    if (!wasOffline) return
    setWasOffline(false)
    setBackOnline(true)
    const t = setTimeout(() => setBackOnline(false), BACK_ONLINE_MS)
    return () => clearTimeout(t)
  }, [online, wasOffline])

  if (online && !backOnline) return null

  return (
    <div
      className={`notice-pill ${online ? 'notice-pill-ok' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="notice-dot" aria-hidden />
      {online
        ? 'Back online. Loading climbs…'
        : "You're offline. Climbs will load when you're back online."}
    </div>
  )
}
