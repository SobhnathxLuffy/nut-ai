import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { StyleProp, ViewStyle } from 'react-native'
import { Icon, type IconName } from './Icon'
import { PressableFX } from './PressableFX'
import { useMotionScale, useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, stateLayerFor, type } from '../theme/tokens'

/** One header action — icon-only, so the label is mandatory (report Ch. 6). */
export interface HeaderAction {
  icon: IconName
  /** Accessibility label; icon-only controls always carry one. */
  label: string
  onPress: () => void
}

/** How far the content must scroll before the large title fully collapses. */
const COLLAPSE_THRESHOLD = 48

/** Fixed height of the useAction busy slot (see `feedback` in useAction). */
const FEEDBACK_SLOT_HEIGHT = 24

/**
 * Reusable screen wrapper with safe areas, scrolling, and the ONE header.
 *
 * UI/UX report §7.2 (Wave 1c): an iOS-style large title (type.title, 28/700)
 * that collapses to a 17pt-class inline title in the fixed top bar as the
 * content scrolls, with a hairline border fading in at the same threshold.
 * The left slot is back (chevron) or close; the right slot carries up to two
 * icon actions. Under reduce-motion there is no choreography: the inline
 * title is shown statically, always.
 *
 * Backward compatibility (Wave 1a call sites): `title` + `back` behave exactly
 * as before — the text "Done" button becomes the chevron with `backLabel` as
 * its accessibility label; `headerActions` and `largeTitle` are new optional
 * props. The inline title maps the report's 17pt nav-bar size onto the scale's
 * bodyStrong token (Table 3.1) — ad-hoc sizes are banned by CI gate.
 */
export function Screen({
  title,
  children,
  back = false,
  backLabel = 'Done',
  backIcon = 'chevron',
  headerActions,
  largeTitle = true,
}: {
  title: string
  children: React.ReactNode
  back?: boolean
  backLabel?: string
  backIcon?: 'chevron' | 'close'
  headerActions?: HeaderAction[]
  largeTitle?: boolean
}) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const motionScale = useMotionScale()
  // Web: the Reduce Motion context covers native, but react-native-web does
  // not implement AccessibilityInfo.isReduceMotionEnabled, so honour the media
  // query directly — the same check Toast.tsx makes (§9.2: reduce-motion users
  // get the static inline header, never the collapse choreography).
  const [webReducedMotion, setWebReducedMotion] = useState(false)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setWebReducedMotion(query.matches)
    const onChange = (event: MediaQueryListEvent) => setWebReducedMotion(event.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  const animate = webReducedMotion ? false : motionScale !== 0

  // scrollY drives the collapse: large title scales/fades out while the
  // inline title + hairline fade in (§7.2). Interpolation is derived at render
  // from the single animated value — no per-frame state.
  const scrollY = useRef(new Animated.Value(0)).current
  const inlineOpacity = animate && largeTitle
    ? scrollY.interpolate({
        inputRange: [COLLAPSE_THRESHOLD - 24, COLLAPSE_THRESHOLD],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      })
    : 1
  const borderOpacity = animate && largeTitle
    ? scrollY.interpolate({
        inputRange: [COLLAPSE_THRESHOLD - 24, COLLAPSE_THRESHOLD],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      })
    : 1
  const largeOpacity = scrollY.interpolate({
    inputRange: [0, COLLAPSE_THRESHOLD],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  })
  const largeScale = scrollY.interpolate({
    inputRange: [0, COLLAPSE_THRESHOLD],
    outputRange: [1, 0.8],
    extrapolate: 'clamp',
  })

  // §7.2: "a right slot for one or two context actions as icons" — the cap is
  // part of the spec, so a long array degrades to the first two, silently.
  const actions = (headerActions ?? []).slice(0, 2)
  // The inline title is the ONLY header when it is shown statically (no large
  // title / reduce-motion); when it is the collapse twin it carries no heading
  // role, so screen readers announce ONE header — the large title — instead of
  // two. (Opacity-0 text remains in the a11y tree on RNW.)
  const inlineIsSoleHeader = !animate || !largeTitle

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Fixed top bar: left back/close slot, collapsing inline title, right
          icon actions. Safe-area padding lives here, not in the scroll content. */}
      <View style={{ paddingTop: insets.top }}>
        <View style={styles.navRow}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={backLabel}
              onPress={() => router.back()}
              hitSlop={space.sm}
              style={styles.navButton}
            >
              <View style={backIcon === 'chevron' ? styles.chevronFlip : undefined}>
                <Icon name={backIcon} size={20} color={t.text} />
              </View>
            </Pressable>
          ) : null}
          <Animated.Text
            numberOfLines={1}
            accessibilityRole={inlineIsSoleHeader ? 'header' : undefined}
            style={[type.bodyStrong, { color: t.text, flex: 1, opacity: inlineOpacity }]}
          >
            {title}
          </Animated.Text>
          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={action.onPress}
              hitSlop={space.sm}
              style={styles.navButton}
            >
              <Icon name={action.icon} size={20} color={t.text} />
            </Pressable>
          ))}
        </View>
        {/* Hairline bottom border that appears with the collapse (§7.2). */}
        <Animated.View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, opacity: borderOpacity }} />
      </View>

      <Animated.ScrollView
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={
          animate
            ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
                useNativeDriver: Platform.OS !== 'web',
              })
            : undefined
        }
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{
          padding: space.lg + 4,
          paddingTop: largeTitle && animate ? space.md : space.lg,
          paddingBottom: 180,
          gap: space.md + 2,
        }}
      >
        {largeTitle && animate ? (
          <Animated.Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[
              type.title,
              { color: t.text, opacity: largeOpacity, transform: [{ scale: largeScale }] },
            ]}
          >
            {title}
          </Animated.Text>
        ) : null}
        {children}
      </Animated.ScrollView>
    </View>
  )
}

