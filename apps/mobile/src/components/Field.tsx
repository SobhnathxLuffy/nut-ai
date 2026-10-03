import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'

/**
 * P2-30 (c): the ONE compact labelled field.
 *
 * Five screens used to carry private near-identical Field wrappers that were
 * drifting apart — and meal-detail's called its change prop `onChange`, which
 * silently means onChangeText in React Native (a standing trap for anyone
 * wiring raw TextInput events through it). This shared component names the
 * change prop for what it is, and covers every layout the five wrappers had:
 * optional placeholder, decimal/numeric keyboard, optional unit suffix
 * (edit-goals' "kg"/"g" box), and container/input style overrides.
 */
export function Field({
  label,
  value,
  onValueChange,
  placeholder,
  numeric = false,
  keyboardType,
  unit,
  containerStyle,
  inputStyle,
  ...textProps
}: {
  label: string
  value: string
  onValueChange: (v: string) => void
  placeholder?: string
  numeric?: boolean
  keyboardType?: TextInputProps['keyboardType']
  unit?: string
  containerStyle?: StyleProp<ViewStyle>
  inputStyle?: StyleProp<TextStyle>
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType' | 'style' | 'placeholder'>) {
  const theme = useTheme()
  return (
    <View style={[{ flex: 1 }, containerStyle]}>
      <Text style={[type.caption, { color: theme.textMuted, marginBottom: space.xs }]}>{label}</Text>
      <View style={unit != null ? { flexDirection: 'row', alignItems: 'center' } : undefined}>
        <TextInput
          accessibilityLabel={unit != null ? `${label} in ${unit}` : label}
          value={value}
          onChangeText={onValueChange}
          placeholder={placeholder}
          placeholderTextColor={theme.textFaint}
          keyboardType={keyboardType ?? (numeric ? 'decimal-pad' : 'default')}
          // Wave 4b (report §11.1): Android's TextInput ships with font scaling
          // OFF — the explicit default keeps these inputs growing with the OS
          // font size. No cap: user content grows freely; the input is
          // minHeight, never a fixed height.
          allowFontScaling
          style={[
            {
              flex: 1,
              minHeight: MIN_TAP_TARGET,
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: radius.sm,
              paddingHorizontal: space.md,
              // Wave 1a: inputs sit at type.body (Table 3.1 — 17px ad-hoc joins 16/24).
              fontSize: type.body.fontSize,
              color: theme.text,
              borderColor: theme.border,
              backgroundColor: theme.bgSunken,
            },
            inputStyle,
          ]}
          {...textProps}
        />
        {unit != null ? (
          <Text style={[type.body, { color: theme.textMuted, marginLeft: space.sm }]}>{unit}</Text>
        ) : null}
      </View>
    </View>
  )
}
