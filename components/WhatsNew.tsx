'use client'

import { useEffect, useState } from 'react'
import { CHANGELOG, type ChangelogEntry } from '@/lib/changelog'
import { setNotice } from '@/lib/notices'
import { APP_VERSION, compareVersions, shortVersion } from '@/lib/version'

const SEEN_KEY = 'kilterboard:last-seen-version'
const DELAY_MS = 1200 // let the update check run first (it has priority)

function readSeen(): { ok: boolean; value: string | null } {
  try {
    return { ok: true, value: window.localStorage.getItem(SEEN_KEY) }
  } catch {
    return { ok: false, value: null }
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, APP_VERSION)
  } catch {
    // ignore
  }
}

/** Used the app before this card existed: any of our keys in localStorage. */
function hasOldData(): boolean {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i) ?? ''
      if (k !== SEEN_KEY && (k.startsWith('kilterboard:') || k.startsWith('kb-'))) return true
    }
  } catch {
    // ignore
  }
  return false
}

/**
 * "What's new" card, once per version.
 * - Brand new user (no saved data, no last-seen version): record silently.
 * - Users from before this card (saved data, no last-seen version): show
 *   every listed release up to this one.
 * - Otherwise show every release newer than the last seen one.
 * Releases are listed oldest first. Recorded as seen when dismissed.
 */
export function WhatsNew({ blocked }: { blocked: boolean }) {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null)

  useEffect(() => {
    const seen = readSeen()
    if (!seen.ok) return // no storage: never nag
    let list: ChangelogEntry[] = []
    if (seen.value === null) {
      if (!hasOldData()) {
        markSeen()
        return
      }
      list = CHANGELOG.filter((e) => compareVersions(e.version, APP_VERSION) <= 0)
    } else if (compareVersions(seen.value, APP_VERSION) < 0) {
      const last = seen.value
      list = CHANGELOG.filter(
        (e) => compareVersions(e.version, last) > 0 && compareVersions(e.version, APP_VERSION) <= 0,
      )
    }
    list = list.filter((e) => !e.silent)
    if (!list.length) {
      if (seen.value !== APP_VERSION) markSeen()
      return
    }
    list = [...list].sort((a, b) => compareVersions(a.version, b.version))
    const t = setTimeout(() => setEntries(list), DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    setNotice({ whatsNew: !!entries })
    return () => setNotice({ whatsNew: false })
  }, [entries])

  if (!entries || blocked) return null

  const dismiss = () => {
    markSeen()
    setEntries(null)
  }
  const latest = entries[entries.length - 1]!

  return (
    <section className="notice-card notice-scroll" aria-labelledby="wn-title">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            What&apos;s new in {shortVersion(latest.version)}
          </p>
          <h2 id="wn-title" className="mt-0.5 text-base font-semibold tracking-tight text-ink">
            {latest.title}
          </h2>
        </div>
        <button
          type="button"
          className="ui-btn-quiet !rounded-xl !px-2 !py-2 text-xs"
          aria-label="Dismiss what's new"
          onClick={dismiss}
        >
          ✕
        </button>
      </div>
      {entries.map((e) => (
        <div key={e.version} className="mt-3">
          {entries.length > 1 && (
            <h3 className="text-xs font-semibold text-ink-soft">
              {shortVersion(e.version)} · {e.title}
            </h3>
          )}
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-snug text-ink-soft">
            {e.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
      <button type="button" className="ui-btn-primary mt-4 w-full justify-center" onClick={dismiss}>
        Got it
      </button>
    </section>
  )
}
