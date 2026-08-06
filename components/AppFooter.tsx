import { APP_NAME, APP_VERSION } from '@/lib/version'

/** Compact site footer — sits above the floating dock. */
export function AppFooter() {
  return (
    <footer className="app-footer shrink-0">
      <div className="app-footer-inner">
        <p className="text-[11px] text-faint">
          {APP_NAME}{' '}
          <span className="tabular-nums text-muted">v{APP_VERSION}</span>
          <span className="text-faint/70"> · Unofficial</span>
        </p>
      </div>
    </footer>
  )
}
