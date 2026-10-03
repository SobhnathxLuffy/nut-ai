import { router } from 'expo-router'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Empty } from '../src/components/Empty'
import { useTheme } from '../src/theme/ThemeProvider'
import { space } from '../src/theme/tokens'

/**
 * The fallback for every unmatched URL (UI/UX report §7.2 / Table 7.1, Wave 4c).
 *
 * This is where an unknown `nutai://anything` tap AND an unknown web path both
 * land — expo-router routes both through the same not-found hook, so one file
 * closes both doors. The state is the Empty primitive, not an error: a dead
 * link is a resting place with one obvious way out (AGENTS §8.1/§8.2 — no
 * trapped screens), the same "Go home" affordance the root error boundary
 * offers.
 */
export default function NotFound() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        justifyContent: 'center',
        paddingTop: insets.top + space.xl,
        paddingBottom: Math.max(insets.bottom, space.xl),
        paddingHorizontal: space.lg,
      }}
    >
      <Empty
        icon="search"
        title="This link doesn't go anywhere"
        message="The link you followed isn't a Nut AI screen."
        action={{ label: 'Go home', onPress: () => router.replace('/' as never) }}
      />
    </View>
  )
}
