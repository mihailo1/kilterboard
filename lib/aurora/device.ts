/**
 * Aurora / Kilter BLE via @hangtime/grip-connect (same stack as examples/aurora).
 * Auto-detects API level 2 vs 3 from device name (`@2` / `@3`).
 */

import { AuroraBoard, type AuroraLedPlacement } from '@hangtime/grip-connect'

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

/** Module-level board instance (browser only). */
let board: AuroraBoard | null = null

function getBoard(): AuroraBoard {
  if (!board) {
    board = new AuroraBoard()
  }
  return board
}

export function getDeviceName(): string | null {
  const b = board
  if (!b?.isConnected()) return null
  // Device model exposes bluetooth device when connected
  const anyBoard = b as AuroraBoard & { device?: BluetoothDevice }
  return anyBoard.device?.name ?? 'Aurora board'
}

export function isBoardConnected(): boolean {
  return !!board?.isConnected()
}

/**
 * Connect (picker) then light holds.
 * Mirrors hangtime setupDevice: connect → led(payload).
 */
export async function connectAndSetLeds(placements: AuroraLedPlacement[]): Promise<void> {
  if (!isWebBluetoothSupported()) {
    throw new Error(
      'Web Bluetooth is not supported. Use Chrome or Edge on desktop/Android (HTTPS or localhost).',
    )
  }

  const device = getBoard()

  if (device.isConnected()) {
    await device.led(placements)
    return
  }

  await new Promise<void>((resolve, reject) => {
    void device.connect(
      async () => {
        try {
          await device.led(placements)
          resolve()
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      },
      (error) => {
        reject(error)
      },
    )
  })
}

/** Re-send lights on an already-connected board. */
export async function setLeds(placements: AuroraLedPlacement[]): Promise<void> {
  const device = getBoard()
  if (!device.isConnected()) {
    await connectAndSetLeds(placements)
    return
  }
  await device.led(placements)
}

/** Clear all LEDs (empty placement list). */
export async function clearLeds(): Promise<void> {
  const device = getBoard()
  if (!device.isConnected()) return
  await device.led([])
}

export function disconnectBoard(): void {
  if (board?.isConnected()) {
    board.disconnect()
  }
}
