import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="ui-shell items-center justify-center text-center">
      <div className="ui-card max-w-md space-y-4 p-8">
        <p className="ui-eyebrow">404</p>
        <h1 className="ui-title text-2xl sm:text-3xl">Climb not found</h1>
        <p className="ui-subtitle mx-auto">
          Open a climb from the list so holds and grade are included in the link.
        </p>
        <Link href="/" className="ui-btn-primary mt-2 inline-flex">
          ← Back to climbs
        </Link>
      </div>
    </main>
  )
}
