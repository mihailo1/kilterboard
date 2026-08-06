import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Avoid picking up lockfiles from parent home directory
  outputFileTracingRoot: path.join(__dirname),
  // Ship gzipped catalog only (~37MB) — runtime gunzips to /tmp (see lib/boardsesh.ts).
  // Uncompressed .db is ~120MB and can blow the 250MB function limit if both are included.
  outputFileTracingIncludes: {
    '/api/climbs': ['./data/boardsesh/kilter-12x12.db.gz'],
    '/api/setters': ['./data/boardsesh/kilter-12x12.db.gz'],
  },
}

export default nextConfig
