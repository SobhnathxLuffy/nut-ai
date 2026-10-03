import { DeepLinkRedirect } from '../src/navigation/DeepLinkRedirect'

/**
 * nutai://home → / (UI/UX report §7.2 / Table 7.1, Wave 4c).
 *
 * The generic "open the app" alias — the one a dismissed notification or a
 * widget header tap uses. `/` is the Home tab route; this alias file is the
 * bridge (see src/navigation/deep-links.ts for the strategy).
 */
export default function HomeDeepLink() {
  return <DeepLinkRedirect path="home" />
}
