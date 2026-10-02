import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Icon } from './Icon'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'

/**
 * The expandable disclosure — UI/UX report Ch 8.8 + Table 12.3 (Wave 3).
 *
 * A row that expands in place to reveal detail: "collapsed by default,
 * expands on tap and stays open (the information is one tap away, never
 * deleted)". This is the pattern that lets Profile fold licenses, the medical
 * disclaimer and the provider's Advanced fields into sub-pages without losing
 * a single word of them.
 *
 * Same shape as the in-list ModelDiagnosticsDisclosure the Wave 1b round
 * introduced (label + rotating chevron + content below), promoted to a
 * primitive because three Wave 3 surfaces need it: Provider "Advanced",
 * About "Licenses" and "Medical disclaimer", and Profile's "How your numbers
 * work". A11y: role=button with an honest expanded state.
 */
export function Disclosure({
  label,
  caption,
  children,
  defaultOpen = false,
  accessibilityLabel,
}: {
  label: string
  /** Quiet caption under the label — the "what's inside" hint. */
  caption?: string
  children: ReactNode
  /** Collapsed by default; the whole point of the pattern. */
  defaultOpen?: boolean
  accessibilityLabel?: string
}) {
  const t = useTheme()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <View style={[styles.box, { borderColor: t.border, backgroundColor: t.bgElevated }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={styles.head}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.body, { color: t.text }]}>{label}</Text>
          {caption ? <Text style={[type.caption, { color: t.textMuted }]}>{caption}</Text> : null}
        </View>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chevron" size={16} color={t.textFaint} />
        </View>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: {
    minHeight: MIN_TAP_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  body: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    gap: space.sm,
  },
})
