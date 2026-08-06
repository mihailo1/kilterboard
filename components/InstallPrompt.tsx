'use client'

import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'kb-install-dismissed'

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia('(display-mode: standalone)').matches
  const ios = 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone
  return mq || Boolean(ios)
}

/**
 * Subtle install chip for Chromium / Android. Hidden once installed or dismissed.
 * iOS: show a gentle “Add to Home Screen” tip when not standalone.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosTip, setShowIosTip] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return
    } catch {
      /* private mode */
    }

    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onBip)

    const ua = navigator.userAgent
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
    if (ios && safari) {
      setShowIosTip(true)
      setVisible(true)
    }

    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  const dismiss = useCallback(() => {
    setVisible(false)
    setDeferred(null)
    setShowIosTip(false)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }, [])

  const install = useCallback(async () => {
    if (!deferred) return
    await deferred.prompt()
    try {
      await deferred.userChoice
    } catch {
      /* ignore */
    }
    setDeferred(null)
    setVisible(false)
  }, [deferred])

  if (!visible) return null

  return (
    <div className="install-chip" role="region" aria-label="Install app">
      <div className="install-chip-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={36} height={36} className="install-chip-icon" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-ink">Install Kilterboard</p>
          <p className="text-[11px] leading-snug text-muted">
            {showIosTip && !deferred
              ? 'Share → Add to Home Screen for the full app feel'
              : 'Add to your home screen · works offline-ready'}
          </p>
        </div>
        {deferred && (
          <button type="button" className="ui-btn-primary !rounded-xl !px-3 !py-2 text-xs" onClick={() => void install()}>
            Install
          </button>
        )}
        <button
          type="button"
          className="ui-btn-quiet !rounded-xl !px-2 !py-2 text-xs"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
