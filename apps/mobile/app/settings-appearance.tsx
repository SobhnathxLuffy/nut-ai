import { Pressable, Text, View } from 'react-native'
import { Icon } from '../src/components/Icon'
import { Screen } from '../src/components/Screen'
import { useTheme, useThemePreference } from '../src/theme/ThemeProvider'
import { THEME_PREFERENCE_LABELS, type ThemePreference } from '../src/theme/preference'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

const OPTIONS: ThemePreference[] = ['system', 'light', 'dark']

/**
 * Appearance — the in-app light/dark preference (light-mode request,
 * 2026-10-12). Both palettes always existed; this screen adds the missing
 * override so a user on a dark-mode phone can force light (or vice versa).
 * The tap re-themes the WHOLE app instantly through ThemeProvider — no
 * restart, no reload — and the choice persists in the same kv-store as the
 * other app preferences.
 *
 * "Match system" is the default and the honest first option: it is exactly
 * the behaviour the app had before this screen existed.
 */
export default function AppearanceSettings() {
  const theme = useTheme()
  const { preference, setPreference } = useThemePreference()

  return (
    <Screen title="Appearance" back backLabel="Back to profile">
      <Text style={[type.label, { color: theme.textMuted }]}>Theme</Text>
      <View style={{ gap: space.sm, marginTop: space.sm }}>
        {OPTIONS.map((option) => {
          const selected = preference === option
          const description =
            option === 'system'
              ? 'Follow your phone’s light or dark mode.'
              : option === 'light'
                ? 'Bright surfaces, dark text. Easy in daylight.'
                : 'Dark surfaces, light text. The original look.'
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={`${THEME_PREFERENCE_LABELS[option]} theme`}
              accessibilityState={{ selected }}
              onPress={() => setPreference(option)}
              style={[
                styles.option,
                {
                  borderColor: selected ? theme.text : theme.border,
                  backgroundColor: theme.bgElevated,
                },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>{THEME_PREFERENCE_LABELS[option]}</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>{description}</Text>
              </View>
              {selected ? <Icon name="check" size={20} color={theme.text} /> : null}
            </Pressable>
          )
        })}
      </View>
      <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md }]}>
        The change applies everywhere immediately and is remembered on this device.
      </Text>
    </Screen>
  )
}

const styles = {
  option: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.md,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
}
