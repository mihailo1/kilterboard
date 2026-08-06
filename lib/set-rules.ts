/**
 * Kilter set rules for starts / finishes on boulder + multi-frame routes.
 *
 * Starts: max 2; only on a prefix of frames (first X); same set on every start-frame.
 * Finishes: max 2; only on a suffix of frames (last Y); same set on every finish-frame.
 */

export const ROLE_START = 12
export const ROLE_FINISH = 14
export const MAX_STARTS = 2
export const MAX_FINISHES = 2

export function cloneFrameMap(m: Map<number, number>): Map<number, number> {
  return new Map(m)
}

export function rolesOf(
  m: Map<number, number>,
  roleId: number,
): number[] {
  return [...m.entries()]
    .filter(([, r]) => r === roleId)
    .map(([id]) => id)
    .sort((a, b) => a - b)
}

function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

function setRoleGroup(
  m: Map<number, number>,
  roleId: number,
  ids: number[],
): void {
  for (const [id, r] of [...m.entries()]) {
    if (r === roleId) m.delete(id)
  }
  for (const id of ids) m.set(id, roleId)
}

/** Longest prefix [0..end) where every frame has the same non-empty start set, or 0 if frame0 has none. */
export function startPhaseEnd(frames: Array<Map<number, number>>): number {
  if (frames.length === 0) return 0
  const s0 = rolesOf(frames[0]!, ROLE_START)
  if (s0.length === 0) return 0
  let end = 1
  for (let i = 1; i < frames.length; i++) {
    const s = rolesOf(frames[i]!, ROLE_START)
    if (s.length === 0) break
    if (!sameIds(s, s0)) break
    end = i + 1
  }
  return end
}

/** First index of finish phase (suffix); frames.length if none. */
export function finishPhaseStart(frames: Array<Map<number, number>>): number {
  if (frames.length === 0) return 0
  const last = frames.length - 1
  const fLast = rolesOf(frames[last]!, ROLE_FINISH)
  if (fLast.length === 0) return frames.length
  let start = last
  for (let i = last - 1; i >= 0; i--) {
    const f = rolesOf(frames[i]!, ROLE_FINISH)
    if (f.length === 0) break
    if (!sameIds(f, fLast)) break
    start = i
  }
  return start
}

export function validateStartFinish(
  frames: Array<Map<number, number>>,
): string | null {
  for (let i = 0; i < frames.length; i++) {
    const s = rolesOf(frames[i]!, ROLE_START)
    const f = rolesOf(frames[i]!, ROLE_FINISH)
    if (s.length > MAX_STARTS) return `At most ${MAX_STARTS} start holds`
    if (f.length > MAX_FINISHES) return `At most ${MAX_FINISHES} finish holds`
  }

  const spEnd = startPhaseEnd(frames)
  const s0 = rolesOf(frames[0] ?? new Map(), ROLE_START)
  for (let i = 0; i < frames.length; i++) {
    const s = rolesOf(frames[i]!, ROLE_START)
    if (i < spEnd) {
      if (!sameIds(s, s0)) return 'Start holds must match on the first frames'
    } else if (s.length > 0) {
      return 'Start holds only on the first frames (cannot appear later)'
    }
  }

  const fpStart = finishPhaseStart(frames)
  const fLast = rolesOf(frames[frames.length - 1] ?? new Map(), ROLE_FINISH)
  for (let i = 0; i < frames.length; i++) {
    const f = rolesOf(frames[i]!, ROLE_FINISH)
    if (i >= fpStart && fpStart < frames.length) {
      if (!sameIds(f, fLast)) return 'Finish holds must match on the last frames'
    } else if (f.length > 0) {
      return 'Finish holds only on the last frames (cannot appear earlier)'
    }
  }

  return null
}

/**
 * Apply paint with start/finish rules. Returns new frames or error.
 * - Starts: only on prefix; max 2; kept identical on every start-phase frame.
 * - Finishes: only on suffix; max 2; kept identical on every finish-phase frame.
 */
