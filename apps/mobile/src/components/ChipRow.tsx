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
                { backgroundColor: active ? theme.protein : theme.bg, borderColor: theme.border },
              ]}
            >
              <Text style={[type.micro, { color: active ? theme.bg : theme.text }]}>{label(item)}</Text>
            </Pressable>
          )
        })}
      </View>
    </ScrollView>
  )
}