/** Body text label — muted variant for secondary info. */
export function Label({
  children,
  muted = false,
}: {
  children: React.ReactNode
  muted?: boolean
}) {
  const t = useTheme()
  return (
    <Text style={[type.body, { color: muted ? t.textMuted : t.text }]}>{children}</Text>
  )
}

/** Card container with elevation and border. */
export function Card({ children }: { children: React.ReactNode }) {
  const t = useTheme()
  return (
    <View
      style={{
        padding: space.lg,
        gap: space.md,
        borderRadius: radius.xl,
        backgroundColor: t.bgElevated,
        borderWidth: 1,
        borderColor: t.border,
      }}
    >
      {children}
    </View>
  )
}

/**
 * The ONE Button (UI/UX report Table 5.1 / Table 12.2, Wave 2).
 *
 * "Rebuild one Button, 48/56pt, icon slot" — the 54–60pt hand-rolled pill CTAs
 * and the 48pt shared Button collapse into one primitive with two sizes:
 *   md (48pt, radius 14) — the compact action rows every screen already uses;
 *   lg (56pt, pill) — the migrated full-width CTA dialects (result "Log it",
 *   food-review "Save to diary", the assistant send button).
 *
 * Press feedback is Table 9.1 via PressableFX (scale 0.97 + the 6% ink state
 * layer, 120ms out, instant under reduce motion); pressed/disabled/focus come
 * from the §4.3 state-layer tokens so no call site can grow a private dialect.
 * `selected` keeps its Wave 1a meaning (the ink-filled primary surface) so all
 * 79 existing call sites compile and render unchanged.
 */
export type ButtonSize = 'md' | 'lg'

export function Button({
  label,
  onPress,
  disabled = false,
  selected = false,
  icon,
  size = 'md',
  style,
  accessibilityLabel: a11yLabel,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  selected?: boolean
  /** Icon slot (Table 5.1) — one glyph left of the label, theme-coloured. */
  icon?: IconName
  /** Two sizes (Table 12.2 "One Button, two sizes"): md 48pt, lg 56pt. */
  size?: ButtonSize
  /** Layout overrides (margin/flex) — merged after the primitive's style. */
  style?: StyleProp<ViewStyle>
  /** Screen-reader override (A11Y P1-4): compact visible labels stay short
   *  while the announced name carries the context (e.g. the exercise name). */
  accessibilityLabel?: string
}) {
  const t = useTheme()
  const isLg = size === 'lg'
  const contentColor = selected ? t.bg : t.text
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[
        {
          minHeight: isLg ? 56 : 48,
          paddingHorizontal: isLg ? space.xl : 14,
          paddingVertical: isLg ? space.md : 12,
          borderRadius: isLg ? radius.pill : radius.md + 2,
          // Wave 4 (report §3.2): the selected fill re-points to the new
          // accent slot — same ink dialect t.text resolved to before, now a
          // named token the contrast gate checks. Zero visual change.
          backgroundColor: selected ? t.accent : t.bgSunken,
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          gap: space.sm,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={isLg ? 22 : 18} color={contentColor} /> : null}
      <Text style={[type.bodyStrong, { color: contentColor }]}>{label}</Text>
    </PressableFX>
  )
}

