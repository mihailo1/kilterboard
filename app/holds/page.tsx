import { AppBrand } from '@/components/AppBrand'
import { HoldSearch } from '@/components/HoldSearch'

export const metadata = {
  title: 'Hold search · Kilterboard',
  description:
    'Find Kilter Board boulders by selecting holds on the wall. Boulders only — routes are not searched.',
}

export default function HoldsPage() {
  return (
    <main className="ui-shell">
      <header className="app-header">
        <AppBrand title="Hold search" />
      </header>
      <HoldSearch />
    </main>
  )
}
