import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'

/**
 * P2-30 (b): the ONE option-chip row.
 *
 * The fat/method chip rows existed twice (food-search vs dish-composer) and
 * had already drifted — the dish-composer copy lost the accessibilityState
 * the food-search copy had. Every horizontal option-chip row renders through
 * here: selected tint, accessibilityRole/Label/State, 44px target, theme
 * colors, in one place.
 *
 * Wave 5C (AA fix, docs/design-system.md §7): the selected state used to be
 * a SOLID `theme.protein` fill with a `theme.bg` label — 3.88:1 in light,
 * the last accepted contrast deviation. It now renders the Badge macro
 * dialect instead: `proteinTint` wash + `proteinText` label + `protein`
 * border (4.79:1 light / 6.00:1 dark, gated in check-contrast.mjs as the
 * "filled option-chip" pairs over the page bg). Selection is still doubled
 * in accessibilityState, so the state never rides colour alone.
 */
export function ChipRow<T>({
  items,
  keyOf,
  label,
  a11yLabel,
  isActive,
  onPress,
  style,
  innerStyle,
  chipStyle,
}: {
  items: readonly T[]
  keyOf: (item: T) => string
  label: (item: T) => string
  a11yLabel: (item: T) => string
  isActive: (item: T) => boolean
  onPress: (item: T) => void
  style?: StyleProp<ViewStyle>
  innerStyle?: StyleProp<ViewStyle>
  chipStyle?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[{ marginTop: space.xs }, style]}>
      <View style={[{ flexDirection: 'row', gap: space.xs }, innerStyle]}>
        {items.map((item) => {
          const active = isActive(item)
          return (
            <Pressable
              key={keyOf(item)}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel(item)}
              accessibilityState={{ selected: active }}
              onPress={() => onPress(item)}
              style={[
                {
                  paddingHorizontal: space.sm,
                  paddingVertical: 6,
                  borderRadius: radius.sm,
                  borderWidth: StyleSheet.hairlineWidth,
                  minHeight: MIN_TAP_TARGET,
                  justifyContent: 'center',
                },
                chipStyle,
                {
                  backgroundColor: active ? theme.proteinTint : theme.bg,
                  borderColor: active ? theme.protein : theme.border,
                },
              ]}
            >
              <Text style={[type.caption, { color: active ? theme.proteinText : theme.text }]}>{label(item)}</Text>
            </Pressable>
          )
        })}
      </View>
    </ScrollView>
  )
}
