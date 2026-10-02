import { type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Icon, type IconName } from './Icon'
import { PressableFX } from './PressableFX'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'

/**
 * The Item row (UI/UX report Ch. 8.5 / §5): icon + label + value + trailing
 * glyph — the one pattern list screens were audited into. Rows are pressable
 * (chevron) or static (custom trailing slot), 44pt+ targets, and every value
 * line is a muted caption so the labels carry the scannability.
 */
export function ItemRow({
  icon,
  label,
  value,
  onPress,
  trailing,
  accessibilityLabel,
  destructive = false,
}: {
  icon: IconName
  label: string
  /** Quiet caption under the label. */
  value?: string | null
  onPress?: () => void
  /** Custom trailing content; defaults to a chevron when the row presses. */
  trailing?: ReactNode
  accessibilityLabel?: string
  /** Safety-toned label — destructive rows only. */
  destructive?: boolean
}) {
  const t = useTheme()
  const labelColor = destructive ? t.safety : t.text
  const content = (
    <>
      <Icon name={icon} size={20} color={labelColor} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: labelColor }]}>{label}</Text>
        {value ? <Text style={[type.caption, { color: t.textMuted }]}>{value}</Text> : null}
      </View>
      {trailing ?? (onPress ? <Icon name="chevron" size={18} color={t.textFaint} /> : null)}
    </>
  )
  const surface = [styles.row, { borderColor: t.border, backgroundColor: t.bgElevated }]
  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} style={surface}>
        {content}
      </View>
    )
  }
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={surface}
    >
      {content}
    </PressableFX>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TAP_TARGET + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
})
