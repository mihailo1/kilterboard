'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Client-side navigation (next/link) never reaches the service worker as a
 * page request, so pages opened that way would be missing offline. After each
 * route change, ask the worker to keep a copy of the current URL.
 */
function Keeper() {
  const pathname = usePathname()
  const search = useSearchParams().toString()

  useEffect(() => {
    const worker = navigator.serviceWorker?.controller
    if (!worker || !navigator.onLine) return
    const url = search ? `${pathname}?${search}` : pathname
    const t = setTimeout(() => worker.postMessage({ type: 'KEEP_PAGE', url }), 1500)
    return () => clearTimeout(t)
  }, [pathname, search])

  return null
}

export function KeepPageOffline() {
  return (
    <Suspense fallback={null}>
      <Keeper />
    </Suspense>
  )
}
