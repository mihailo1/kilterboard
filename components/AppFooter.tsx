import { APP_NAME, APP_VERSION } from '@/lib/version'

/** Site-wide footer — version on every page. */
export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-border/80 bg-canvas/80">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-1 px-4 py-4 text-center sm:px-6">
        <p className="text-[11px] text-faint">
          {APP_NAME}{' '}
          <span className="tabular-nums text-muted">v{APP_VERSION}</span>
        </p>
        <p className="text-[10px] leading-snug text-faint/80">
          Unofficial · not affiliated with Aurora Climbing or Kilter
        </p>
      </div>
    </footer>
  )
}
