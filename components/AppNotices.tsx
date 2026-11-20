'use client'

import { NewClimbsNotice } from '@/components/NewClimbsNotice'
import { OfflineBanner } from '@/components/OfflineBanner'
import { UpdatePrompt } from '@/components/UpdatePrompt'
import { WhatsNew } from '@/components/WhatsNew'
import { useNotices } from '@/lib/notices'

/**
 * Bottom stack above the dock. The offline pill can show with anything else;
 * of the cards at most one: update prompt > what's new > new climbs.
 */
export function AppNotices() {
  const { update, whatsNew } = useNotices()
  return (
    <div className="notice-stack">
      <OfflineBanner />
      <UpdatePrompt />
      <WhatsNew blocked={!!update} />
      <NewClimbsNotice blocked={!!update || whatsNew} />
    </div>
  )
}
