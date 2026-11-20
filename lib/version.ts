/**
 * App version. Single source of truth: `package.json` "version", injected at
 * build time by next.config.ts. `public/sw.js` repeats it in `const VERSION`
 * (no build step there); the build fails if the two differ.
 */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'

export const APP_NAME = 'Kilterboard' as const

/** Compares "1.2.3" style versions. Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/** "1.2.0" → "1.2" for display. */
export function shortVersion(v: string): string {
  return String(v).replace(/\.0$/, '')
}
