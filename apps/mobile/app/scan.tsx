import { DeepLinkRedirect } from '../src/navigation/DeepLinkRedirect'

/**
 * nutai://scan → /camera (UI/UX report §7.2 / Table 7.1, Wave 4c).
 *
 * The hero deep link — the alias a home-screen widget or scan notification
 * emits. `scan` is semantic, `/camera` is the real route file, and this alias
 * file is the bridge (see src/navigation/deep-links.ts for the strategy).
 */
export default function ScanDeepLink() {
  return <DeepLinkRedirect path="scan" />
}
