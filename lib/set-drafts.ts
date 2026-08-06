/** Local drafts for Set studio (device storage). */

export type SetKind = 'boulder' | 'route'

export interface SetDraft {
  id: string
  name: string
  kind: SetKind
  /** Absolute frames: list of [placementId, roleId][] */
  frames: Array<Array<[number, number]>>
  frameIndex: number
  createdAt: string
  updatedAt: string
}

const DRAFTS_KEY = 'kilterboard:set-drafts:v1'
const ACTIVE_KEY = 'kilterboard:set-active-id:v1'

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

export function framesToSerializable(
  frames: Array<Map<number, number>>,
): Array<Array<[number, number]>> {
  return frames.map((m) => Array.from(m.entries()) as Array<[number, number]>)
}

export function framesFromSerializable(
  raw: Array<Array<[number, number]>>,
): Array<Map<number, number>> {
  if (!raw?.length) return [new Map()]
  return raw.map((entries) => new Map(entries))
}

export function listDrafts(): SetDraft[] {
  if (!canUseStorage()) return []
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SetDraft[]
    if (!Array.isArray(parsed)) return []
    return parsed.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  } catch {
    return []
  }
}

function writeAll(drafts: SetDraft[]) {
  if (!canUseStorage()) return
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
}

export function getActiveDraftId(): string | null {
  if (!canUseStorage()) return null
  return localStorage.getItem(ACTIVE_KEY)
}

export function setActiveDraftId(id: string | null) {
  if (!canUseStorage()) return
  if (id) localStorage.setItem(ACTIVE_KEY, id)
  else localStorage.removeItem(ACTIVE_KEY)
}

export function getDraft(id: string): SetDraft | null {
  return listDrafts().find((d) => d.id === id) ?? null
}

export function namelessDraftTitle(when = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
  const t = `${pad(when.getHours())}:${pad(when.getMinutes())}`
  return `Nameless draft from ${d} ${t}`
}

export function saveDraft(draft: SetDraft): void {
  const all = listDrafts().filter((d) => d.id !== draft.id)
  all.unshift(draft)
  // Cap storage
  writeAll(all.slice(0, 40))
  setActiveDraftId(draft.id)
}

export function deleteDraft(id: string): void {
  writeAll(listDrafts().filter((d) => d.id !== id))
  if (getActiveDraftId() === id) setActiveDraftId(null)
}

export function upsertDraft(partial: {
  id: string
  name: string
  kind: SetKind
  frames: Array<Map<number, number>>
  frameIndex: number
  createdAt?: string
}): SetDraft {
  const now = new Date().toISOString()
  const existing = getDraft(partial.id)
  const name =
    partial.name.trim() ||
    existing?.name ||
    namelessDraftTitle(new Date())
  const draft: SetDraft = {
    id: partial.id,
    name,
    kind: partial.kind,
    frames: framesToSerializable(partial.frames),
    frameIndex: partial.frameIndex,
    createdAt: partial.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now,
  }
  saveDraft(draft)
  return draft
}

export function isDraftDirty(frames: Array<Map<number, number>>): boolean {
  return frames.some((m) => m.size > 0)
}

export function newDraftId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
