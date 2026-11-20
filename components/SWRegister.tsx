'use client'

import { useEffect } from 'react'
import { isUpdateAccepted, setNotice, wasPostponed } from '@/lib/notices'

/** Asks a worker for its VERSION (public/sw.js answers GET_VERSION). */
function askVersion(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const channel = new MessageChannel()
      const timer = setTimeout(() => resolve(null), 1500)
      channel.port1.onmessage = (e) => {
        clearTimeout(timer)
        resolve(typeof e.data?.version === 'string' ? e.data.version : null)
      }
      worker.postMessage({ type: 'GET_VERSION' }, [channel.port2])
    } catch {
      resolve(null)
    }
  })
}

/**
 * Registers the service worker (production only) and watches for a new
 * version waiting to take over. The new worker never activates on its own:
 * components/UpdatePrompt.tsx lets the user choose "Update" or "Later".
 * The page reloads once, and only after the user tapped "Update".
 */
export function SWRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const sw = navigator.serviceWorker

    if (process.env.NODE_ENV !== 'production') {
      // A worker left over from a local `next start` would serve stale assets
      // to `next dev` on the same origin. Drop it.
      sw.getRegistrations()
        .then((regs) => regs.forEach((r) => void r.unregister()))
        .catch(() => {})
      return
    }

    let reg: ServiceWorkerRegistration | undefined
    let reloading = false
    let disposed = false
    const offered = new WeakSet<ServiceWorker>()

    const offer = async (worker: ServiceWorker | null) => {
      // No controller means first install: that worker activates by itself.
      if (!worker || !sw.controller || offered.has(worker)) return
      offered.add(worker)
      const version = await askVersion(worker)
      if (disposed || reg?.waiting !== worker || wasPostponed(version)) return
      setNotice({ update: { worker, version } })
      worker.addEventListener('statechange', () => {
        if (worker.state === 'redundant') setNotice({ update: null })
      })
    }

    const track = (worker: ServiceWorker | null) => {
      if (!worker) return
      if (worker.state === 'installed') {
        void offer(worker)
        return
      }
      const onState = () => {
        if (worker.state === 'installed') void offer(worker)
        if (worker.state === 'installed' || worker.state === 'redundant') {
          worker.removeEventListener('statechange', onState)
        }
      }
      worker.addEventListener('statechange', onState)
    }

    const onUpdateFound = () => track(reg?.installing ?? null)

    const onControllerChange = () => {
      setNotice({ update: null })
      // Reload only for an update this page asked for, and only once. The
      // first install also fires controllerchange (clients.claim): ignored.
      if (!isUpdateAccepted() || reloading) return
      reloading = true
      window.location.reload()
    }

    // Home Screen apps resume rather than reload, so check on resume too.
    const checkForUpdate = () => {
      if (document.visibilityState !== 'visible' || !reg) return
      reg.update().catch(() => {})
    }

    const register = () => {
      sw.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((r) => {
          if (disposed) return
          reg = r
          if (r.waiting) void offer(r.waiting)
          track(r.installing)
          r.addEventListener('updatefound', onUpdateFound)
        })
        .catch(() => {})
    }

    sw.addEventListener('controllerchange', onControllerChange)
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
    document.addEventListener('visibilitychange', checkForUpdate)

    return () => {
      disposed = true
      window.removeEventListener('load', register)
      document.removeEventListener('visibilitychange', checkForUpdate)
      sw.removeEventListener('controllerchange', onControllerChange)
      reg?.removeEventListener('updatefound', onUpdateFound)
    }
  }, [])
  return null
}
