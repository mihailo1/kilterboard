import type { Metadata, Viewport } from 'next'
import { DM_Sans, Fraunces } from 'next/font/google'
import { AppBottomNav } from '@/components/AppBottomNav'
import { InstallPrompt } from '@/components/InstallPrompt'
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
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description:
    'Browse Kilter Board climbs, set custom boulders, light Aurora LEDs over Web Bluetooth, and generate holds with local Hold AR (ONNX).',
  applicationName: APP_NAME,
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: 'black-translucent',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '48x48', type: 'image/png' },
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#14120b' },
    { media: '(prefers-color-scheme: light)', color: '#14120b' },
    { color: '#14120b' },
  ],
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${body.variable} ${display.variable}`}>
      <body className="app-body flex min-h-dvh flex-col font-sans antialiased">
        <div className="app-main flex min-h-0 w-full flex-1 flex-col">{children}</div>
        <AppBottomNav />
        <InstallPrompt />
        <span className="sr-only">
          {APP_NAME} version {APP_VERSION}
        </span>
      </body>
    </html>
  )
}
