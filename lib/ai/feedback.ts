/**
 * Local AI feedback playground storage (Approve / Comment + structured tags).
 * Device-only localStorage + export JSON for offline apply-feedback.
 */

export type FeedbackVerdict = 'approve' | 'reject'

/** Fixed tag set for reject labels (English ids). */
export const FEEDBACK_TAGS = [
  'reach',
  'feet',
  'left-right',
  'line',
  'grade',
  'hold-quality',
  'mutation-too-strong',
  'too-hard',
] as const

export type FeedbackTag = (typeof FEEDBACK_TAGS)[number]

/** Short English labels for UI checkboxes. */
export const FEEDBACK_TAG_LABELS: Record<FeedbackTag, string> = {
  reach: 'Reach',
  feet: 'Feet',
  'left-right': 'Left / right',
  line: 'Line',
  grade: 'Grade',
  'hold-quality': 'Hold quality',
  'mutation-too-strong': 'Mutation too strong',
  'too-hard': 'Too hard',
}

const TAG_SET = new Set<string>(FEEDBACK_TAGS)

export function isFeedbackTag(s: string): s is FeedbackTag {
  return TAG_SET.has(s)
}

/** Keep only known tag ids, de-dupe, stable order. */
export function normalizeTags(tags: unknown): FeedbackTag[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<FeedbackTag>()
  const out: FeedbackTag[] = []
  for (const t of tags) {
    if (typeof t !== 'string') continue
    if (!isFeedbackTag(t) || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  // stable order matching FEEDBACK_TAGS
  return FEEDBACK_TAGS.filter((t) => seen.has(t))
}

/** Per-hold flag on a generated climb (tap-to-flag in playground). */
export interface HoldFlag {
  placementId: number
  /** Role on the generated climb when flagged */
  roleId: number
  flag: 'bad'
}

export interface AiFeedbackEntry {
  id: string
  createdAt: string
  verdict: FeedbackVerdict
  /** Free text; optional when tags present on reject */
  comment: string
  /** Structured issue tags (usually on reject) */
  tags: FeedbackTag[]
  /** Target grade used for generation (display_difficulty 10–33) */
  grade: number
  /**
   * Perceived actual grade when tagging too-hard (display_difficulty 10–33).
   * Optional on old entries / when tag not used.
   */
  actualGrade?: number
  strongMutation: boolean
  seed: number
  model: string
  /**
   * Final holds on save (after user edit, or AI as-is if not edited).
   * Preferred / corrected climb for training signal.
   */
  holds: Array<[number, number]>
  /**
   * Holds right after generation (before edit). Same as holds if unedited.
   * Diff vs holds → removed / added / role-changed.
   */
  originalHolds?: Array<[number, number]>
  /** True if user changed holds vs AI gen */
  edited?: boolean
  meta: {
    holdCount: number
    starts: number
    finishes: number
  }
  /** Stable fingerprint of source remix template (optional on old entries) */
  templateId?: string
  templateGrade?: number
  /**
   * @deprecated Prefer edit holds + originalHolds. Kept for old exports.
   */
  holdFlags?: HoldFlag[]
}

/** Clamp difficulty to valid board scale. */
export function clampDifficulty(n: unknown): number | undefined {
  const v = Number(n)
  if (!Number.isFinite(v)) return undefined
  const r = Math.round(v)
  if (r < 10 || r > 33) return undefined
  return r
}

export function normalizeHoldFlags(raw: unknown): HoldFlag[] {
  if (!Array.isArray(raw)) return []
  const out: HoldFlag[] = []
  const seen = new Set<number>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const placementId = Number(o.placementId)
    const roleId = Number(o.roleId)
    if (!Number.isFinite(placementId) || !Number.isFinite(roleId)) continue
    if (seen.has(placementId)) continue
    seen.add(placementId)
    out.push({ placementId, roleId, flag: 'bad' })
  }
  return out
}

export interface FeedbackStats {
  total: number
  approve: number
  reject: number
}

const STORAGE_KEY = 'kilterboard:ai-feedback:v1'
const MAX_ENTRIES = 2000

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `fb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function listFeedback(): AiFeedbackEntry[] {
  if (!canUseStorage()) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AiFeedbackEntry[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((e) => ({
      ...e,
      tags: normalizeTags(e.tags),
      comment: typeof e.comment === 'string' ? e.comment : '',
      holdFlags: normalizeHoldFlags(e.holdFlags),
      actualGrade: clampDifficulty(e.actualGrade),
    }))
  } catch {
    return []
  }
}

function writeAll(entries: AiFeedbackEntry[]): void {
  if (!canUseStorage()) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function feedbackStats(entries?: AiFeedbackEntry[]): FeedbackStats {
  const list = entries ?? listFeedback()
  let approve = 0
  let reject = 0
  for (const e of list) {
    if (e.verdict === 'approve') approve++
    else reject++
  }
  return { total: list.length, approve, reject }
}

export function addFeedback(
  input: Omit<
    AiFeedbackEntry,
    'id' | 'createdAt' | 'tags' | 'holdFlags' | 'edited'
  > & {
    tags?: string[]
    holdFlags?: HoldFlag[]
    actualGrade?: number
    originalHolds?: Array<[number, number]>
    edited?: boolean
  },
): AiFeedbackEntry {
  const tags = normalizeTags(input.tags ?? [])
  const actualGrade =
    tags.includes('too-hard') || tags.includes('grade')
      ? clampDifficulty(input.actualGrade)
      : undefined
  const entry: AiFeedbackEntry = {
    id: newId(),
    createdAt: new Date().toISOString(),
    verdict: input.verdict,
    comment: input.comment.trim(),
    tags,
    grade: input.grade,
    actualGrade,
    strongMutation: input.strongMutation,
    seed: input.seed,
    model: input.model,
    holds: input.holds,
    originalHolds: input.originalHolds,
    edited: !!input.edited,
    meta: input.meta,
    templateId: input.templateId,
    templateGrade: input.templateGrade,
    holdFlags: normalizeHoldFlags(input.holdFlags),
  }
  const all = listFeedback()
  all.push(entry)
  const trimmed =
    all.length > MAX_ENTRIES ? all.slice(all.length - MAX_ENTRIES) : all
  writeAll(trimmed)
  return entry
}

export function clearFeedback(): void {
  if (!canUseStorage()) return
  localStorage.removeItem(STORAGE_KEY)
}

/** Pretty JSON for download / copy. */
export function exportFeedbackJson(entries?: AiFeedbackEntry[]): string {
  const list = entries ?? listFeedback()
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: 1,
      count: list.length,
      stats: feedbackStats(list),
      entries: list,
    },
    null,
    2,
  )
}

export function downloadFeedbackExport(filename = 'ai-feedback-export.json'): void {
  if (typeof window === 'undefined') return
  const json = exportFeedbackJson()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
