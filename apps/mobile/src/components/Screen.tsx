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
import { Icon, type IconName } from './Icon'
import { useMotionScale, useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'

/** One header action — icon-only, so the label is mandatory (report Ch. 6). */
export interface HeaderAction {
  icon: IconName
  /** Accessibility label; icon-only controls always carry one. */
  label: string
  onPress: () => void
}

/** How far the content must scroll before the large title fully collapses. */
const COLLAPSE_THRESHOLD = 48

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

/** Standard button with selected and disabled states. */
export function Button({
  label,
  onPress,
  disabled = false,
  selected = false,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  selected?: boolean
}) {
  const t = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 48,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: radius.md + 2,
        backgroundColor: selected ? t.text : t.bgSunken,
        opacity: disabled ? 0.5 : 1,
        justifyContent: 'center',
      }}
    >
      <Text style={[type.bodyStrong, { color: selected ? t.bg : t.text }]}>{label}</Text>
    </Pressable>
  )
}

/** Text input with label. */
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const t = useTheme()
  return (
    <View style={{ gap: 4, flexGrow: 1 }}>
      <Label muted>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.textFaint}
        {...props}
        style={[
          {
            color: t.text,
            borderColor: t.border,
            borderWidth: 1,
            borderRadius: radius.md,
            minHeight: 48,
            padding: space.md,
            // Wave 1a: inputs sit at type.body (UI/UX report Table 3.1 —
            // 17px ad-hoc input size joins the 16/24 body token).
            fontSize: type.body.fontSize,
          },
          props.style,
        ]}
      />
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
        {busy && <ActivityIndicator accessibilityLabel="Saving" />}
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
