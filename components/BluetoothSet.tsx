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
  isWebBluetoothSupported,
  setLeds,
} from '@/lib/aurora/device'

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

  useEffect(() => {
    if (!isWebBluetoothSupported()) {
      setStatus('unsupported')
      return
    }
    if (isBoardConnected()) {
      setStatus('connected')
      setDeviceName(getDeviceName())
    }
    return () => {
      // keep connection across route changes within session
    }
  }, [])

  const handleSet = useCallback(async () => {
    if (status === 'unsupported') return
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
  }, [holds, status])

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

  if (status === 'unsupported') {
    return (
      <div className="rounded-2xl border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
        Web Bluetooth is not available. Open this app in <strong className="text-ink">Chrome</strong>{' '}
        or <strong className="text-ink">Edge</strong> on desktop/Android (HTTPS or
        localhost). Safari and iOS do not support it.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSet}
          disabled={busy || holds.length === 0}
          className="ui-btn-primary"
        >
          <BluetoothIcon />
          {busy
            ? status === 'connecting'
              ? 'Connecting…'
              : 'Setting…'
            : connected
              ? `Set${climbName ? ` “${climbName}”` : ''}`
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
            Stand near the board, then tap Connect. Chrome/Edge only (Web
            Bluetooth). API level auto-detects from device name.
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

function BluetoothIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z" />
    </svg>
  )
}
