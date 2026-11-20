import type { NextConfig } from 'next'
import fs from 'fs'
import path from 'path'
import { CHANGELOG } from './lib/changelog'

// Single source of truth for the app version: package.json. public/sw.js has
// no build step, so it repeats the version in `const VERSION`; a mismatch
// fails the production build (a stale SW version never triggers "Update").
const APP_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
).version
const swSource = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8')
const SW_VERSION = swSource.match(/const VERSION = "([^"]+)"/)?.[1]
const SW_SILENT = swSource.match(/const SILENT_UPDATE = (true|false);/)?.[1] === 'true'

function check(ok: boolean, msg: string) {
  if (ok) return
  if (process.env.NODE_ENV === 'production') throw new Error(msg)
  console.warn(`Warning: ${msg}`)
}
check(
  SW_VERSION === APP_VERSION,
  `public/sw.js VERSION (${SW_VERSION}) must equal package.json version (${APP_VERSION})`,
)
// A silent release must be marked in both places, so a forgotten
// SILENT_UPDATE = true can never leak into the next normal release.
check(
  SW_SILENT === (CHANGELOG[0]?.silent === true),
  'SILENT_UPDATE in public/sw.js must match `silent` on the newest lib/changelog.ts entry',
)
check(
  CHANGELOG[0]?.version === APP_VERSION,
  `newest lib/changelog.ts entry (${CHANGELOG[0]?.version}) must be package.json version (${APP_VERSION})`,
)

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
  // Avoid picking up lockfiles from parent home directory
  outputFileTracingRoot: path.join(__dirname),
  // Ship gzipped catalog only (~37MB) — runtime gunzips to /tmp (see lib/boardsesh.ts).
  // Uncompressed .db is ~120MB and can blow the 250MB function limit if both are included.
  outputFileTracingIncludes: {
    '/api/climbs': ['./data/boardsesh/kilter-12x12.db.gz'],
    '/api/setters': ['./data/boardsesh/kilter-12x12.db.gz'],
    '/api/climbs/new': ['./data/boardsesh/kilter-12x12.db.gz'],
  },
  async headers() {
    return [
      {
        // The service worker must never be served stale, or updates stall.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ]
  },
}

export default nextConfig
