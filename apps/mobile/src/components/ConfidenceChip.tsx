import { Text, View } from 'react-native'
import type { Band } from '@nutai/confidence'
import { TIER_GLYPH, rangeFor } from '@nutai/confidence'
import { Badge } from './Badge'
import { useTheme } from '../theme/ThemeProvider'
import { space, type } from '../theme/tokens'

/**
 * The confidence chip.
 *
 * SPEC-ui.md §0.2 rule 1: a number the app is unsure about must LOOK unsure,
 * everywhere it appears. This is the product's whole reason to exist, and it is
 * exactly what the incumbent's result screen is confirmed never to show — "no
 * confidence score, error range, or uncertainty indicator of any kind", converged
 * across four independent sources.
 *
 * Two deliberate choices:
 *
 *   COLOUR is violet, never amber or red. Low confidence is an invitation to
 *   check, not a scold. Red belongs to safety warnings only.
 *
 *   The GLYPH carries the tier independently of colour, so confidence survives
 *   protanopia, deuteranopia, tritanopia and a greyscale screenshot. Colour alone
 *   would fail the accessibility bar in §8.5.
 */
export function ConfidenceChip({
  value,
  band,
  unit = 'kcal',
  expanded,
  onPress,
}: {
  value: number
  band: Band
  unit?: string
  expanded?: boolean
  onPress?: () => void
}) {
  const theme = useTheme()
  const { low, high } = rangeFor(value, band)

  // A band this tight is not worth qualifying — saying "estimate" about a printed
  // label reads as false modesty and trains people to ignore the signal.
  if (band.tier === 'none') return null

  const label = expanded
    ? `${Math.round(low)}–${Math.round(high)} ${unit}`
    : 'Estimate — tap for range'

  // UI/UX report Table 5.1 / Table 12.2 (Wave 2): the chip's private surface
  // joins the ONE Badge (variant="uncertain" keeps the violet identity +
  // uncertainBg wash); the 44pt interactive target and press feedback arrive
  // with it. The public API (value/band/unit/expanded/onPress) is unchanged.
  return (
    <Badge
      variant="uncertain"
      size="sm"
      onPress={onPress}
      accessibilityLabel={`Estimated ${Math.round(value)} ${unit}, likely between ${Math.round(low)} and ${Math.round(high)}. Tap for why.`}
      hitSlop={space.sm}
    >
      {/* Wave 1a: the tier GLYPH rides the caption token (13px ad-hoc → 12.5,
          UI/UX report Table 3.1) — glyphs follow the same scale as text. */}
      <Text style={[type.caption, { color: theme.uncertain }]}>{TIER_GLYPH[band.tier]}</Text>
      <Text style={[type.caption, { color: theme.uncertain }]}>{label}</Text>
    </Badge>
  )
}

/** The reasons list, revealed when the chip is tapped. Never hidden behind a modal. */
export function ConfidenceReasons({ band }: { band: Band }) {
  const theme = useTheme()
  if (band.reasons.length === 0) return null
  return (
    <View style={{ marginTop: space.sm, gap: space.xs }}>
      {band.reasons.map((r) => (
        <Text key={r} style={[type.caption, { color: theme.textMuted }]}>
          • {r}
        </Text>
      ))}
    </View>
  )
}