export function applyPaintWithRules(
  framesIn: Array<Map<number, number>>,
  frameIndex: number,
  placementId: number,
  tool: number | 'erase',
): { frames: Array<Map<number, number>>; error?: string } {
  const frames = framesIn.map(cloneFrameMap)
  const i = Math.max(0, Math.min(frameIndex, frames.length - 1))
  const m = frames[i]!
  const n = frames.length

  if (tool === 'erase') {
    const prevRole = m.get(placementId)
    m.delete(placementId)
    if (prevRole === ROLE_START) {
      // Remove this start from entire start phase; recompute phase
      const spEnd = Math.max(startPhaseEnd(frames), i + 1)
      for (let j = 0; j < spEnd; j++) {
        frames[j]!.delete(placementId)
      }
      // Clear starts from any frame after new phase end
      const newEnd = startPhaseEnd(frames)
      for (let j = newEnd; j < n; j++) {
        for (const id of rolesOf(frames[j]!, ROLE_START)) {
          frames[j]!.delete(id)
        }
      }
    } else if (prevRole === ROLE_FINISH) {
      const fpStart = Math.min(finishPhaseStart(frames), i)
      for (let j = fpStart; j < n; j++) {
        frames[j]!.delete(placementId)
      }
      const newStart = finishPhaseStart(frames)
      for (let j = 0; j < newStart; j++) {
        for (const id of rolesOf(frames[j]!, ROLE_FINISH)) {
          frames[j]!.delete(id)
        }
      }
    }
    return { frames }
  }

  const roleId = tool as number

  // Toggle off same role
  if (m.get(placementId) === roleId) {
    return applyPaintWithRules(frames, i, placementId, 'erase')
  }

  if (roleId === ROLE_START) {
    // Starts only within / extending the start prefix from frame 0
    // Allow paint on any frame j in [0, startPhaseEnd] or frame 0 always
    const spEnd = startPhaseEnd(frames)
    if (i > spEnd) {
      return {
        frames: framesIn.map(cloneFrameMap),
        error: 'Starts only on the first frames — go to frame 1 (or earlier)',
      }
    }

    // Build new start set from frame 0 perspective
    const base = cloneFrameMap(frames[0]!)
    // If painting mid start-phase, still update the shared set
    const curStarts = new Set(rolesOf(frames[Math.min(i, spEnd > 0 ? spEnd - 1 : 0)]!, ROLE_START))
    // Prefer frame 0 as source of truth
    const s0 = new Set(rolesOf(frames[0]!, ROLE_START))
    const starts = spEnd > 0 || i === 0 ? s0 : curStarts
    starts.add(placementId)
    // Remove if was another role on this placement in start frames
    if (starts.size > MAX_STARTS) {
      return {
        frames: framesIn.map(cloneFrameMap),
        error: `At most ${MAX_STARTS} start holds`,
      }
    }

    const startIds = [...starts].sort((a, b) => a - b)
    // Start phase length: keep existing phase at least through i, or 1
    let phaseLen = Math.max(spEnd, i + 1, 1)
    // Apply shared starts to phase; clear starts after
    for (let j = 0; j < n; j++) {
      if (j < phaseLen) {
        setRoleGroup(frames[j]!, ROLE_START, startIds)
      } else {
        for (const id of rolesOf(frames[j]!, ROLE_START)) {
          frames[j]!.delete(id)
        }
      }
    }
    // If placement had finish, strip finishes that conflict? keep other roles
    for (let j = 0; j < phaseLen; j++) {
      // placement is start — already set
    }
    const err = validateStartFinish(frames)
    if (err) return { frames: framesIn.map(cloneFrameMap), error: err }
    return { frames }
  }

  if (roleId === ROLE_FINISH) {
    const fpStart = finishPhaseStart(frames)
    // Finishes only on last frames: allow paint on i if i >= fpStart - 0 or last frame
    if (fpStart < n && i < fpStart) {
      return {
        frames: framesIn.map(cloneFrameMap),
        error: 'Finishes only on the last frames — go to the last frame',
      }
    }
    if (fpStart >= n && i !== n - 1) {
      // No finish phase yet — only start it from the last frame
      return {
        frames: framesIn.map(cloneFrameMap),
        error: 'Finishes only on the last frames — paint finish on the last frame',
      }
    }

    const last = n - 1
    const finishes = new Set(rolesOf(frames[last]!, ROLE_FINISH))
    // If painting on a finish-phase frame, use last as source
    finishes.add(placementId)
    if (finishes.size > MAX_FINISHES) {
      return {
        frames: framesIn.map(cloneFrameMap),
        error: `At most ${MAX_FINISHES} finish holds`,
      }
    }
    const finishIds = [...finishes].sort((a, b) => a - b)
    // Phase from min(i, fpStart, last) to end — if no phase yet, only last frame
    let phaseStart = fpStart < n ? Math.min(fpStart, i) : last
    phaseStart = Math.min(phaseStart, last)

    for (let j = 0; j < n; j++) {
      if (j >= phaseStart) {
        setRoleGroup(frames[j]!, ROLE_FINISH, finishIds)
      } else {
        for (const id of rolesOf(frames[j]!, ROLE_FINISH)) {
          frames[j]!.delete(id)
        }
      }
    }
    const err = validateStartFinish(frames)
    if (err) return { frames: framesIn.map(cloneFrameMap), error: err }
    return { frames }
  }

  // Hand / foot — free paint on current frame only
  m.set(placementId, roleId)
  // If this placement was start/finish, clean group rules
  // (replacing start with hand on frame i): strip from start set
  for (let j = 0; j < n; j++) {
    if (j === i) continue
    // no auto change for hand/foot
  }
  // If overwriting a start on frame 0 with hand, remove from start phase
  const err = validateStartFinish(frames)
  if (err) {
    // Overwriting start mid-phase may leave mismatch — fix by removing that start from all start frames
    // Already set only on current frame; if prev was start, clear starts matching
  }
  // Clean: if any frame has starts outside rules after replacing role
  const s0 = rolesOf(frames[0]!, ROLE_START)
  const spEnd = startPhaseEnd(frames)
  for (let j = 0; j < n; j++) {
    if (j >= spEnd) {
      for (const id of rolesOf(frames[j]!, ROLE_START)) frames[j]!.delete(id)
    } else {
      setRoleGroup(frames[j]!, ROLE_START, s0)
    }
  }
  const fLast = rolesOf(frames[n - 1]!, ROLE_FINISH)
  const fpStart = finishPhaseStart(frames)
  for (let j = 0; j < n; j++) {
    if (j < fpStart) {
      for (const id of rolesOf(frames[j]!, ROLE_FINISH)) frames[j]!.delete(id)
    } else {
      setRoleGroup(frames[j]!, ROLE_FINISH, fLast)
    }
  }

  return { frames }
}
