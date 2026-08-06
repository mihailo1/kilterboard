/** Aurora / Kilter display_difficulty → Font/V label (same scale as Climbest / official app). */

export const DIFFICULTY_GRADES: Record<number, string> = {
  10: '4a/V0',
  11: '4b/V0',
  12: '4c/V0',
  13: '5a/V1',
  14: '5b/V1',
  15: '5c/V2',
  16: '6a/V3',
  17: '6a+/V3',
  18: '6b/V4',
  19: '6b+/V4',
  20: '6c/V5',
  21: '6c+/V5',
  22: '7a/V6',
  23: '7a+/V7',
  24: '7b/V8',
  25: '7b+/V8',
  26: '7c/V9',
  27: '7c+/V10',
  28: '8a/V11',
  29: '8a+/V12',
  30: '8b/V13',
  31: '8b+/V14',
  32: '8c/V15',
  33: '8c+/V16',
}

export const GRADE_OPTIONS = Object.entries(DIFFICULTY_GRADES)
  .map(([difficulty, label]) => ({
    difficulty: Number(difficulty),
    label,
  }))
  .sort((a, b) => a.difficulty - b.difficulty)

export function difficultyToGrade(difficulty: number | null | undefined): string {
  if (difficulty == null || Number.isNaN(difficulty)) return '—'
  const rounded = Math.round(difficulty)
  return DIFFICULTY_GRADES[rounded] ?? `~${difficulty.toFixed(1)}`
}

/** Soft grade color for badges (Font bands) — warm palette. */
export function gradeTone(difficulty: number | null | undefined): string {
  if (difficulty == null) return 'bg-surface-3 text-muted ring-1 ring-border'
  const d = Math.round(difficulty)
  if (d <= 14) return 'bg-emerald-500/12 text-emerald-300/95 ring-1 ring-emerald-500/20' // ≤5b
  if (d <= 17) return 'bg-teal-500/12 text-teal-300/95 ring-1 ring-teal-500/20' // ≤6a+
  if (d <= 21) return 'bg-accent-soft text-accent ring-1 ring-accent/25' // ≤6c+
  if (d <= 25) return 'bg-amber-500/12 text-amber-200/95 ring-1 ring-amber-500/20' // ≤7b+
  if (d <= 28) return 'bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/25' // ≤8a
  return 'bg-rose-500/12 text-rose-200 ring-1 ring-rose-500/20' // hard
}