/**
 * The ONE labelled Field (UI/UX report Table 5.1 / Table 12.2, Wave 2):
 * "One Field, error + hint slots."
 *
 *   label  — muted caption above the input (unchanged Wave 1a shape).
 *   error  — safety-coloured caption under the input (§10.1: "inline
 *            validation stays inline, Field error slots"); the border turns
 *            safety while an error is present.
 *   hint   — muted caption under the input for quiet guidance.
 *   focus  — the §4.3 stateLayer.focus token (2px accent ring) on web, where
 *            external-keyboard users tab through forms; touch platforms never
 *            show it (there is no hover/tab focus to ring).
 */
export function Field({
  label,
  error,
  hint,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & {
  label: string
  /** Error slot — safety colour, caption size; also drives the safety border. */
  error?: string | null
  /** Hint slot — muted caption under the input. */
  hint?: string | null
}) {
  const t = useTheme()
  const layers = stateLayerFor(t.isDark)
  const [focused, setFocused] = useState(false)
  return (
    <View style={{ gap: 4, flexGrow: 1 }}>
      <Label muted>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.textFaint}
        {...props}
        // Wave 4 wrap (report §11.1): Android's TextInput ships with font
        // scaling OFF — the explicit prop keeps this labelled input growing
        // with the OS font size, matching the compact Field primitive. No
        // cap: user content grows freely; the input is minHeight, not fixed.
        allowFontScaling
        onFocus={(event) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
        style={[
          {
            color: t.text,
            borderColor: error ? t.safety : t.border,
            borderWidth: 1,
            borderRadius: radius.md,
            minHeight: 48,
            padding: space.md,
            // Wave 1a: inputs sit at type.body (UI/UX report Table 3.1 —
            // 17px ad-hoc input size joins the 16/24 body token).
            fontSize: type.body.fontSize,
          },
          props.style,
          // The focus ring rides LAST so a caller's border override (error
          // colours, sunken surfaces) cannot smother it while focused.
          focused && Platform.OS === 'web' ? layers.focus : null,
        ]}
      />
      {error ? (
        <Text accessibilityRole="alert" style={[type.caption, { color: t.safety }]}>
          {error}
        </Text>
      ) : null}
      {hint ? <Text style={[type.caption, { color: t.textMuted }]}>{hint}</Text> : null}
    </View>
  )
}

/** Horizontal flex row with wrapping. */
export function Row({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
      {children}
    </View>
  )
}

/**
 * Hook for async actions with loading/error state and automatic refresh.
 */
export function useAction(refresh?: () => Promise<void>) {
  const t = useTheme()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isBusyRef = useRef(false)

  async function run(action: () => Promise<unknown>) {
    if (isBusyRef.current) return
    isBusyRef.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      isBusyRef.current = false
      setBusy(false)
    }
  }

  return {
    run,
    error,
    busy,
    feedback: (
      <>
        {/* T1-b (routines.tsx jitter amplifier): the busy spinner mounts and
            unmounts INSIDE a constant-height slot, so per-action busy
            toggling can never shift the gap-based scroll content below it.
            Additive: every caller already renders {action.feedback}; the
            slot costs a constant 24px row, never a height change. */}
        <View style={{ height: FEEDBACK_SLOT_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
          {busy && <ActivityIndicator accessibilityLabel="Saving" />}
        </View>
        {!!error && (
          <View style={{ gap: 8, paddingVertical: 4 }}>
            <Text accessibilityRole="alert" style={[type.body, { color: t.safety }]}>
              {error}
            </Text>
            {refresh && (
              <Button label="Retry" selected onPress={() => void run(refresh)} />
            )}
          </View>
        )}
      </>
    ),
  }
}

const styles = StyleSheet.create({
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.sm,
  },
  navButton: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The set's chevron points right (forward); the back slot needs left, so the
  // glyph mirrors horizontally rather than growing a second chevron asset.
  chevronFlip: { transform: [{ scaleX: -1 }] },
})
