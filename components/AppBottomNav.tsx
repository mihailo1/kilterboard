'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'

type Tab = 'climbs' | 'holds' | 'set' | 'ai'

function useActiveTab(): Tab {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  if (pathname?.startsWith('/playground')) return 'ai'
  if (pathname?.startsWith('/holds')) return 'holds'
  if (pathname === '/' && searchParams.get('mode') === 'set') return 'set'
  return 'climbs'
}

const TABS: Array<{
  id: Tab
  href: string
  label: string
  icon: ReactNode
}> = [
  {
    id: 'climbs',
    href: '/',
    label: 'Climbs',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
        <path
          d="M4 19.5V6.2c0-.7.4-1.3 1-1.6l6-2.7c.6-.3 1.3-.3 1.9 0l6 2.7c.6.3 1 .9 1 1.6v13.3"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9 14.5c.8-1.2 2-2 3.2-2.2 1.4-.2 2.6.4 3.3 1.2"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <circle cx="9.2" cy="10.2" r="1.1" fill="currentColor" />
        <circle cx="14.8" cy="8.4" r="1.1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'holds',
    href: '/holds',
    label: 'Holds',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
        <circle cx="8" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="15.5" cy="7.5" r="1.8" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="12" cy="14.5" r="2.4" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="17" cy="15" r="1.5" stroke="currentColor" strokeWidth="1.75" />
      </svg>
    ),
  },
  {
    id: 'set',
    href: '/?mode=set',
    label: 'Set',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
        <path
          d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="7" cy="12" r="1.35" fill="currentColor" />
        <circle cx="17" cy="12" r="1.35" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'ai',
    href: '/playground',
    label: 'Hold AR',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
        <path
          d="M12 3.5 13.8 9l5.7 1.1-4.3 3.8 1.3 5.6L12 16.7 7.5 19.5l1.3-5.6L4.5 10.1 10.2 9 12 3.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
]

function NavInner() {
  const active = useActiveTab()

  return (
    <nav className="app-dock" aria-label="Main">
      <div className="app-dock-inner" role="tablist">
        {TABS.map((tab) => {
          const isActive = active === tab.id
          return (
            <Link
              key={tab.id}
              href={tab.href}
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              className={`app-dock-tab ${isActive ? 'app-dock-tab-active' : ''}`}
            >
              <span className="app-dock-icon">{tab.icon}</span>
              <span className="app-dock-label">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

/** Floating glass dock — primary app navigation (PWA-style). */
export function AppBottomNav() {
  return (
    <Suspense fallback={<div className="app-dock" aria-hidden />}>
      <NavInner />
    </Suspense>
  )
}
