import { Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Icon, type IconName } from './Icon'
import { PressableFX } from './PressableFX'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'
import type { Theme } from '../theme/tokens'

/**
 * The ONE Badge (UI/UX report Table 5.1 / Table 12.2, Wave 2).
 *
 * "Badge / Chip — 5 chip implementations → One Badge/Chip with variants."
 *
 * Five families collapsed: the ConfidenceChip (uncertain), the progress
 * section/window chips (default + selected), the camera mode pills (icon +
 * selected), macro identity chips (protein/carbs/fat) and the tone chips
 * (affirm/safety/uncertain). Every surface resolves to theme tokens; the
 * macro and tone washes come from the dedicated tint tokens so no chip can
 * hand-roll a wash again.
 *
 * Interactive badges (an `onPress`) carry the 44pt tap target (report
 * Table 11.1: "44pt in primitives; hitSlop only for icons"), the button role,
 * the selected state, and the Table 9.1 press feedback via PressableFX.
 */

export type BadgeVariant =
  | 'default'
  | 'outline'
  | 'selected'
  | 'protein'
  | 'carbs'
  | 'fat'
  | 'affirm'
  | 'safety'
  | 'uncertain'

export type BadgeSize = 'sm' | 'md'

export interface BadgeProps {
  /** Text label; optional when `children` override the content entirely. */
  label?: string
  variant?: BadgeVariant
  size?: BadgeSize
  /** Optional leading glyph (report Ch. 6.3: primitives grow icon slots). */
  icon?: IconName
  /** Present → interactive: 44pt target, button role, press feedback. */
  onPress?: () => void
  /** Interactive selection state — flips the surface to the ink dialect. */
  selected?: boolean
  accessibilityLabel?: string
  /**
   * A11y role override for interactive badges — 'button' (default) or 'radio'
   * (a Badge inside a radiogroup, e.g. the camera's Quick/Advanced segmented
   * pair, UI/UX report §8.4).
   */
  role?: 'button' | 'radio'
  /** Only for icons; an interactive chip IS the 44pt target (Table 11.1). */
  hitSlop?: number
  style?: StyleProp<ViewStyle>
  /** Content override — e.g. ConfidenceChip's glyph + range label pair. */
  children?: React.ReactNode
}

interface BadgeColors {
  bg: string
  fg: string
  border: string | null
}

/**
 * Variant → token colour mapping. Exported for the unit tests (the repo's
 * established pattern: pure mappings are asserted against the real tokens).
 *
 * Wave 4 (report Table 11.1): macro/tone LABELS use the text-grade *Text
 * slots — the identity colours stay on icons/strokes. Light badge text pairs
 * were 1.86–3.44:1; the grades lift them to ≥4.5:1 on the same tints.
 */
export function badgeColorsFor(variant: BadgeVariant, t: Theme): BadgeColors {
  switch (variant) {
    case 'selected':
      return { bg: t.text, fg: t.bg, border: null }
    case 'outline':
      return { bg: 'transparent', fg: t.text, border: t.border }
    case 'protein':
      return { bg: t.proteinTint, fg: t.proteinText, border: null }
    case 'carbs':
      return { bg: t.carbsTint, fg: t.carbsText, border: null }
    case 'fat':
      return { bg: t.fatTint, fg: t.fatText, border: null }
    case 'affirm':
      return { bg: t.affirmTint, fg: t.affirmText, border: null }
    case 'safety':
      return { bg: t.safetyBg, fg: t.safety, border: null }
    case 'uncertain':
      return { bg: t.uncertainBg, fg: t.uncertainText, border: null }
    default:
      return { bg: t.bgSunken, fg: t.text, border: null }
  }
}

export function Badge({
  label,
  variant = 'default',
  size = 'md',
  icon,
  onPress,
  selected = false,
  accessibilityLabel,
  role = 'button',
  hitSlop,
  style,
  children,
}: BadgeProps) {
  const t = useTheme()
  const base = badgeColorsFor(variant, t)
  // The interactive selection flips the surface exactly like the old progress
  // chips did (selected ? ink : sunken) — one dialect, not per-screen.
  const colors: BadgeColors =
    selected && variant !== 'selected' ? { bg: t.text, fg: t.bg, border: null } : base
  const interactive = onPress != null
  const isSm = size === 'sm'

  const surface: StyleProp<ViewStyle> = [
    {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.xs,
      alignSelf: 'flex-start',
      borderRadius: radius.pill,
      paddingHorizontal: isSm ? space.md : space.md + 2,
      paddingVertical: isSm ? space.xs + 2 : space.sm,
      minHeight: interactive ? MIN_TAP_TARGET : undefined,
      backgroundColor: colors.bg,
    },
    colors.border != null ? { borderWidth: 1, borderColor: colors.border } : null,
    style,
  ]

  const content = (
    <>
      {icon ? <Icon name={icon} size={isSm ? 14 : 16} color={colors.fg} /> : null}
      {children ?? (label != null ? (
        <Text style={[isSm ? type.caption : type.label, { color: colors.fg }]}>{label}</Text>
      ) : null)}
    </>
  )

  if (!interactive) {
    return (
      <View accessibilityLabel={accessibilityLabel} style={surface}>
        {content}
      </View>
    )
  }

  return (
    <PressableFX
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={role === 'radio' ? { checked: selected } : { selected }}
      // react-native-web (this version) does not translate accessibilityState
      // into DOM aria-* attributes, so the web half is passed flat: a radio
      // Badge exposes aria-checked; a button Badge is a segmented toggle, whose
      // selected mode is aria-pressed (aria-selected is not valid on role=button).
      // Native keeps reading accessibilityState; RN 0.74+ also understands the
      // flat props, so both dialects agree on one truth.
      aria-checked={role === 'radio' ? selected : undefined}
      aria-pressed={role === 'radio' ? undefined : selected}
      onPress={onPress}
      hitSlop={hitSlop}
      style={surface}
    >
      {content}
    </PressableFX>
  )
}
