import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Avoid picking up lockfiles from parent home directory
  outputFileTracingRoot: path.join(__dirname),
}

export default nextConfig
