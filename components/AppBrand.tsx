import { APP_VERSION } from '@/lib/version'

interface AppBrandProps {
  title: string
}

/**
 * Brand bar: orb + large title, version as a quiet status on the right.
 */
export function AppBrand({ title }: AppBrandProps) {
  return (
    <div className="app-brand">
      <div className="app-brand-left">
        <span className="app-brand-mark-wrap" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon.svg"
            alt=""
            width={40}
            height={40}
            className="app-brand-mark"
            draggable={false}
          />
        </span>
        <h1 className="app-brand-name">{title}</h1>
      </div>
      <span className="app-brand-version" title={`Kilterboard v${APP_VERSION}`}>
        <span className="app-brand-version-label">v</span>
        {APP_VERSION}
      </span>
    </div>
  )
}
