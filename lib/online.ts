'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'

function subscribe(l: () => void) {
  window.addEventListener('online', l)
  window.addEventListener('offline', l)
  return () => {
    window.removeEventListener('online', l)
    window.removeEventListener('offline', l)
  }
}

/** `navigator.onLine`, kept live. Server render assumes online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/** Run `fn` each time the connection comes back (offline → online). */
export function useOnReconnect(fn: () => void): void {
  const online = useOnline()
  const wasOffline = useRef(false)
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      return
    }
    if (wasOffline.current) {
      wasOffline.current = false
      latest.current()
    }
  }, [online])
}

/** Header set by public/sw.js on an /api response served from its cache. */
export const SW_CACHED_HEADER = 'x-kb-cached'
