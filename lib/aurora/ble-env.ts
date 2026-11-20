/**
 * Where Web Bluetooth can come from in this browser.
 *
 * - Chrome / Edge (desktop, Android): native `navigator.bluetooth`.
 * - Safari on iOS / iPadOS: no native support. The iOSWebBLE Safari Web Extension
 *   (beacio, App Store id6761301368) injects a standard `navigator.bluetooth`, so
 *   grip-connect works unchanged once the extension is installed and allowed.
 */

/** App Store page of the iOSWebBLE (beacio) Safari extension. */
export const IOS_WEBBLE_APP_STORE_URL = 'https://apps.apple.com/app/id6761301368'

/** Event the extension dispatches on `window` once its API is ready on the page. */
const EXTENSION_READY_EVENT = 'beacio:extension:ready'

export type BleEnvironment =
  /** `navigator.bluetooth` is present (native or extension). */
  | 'supported'
  /** Safari tab on iOS / iPadOS without the extension (not installed or not allowed). */
  | 'ios-safari'
  /** Home Screen web app on iOS: Safari extensions do not run there. */
  | 'ios-standalone'
  /** Another browser or in-app web view on iOS: Safari extensions do not run there. */
  | 'ios-other-browser'
  /** Any other browser without Web Bluetooth (desktop Safari, Firefox, …). */
  | 'unsupported'

export function hasWebBluetooth(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  // iPadOS reports itself as a Mac by default.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches
}

/** Chrome, Firefox, Edge, Opera, Google app, DuckDuckGo… on iOS, plus in-app web views. */
function isNonSafariIOSBrowser(): boolean {
  const ua = navigator.userAgent
  if (/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser/i.test(ua)) return true
  // In-app web views (Instagram, Telegram, …) usually lack the "Safari/" token.
  return !/Safari\//.test(ua)
}

export function detectBleEnvironment(): BleEnvironment {
  if (hasWebBluetooth()) return 'supported'
  if (!isIOS()) return 'unsupported'
  if (isStandalone()) return 'ios-standalone'
  if (isNonSafariIOSBrowser()) return 'ios-other-browser'
  return 'ios-safari'
}

/**
 * Resolve `true` as soon as `navigator.bluetooth` exists.
 * The Safari extension can inject after hydration, so on iOS wait a little
 * (ready event + polling) before declaring Bluetooth unavailable.
 */
export function waitForWebBluetooth(timeoutMs = 2000): Promise<boolean> {
  if (hasWebBluetooth()) return Promise.resolve(true)
  if (typeof window === 'undefined') return Promise.resolve(false)

  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearInterval(poll)
      window.clearTimeout(timer)
      window.removeEventListener(EXTENSION_READY_EVENT, check)
      resolve(hasWebBluetooth())
    }
    const check = () => {
      if (hasWebBluetooth()) finish()
    }
    const poll = window.setInterval(check, 100)
    const timer = window.setTimeout(finish, timeoutMs)
    window.addEventListener(EXTENSION_READY_EVENT, check)
  })
}
