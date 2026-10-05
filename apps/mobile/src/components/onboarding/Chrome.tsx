import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../Icon'
import { useTheme } from '../../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../../theme/tokens'

/**
 * Shared onboarding chrome: back chevron, progress bar, title, subtitle, and the
 * docked bottom action.
 *
 * Every screen in the flow uses this, which is what makes the flow feel like one
 * thing rather than twenty. The measurements are taken from the reference
 * walkthrough: a 44pt circular back button on a very light fill, a 6pt pill
 * progress track, a bold display-scale title with tight tracking (Wave 1a:
 * type.display per UI/UX report Table 3.1), and a full-width pill button docked
 * above the home indicator.
 */

export function ProgressBar({ step, total }: { step: number; total: number }) {
  const theme = useTheme()
  const pct = Math.max(0.02, Math.min(1, step / total))
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: step }}
      style={[styles.track, { backgroundColor: theme.bgSunkenStrong }]}
    >
      <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: theme.text }]} />
    </View>
  )
}

export function OnboardingHeader({
  step,
  total,
  onBack,
}: {
  step: number
  total: number
  /** Step-host hook-up: steps > 1 go back a STEP; step 1 falls back to router.back(). */
  onBack?: () => void
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack ?? (() => router.back())}
        hitSlop={space.sm}
        style={[styles.back, { backgroundColor: theme.bgChrome }]}
      >
        <View style={{ transform: [{ rotate: '180deg' }] }}>
          <Icon name="chevron" size={19} color={theme.text} weight={2.2} />
        </View>
      </Pressable>
      <View style={{ flex: 1, marginLeft: space.lg, marginRight: space.xs }}>
        {/* "Step N of M" — the textual counterpart of the progress bar, so the
            position in the flow is stated, not just drawn. */}
        <Text style={[type.caption, { color: theme.textMuted, marginBottom: space.xs }]}>
          Step {step} of {total}
        </Text>
        <ProgressBar step={step} total={total} />
      </View>
    </View>
  )
}

export interface OnboardingScreenProps {
  step: number
  total: number
  title: string
  subtitle?: string
  children?: ReactNode
  /** Primary action label. */
  cta?: string
  onCta: () => void
  ctaDisabled?: boolean
  /** Hint label to show above CTA when disabled */
  disabledHint?: string
  /** Secondary action beneath the primary, e.g. Skip or No. */
  secondaryLabel?: string
  onSecondary?: () => void
  /** Header back override (the step host steps back internally). */
  onBack?: () => void
  /** Content sits in a ScrollView when it can overflow. */
  scroll?: boolean
  /** Center the content block vertically, as the picker screens do. */
  centerContent?: boolean
}

export function OnboardingScreen({
  step,
  total,
  title,
  subtitle,
  children,
  cta = 'Continue',
  onCta,
  ctaDisabled = false,
  disabledHint,
  secondaryLabel,
  onSecondary,
  onBack,
  scroll = false,
  centerContent = false,
}: OnboardingScreenProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const body = (
    <>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text>
      ) : null}
      <View style={[styles.content, centerContent && { flex: 1, justifyContent: 'center' }]}>
        {children}
      </View>
    </>
  )

  return (
    // AGENTS §8.3: the keyboard must not hide the CTA. iOS lifts the dock with
    // padding (the repo-wide pattern); Android's adjustResize already shrinks
    // the window; web ignores it — the dock is in normal flow there.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <OnboardingHeader step={step} total={total} onBack={onBack} />

      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 180 }}
          showsVerticalScrollIndicator={false}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: space.lg }}>{body}</View>
      )}

      <View
        style={[
          styles.actions,
          {
            paddingBottom: Math.max(insets.bottom, space.lg),
            backgroundColor: theme.bg,
            borderTopColor: theme.border,
          },
        ]}
      >
        {ctaDisabled && disabledHint ? (
          /* PROTECT MOBILE: Render disabled hint with proper margin inside the flex container so we don't break layout on Android/iOS */
          <Text style={[type.label, { textAlign: 'center', marginBottom: 12, color: theme.textMuted }]}>
            {disabledHint}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: ctaDisabled }}
          disabled={ctaDisabled}
          onPress={onCta}
          style={[
            styles.primary,
            { backgroundColor: ctaDisabled ? theme.bgSunkenStrong : theme.text },
          ]}
        >
          {/* Wave 1a: CTA text drops the 18/17px overrides — bodyStrong is the
              button voice (UI/UX report Table 3.1). */}
          <Text style={[type.bodyStrong, { color: ctaDisabled ? theme.textMuted : theme.bg }]}>
            {cta}
          </Text>
        </Pressable>

        {secondaryLabel ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSecondary}
            hitSlop={space.sm}
            style={styles.secondary}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>
              {secondaryLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
  back: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
  title: {
    // Wave 1a: the onboarding screen title is a display moment (report
    // Table 3.1 — 36px ad-hoc joins display 56/60/800). Tight tracking comes
    // with the token.
    // Wave 4 wrap (report §11.1): display caps at 1.2× and 56×1.2 = 67.2
    // outgrows the token's lineHeight 60 — the 68 headroom keeps descenders
    // from clipping at the cap (same override as every display call site).
    ...type.display,
    lineHeight: 68,
    marginTop: space.xs,
  },
  subtitle: { ...type.body, marginTop: space.md },
  content: { marginTop: space.xl },
  actions: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: {
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
