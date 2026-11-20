'use client'

import { useSyncExternalStore } from 'react'

/*
 * Tiny shared store for in-app notices, so at most one is on screen.
 * Priority: update prompt > what's new > new climbs. The install chip hides
 * while any of them shows.
 *
 * - update: { worker, version } while a new service worker waits and the user
 *   has not chosen "Later" this session. Set by components/SWRegister.
 * - whatsNew / newClimbs: true while that card is showing.
 */

export interface UpdateNotice {
  worker: ServiceWorker
  version: string | null
}

export interface NoticeState {
  update: UpdateNotice | null
  whatsNew: boolean
  newClimbs: boolean
}

const SERVER: NoticeState = Object.freeze({ update: null, whatsNew: false, newClimbs: false })
let state: NoticeState = SERVER
const listeners = new Set<() => void>()

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function setNotice(patch: Partial<NoticeState>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useNotices(): NoticeState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  )
}

export function anyNotice(s: NoticeState): boolean {
  return !!s.update || s.whatsNew || s.newClimbs
}

let updateAccepted = false
const LATER_KEY = 'kilterboard:update-later'

/** True once the user tapped "Update" in this page (guards the reload). */
export function isUpdateAccepted(): boolean {
  return updateAccepted
}

/** User tapped "Update": let the waiting worker take over. */
export function acceptUpdate(): boolean {
  const worker = state.update?.worker
  if (!worker) return false
  updateAccepted = true
  worker.postMessage({ type: 'SKIP_WAITING' })
  return true
}

/** User tapped "Later": hide until the next app open (new session). */
export function postponeUpdate(): void {
  try {
    window.sessionStorage.setItem(LATER_KEY, state.update?.version || '?')
  } catch {
    // ignore
  }
  setNotice({ update: null })
}

export function wasPostponed(version: string | null): boolean {
  try {
    return window.sessionStorage.getItem(LATER_KEY) === (version || '?')
  } catch {
    return false
  }
}
