'use client'

import { useCallback, useEffect, useState } from 'react'
import type { BoardHold, BluetoothStatus } from '@/types'
import { holdsToLedPlacements } from '@/lib/aurora/board'
import {
  clearLeds,
  connectAndSetLeds,
  disconnectBoard,
  getDeviceName,
  isBoardConnected,
  setLeds,
} from '@/lib/aurora/device'
import {
  type BleEnvironment,
  detectBleEnvironment,
  IOS_WEBBLE_APP_STORE_URL,
  waitForWebBluetooth,
} from '@/lib/aurora/ble-env'

interface BluetoothSetProps {
  holds: BoardHold[]
  climbName?: string
}

/**
 * Connect & light holds using @hangtime/grip-connect AuroraBoard
 * (same approach as examples/aurora setupDevice).
 */
export function BluetoothSet({ holds, climbName }: BluetoothSetProps) {
  const [status, setStatus] = useState<BluetoothStatus>('idle')
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** null while checking (the iOS Safari extension may inject after hydration). */
  const [env, setEnv] = useState<BleEnvironment | null>(null)

  useEffect(() => {
    let cancelled = false

    const detect = async () => {
      let next = detectBleEnvironment()
      if (next === 'ios-safari' && (await waitForWebBluetooth())) next = 'supported'
      if (cancelled) return
      setEnv(next)
      if (next === 'supported' && isBoardConnected()) {
        setStatus('connected')
        setDeviceName(getDeviceName())
      }
    }
    void detect()

    // User may enable the Safari extension in Settings and come back to this tab.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void detect()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      // keep connection across route changes within session
    }
  }, [])

  const handleSet = useCallback(async () => {
    if (env !== 'supported') return
    setError(null)
    const placements = holdsToLedPlacements(holds)
    const already = isBoardConnected()
    setStatus(already ? 'setting' : 'connecting')
    try {
      if (already) {
        await setLeds(placements)
      } else {
        await connectAndSetLeds(placements)
      }
      setDeviceName(getDeviceName())
      setStatus('connected')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Bluetooth failed'
      if (/cancel|choos|NotFound/i.test(message)) {
        setStatus(isBoardConnected() ? 'connected' : 'idle')
        return
      }
      setError(message)
      setStatus('error')
    }
  }, [holds, env])

  const handleClear = useCallback(async () => {
    if (!isBoardConnected()) return
    setError(null)
    setStatus('setting')
    try {
      await clearLeds()
      setStatus('connected')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear')
      setStatus('error')
    }
  }, [])

  const handleDisconnect = useCallback(() => {
    disconnectBoard()
    setDeviceName(null)
    setStatus('idle')
    setError(null)
  }, [])

  const busy = status === 'connecting' || status === 'setting'
  const connected = status === 'connected' || (status === 'setting' && !!deviceName)

  if (env && env !== 'supported') {
    return <BluetoothUnavailable env={env} />
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSet}
          disabled={busy || env === null}
          className="ui-btn-primary"
        >
          <BluetoothIcon />
          {env === null
            ? 'Checking Bluetooth…'
            : busy
            ? status === 'connecting'
              ? 'Connecting…'
              : 'Setting…'
            : connected
              ? holds.length === 0
                ? 'Clear board'
                : `Set${climbName ? ` “${climbName}”` : ''}`
              : holds.length === 0
                ? 'Connect'
                : 'Connect & Set'}
        </button>

        {connected && (
          <>
            <button
              type="button"
              onClick={handleClear}
              disabled={busy}
              className="ui-btn-ghost"
            >
              Clear lights
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="ui-btn-quiet"
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      <p className="text-xs text-muted">
        {deviceName ? (
          <>
            Connected to <span className="text-ink-soft">{deviceName}</span>
            <span className="text-faint"> · Web Bluetooth / Aurora</span>
          </>
        ) : (
          <>
            Stand near the board, then tap Connect. Chrome/Edge, or Safari on
            iPhone/iPad with the iOSWebBLE extension. API level auto-detects from
            device name.
          </>
        )}
      </p>

      {error && (
        <p className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      )}
    </div>
  )
}

function BluetoothUnavailable({ env }: { env: Exclude<BleEnvironment, 'supported'> }) {
  const appStoreLink = (
    <a
      href={IOS_WEBBLE_APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-ink underline underline-offset-2"
    >
      iOSWebBLE
    </a>
  )

  return (
    <div className="rounded-2xl border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
      {env === 'ios-safari' && (
        <>
          <p>
            Safari needs the free {appStoreLink} extension to talk to the board.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Install {appStoreLink} from the App Store (iOS 26+).</li>
            <li>
              Settings → Apps → Safari → Extensions → turn it on and set{' '}
              <strong className="text-ink">Other Websites</strong> to{' '}
              <strong className="text-ink">Allow</strong>.
            </li>
            <li>
              Back here, tap the page menu in the address bar → the extension →{' '}
              <strong className="text-ink">Allow on Every Website</strong>, then reload.
            </li>
          </ol>
        </>
      )}
      {env === 'ios-standalone' && (
        <p>
          Bluetooth does not work in the Home Screen app. Open this page in a{' '}
          <strong className="text-ink">Safari</strong> tab with the {appStoreLink}{' '}
          extension enabled.
        </p>
      )}
      {env === 'ios-other-browser' && (
        <p>
          This browser cannot use Bluetooth on iOS. Open this page in{' '}
          <strong className="text-ink">Safari</strong> with the {appStoreLink} extension
          enabled.
        </p>
      )}
      {env === 'unsupported' && (
        <p>
          Web Bluetooth is not available. Open this app in{' '}
          <strong className="text-ink">Chrome</strong> or{' '}
          <strong className="text-ink">Edge</strong> on desktop/Android (HTTPS or
          localhost), or in Safari on iPhone/iPad with the {appStoreLink} extension.
        </p>
      )}
    </div>
  )
}

function BluetoothIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z" />
    </svg>
  )
}
