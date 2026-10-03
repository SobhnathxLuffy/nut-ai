import { router } from 'expo-router'
import { useEffect } from 'react'
import { View } from 'react-native'
import { useTheme } from '../theme/ThemeProvider'
import { DEEP_LINK_ROUTES } from './deep-links'

/**
 * The shared alias-route body (UI/UX report §7.2 / Table 7.1, Wave 4c).
 *
 * An alias route file (`app/scan.tsx`) renders exactly this: resolve the alias
 * through `DEEP_LINK_ROUTES`, `router.replace` to the real screen once mounted,
 * and show a plain theme-coloured surface meanwhile — no content flash, and
 * `replace` (not `push`) so the alias never lingers in history: hardware back
 * from the destination behaves as if the user had opened it directly.
 *
 * The `as never` cast is the repo's typed-routes convention (typed routes
 * regenerate on the next `expo start`/export; until then the cast keeps strict
 * typecheck green — precedent: app/(tabs)/index.tsx:521).
 */
export function DeepLinkRedirect({ path }: { path: string }) {
  const t = useTheme()

  useEffect(() => {
    const entry = DEEP_LINK_ROUTES.find((candidate) => candidate.path === path)
    if (entry) router.replace(entry.route as never)
  }, [path])

  // Nothing but the theme background while the replace lands — a mid-air
  // redirect that paints content would be the 404-flash the design avoids.
  return <View style={{ flex: 1, backgroundColor: t.bg }} />
}
