'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { openClimbInSetDraft } from '@/lib/set-drafts'

interface OpenInSetButtonProps {
  name: string
  frames: string
}

/**
 * Copies a catalog boulder/route into Set as a local draft named
 * "{original} (modified)", then navigates to /?mode=set.
 */
export function OpenInSetButton({ name, frames }: OpenInSetButtonProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const disabled = !frames?.trim()

  const onClick = () => {
    if (disabled || busy) return
    setBusy(true)
    setError(null)
    try {
      openClimbInSetDraft({ name, frames })
      router.push('/?mode=set')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open in Set')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        className="ui-btn-primary w-full sm:w-auto"
        title="Edit a copy in Set · saves as a local draft"
      >
        {busy ? 'Opening…' : 'Open in Set'}
      </button>
      {error && <p className="text-xs text-rose-200">{error}</p>}
    </div>
  )
}
