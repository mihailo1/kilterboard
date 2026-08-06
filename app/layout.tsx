import type { Metadata, Viewport } from 'next'
import { DM_Sans, Fraunces } from 'next/font/google'
import { AppFooter } from '@/components/AppFooter'
import { APP_NAME, APP_VERSION } from '@/lib/version'
import './globals.css'

const body = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: `${APP_NAME}`,
  description:
    'Browse Kilter Board climbs, set custom boulders, light Aurora LEDs over Web Bluetooth, and generate holds with local Hold AR (ONNX).',
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: 'Kilterboard',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.png', sizes: '48x48', type: 'image/png' },
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#14120b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <div className="flex-1">{children}</div>
        <AppFooter />
        {/* SSR-visible version for crawlers / no-JS */}
        <span className="sr-only">
          {APP_NAME} version {APP_VERSION}
        </span>
      </body>
    </html>
  )
}
