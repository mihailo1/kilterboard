/**
 * Client bridge → Hold AR Web Worker (local ONNX next-hold generator).
 *
 * Runtime: public/ai/boulder/hold-ar-worker.js
 * Model:   public/ai/boulder/hold-ar-v1.onnx
 * Index:   public/ai/boulder/placement_index.json
 * Coords:  public/ai/boulder/models.json (layout + optional rules)
 */

export type BoulderModelId = 'hold-ar'

export interface BoulderModelInfo {
  id: string
  name: string
  description: string
}

export interface GenerateResult {
  model: string
  seed: number
  holds: Array<[number, number]> // placementId, roleId
  meta: {
    holdCount: number
    starts: number
    finishes: number
  }
}

type WorkerMsg =
  | {
      type: 'ready'
      models: BoulderModelInfo[]
      climbCount?: number
      builtAt?: string
      backend?: string
    }
  | {
      type: 'result'
      model: string
      seed: number
      holds: Array<[number, number]>
      meta: GenerateResult['meta']
    }
  | { type: 'error'; error: string }

let worker: Worker | null = null
let readyPromise: Promise<{
  models: BoulderModelInfo[]
  builtAt?: string
}> | null = null

function ensureBrowser() {
  if (typeof window === 'undefined') {
    throw new Error('Hold AR only runs in the browser')
  }
}

function getWorker(): Worker {
  ensureBrowser()
  if (!worker) {
    worker = new Worker('/ai/boulder/hold-ar-worker.js')
  }
  return worker
}

/** Load ONNX session + placement index (call once on Set / Playground mount). */
export function loadBoulderAi(): Promise<{
  models: BoulderModelInfo[]
  builtAt?: string
}> {
  if (readyPromise) return readyPromise
  readyPromise = new Promise((resolve, reject) => {
    const w = getWorker()
    const onMsg = (ev: MessageEvent<WorkerMsg>) => {
      const data = ev.data
      if (data.type === 'ready') {
        w.removeEventListener('message', onMsg)
        resolve({ models: data.models, builtAt: data.builtAt })
      } else if (data.type === 'error') {
        w.removeEventListener('message', onMsg)
        readyPromise = null
        reject(new Error(data.error))
      }
    }
    w.addEventListener('message', onMsg)
    w.postMessage({ type: 'load' })
  })
  return readyPromise
}

/** @deprecated alias — same as loadBoulderAi */
export const loadHoldArAi = loadBoulderAi

export function generateBoulder(opts: {
  model?: BoulderModelId | string
  grade?: number
  seed?: number
  /** Softmax temperature (default 0.85) */
  temperature?: number
}): Promise<GenerateResult> {
  return loadBoulderAi().then(
    () =>
      new Promise((resolve, reject) => {
        const w = getWorker()
        const onMsg = (ev: MessageEvent<WorkerMsg>) => {
          const data = ev.data
          if (data.type === 'result') {
            w.removeEventListener('message', onMsg)
            resolve({
              model: data.model,
              seed: data.seed,
              holds: data.holds,
              meta: {
                holdCount: data.meta.holdCount,
                starts: data.meta.starts,
                finishes: data.meta.finishes,
              },
            })
          } else if (data.type === 'error') {
            w.removeEventListener('message', onMsg)
            reject(new Error(data.error))
          }
        }
        w.addEventListener('message', onMsg)
        w.postMessage({
          type: 'generate',
          grade: opts.grade,
          seed: opts.seed,
          temperature: opts.temperature ?? 0.85,
        })
      }),
  )
}
