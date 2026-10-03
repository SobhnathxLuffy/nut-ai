import { DeepLinkRedirect } from '../src/navigation/DeepLinkRedirect'

/**
 * nutai://log → /food (UI/UX report §7.2 / Table 7.1, Wave 4c).
 *
 * "Log" is what a reminder notification means; the Food tab (the write
 * surface, reached through the URL-transparent (tabs) group at /food) is where
 * logging happens. See src/navigation/deep-links.ts for the strategy.
 */
export default function LogDeepLink() {
  return <DeepLinkRedirect path="log" />
}
