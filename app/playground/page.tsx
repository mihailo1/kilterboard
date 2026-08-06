import type { Metadata } from 'next'
import { AiPlayground } from '@/components/AiPlayground'

export const metadata: Metadata = {
  title: 'AI Playground · Kilterboard',
  description: 'Local Hold AR sandbox — generate and tweak boulders',
}

export default function PlaygroundPage() {
  return <AiPlayground />
}
