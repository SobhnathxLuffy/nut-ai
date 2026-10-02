import { useEffect, useRef, useState } from 'react'
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from './Icon'
import {
  dismissToast,
  pressToastAction,
  subscribeToast,
  type ToastEntry,
} from './toast-store'
import { useMotionScale, useTheme } from '../theme/ThemeProvider'
import { elevationStyle, MIN_TAP_TARGET, motion, radius, space, type } from '../theme/tokens'

/**
 * The toast HOST — UI/UX Transformation Report §10.1 (Wave 1b).
 *
 * "The toast system (sonner-native pattern: queued, top-anchored,
 * swipe-dismissable, one visible at a time) becomes the default feedback for
 * reversible outcomes."
 *
 * Mounted exactly ONCE, at the app root (app/_layout.tsx), above the Stack so
 * it overlays every screen and survives navigation — a toast fired by the
 * result screen must still be tappable after `router.dismissAll()`. All state
 * lives in ./toast-store (pure, unit-tested); this file is presentation only:
 *
 *   - top-anchored, safe-area aware, capped width on tablets/web
 *   - swipe (or fling) horizontally to dismiss; release short snaps back
 *   - ~4s auto-dismiss is owned by the store, not this component
 *   - reduce motion (ThemeProvider's useMotionScale + the web media query)
 *     collapses every duration to 0 — instant show/hide, no movement
 *   - web-compatible by construction: react-native-web primitives only,
 *     Animated with the JS driver on web, PanResponder over pointer events
 *
 * Report §10.1 rules, enforced by convention at the call sites: toasts confirm
 * success and offer the next action; they never ask questions.
 */

/** Enough upward travel to clear any card height + top inset. */
const ENTER_OFFSET = -160
const SWIPE_DISMISS_DX = 80
const SWIPE_DISMISS_DY = -70

export function Toast() {
  const theme = useTheme()
  const motionScale = useMotionScale()
  const insets = useSafeAreaInsets()

  // The store drives truth; `rendered` is kept through the exit animation so
  // the card can slide out instead of vanishing on the frame it is dismissed.
  const [rendered, setRendered] = useState<ToastEntry | null>(null)
  const [visible, setVisible] = useState(false)

  // Web: the Reduce Motion context covers native; react-native-web does not
  // implement AccessibilityInfo.isReduceMotionEnabled, so honour the media
  // query directly (the same check src/ui/alert-web.ts makes for dialogs).
  const [webReducedMotion, setWebReducedMotion] = useState(false)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setWebReducedMotion(query.matches)
    const onChange = (event: MediaQueryListEvent) => setWebReducedMotion(event.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  const scale = webReducedMotion ? 0 : motionScale

  const anim = useRef(new Animated.Value(0)).current // 0 hidden → 1 shown
  const pan = useRef(new Animated.ValueXY()).current
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 8 || gesture.dy < -8,
      onPanResponderMove: (_event, gesture) => {
        // Follow the finger; only upward vertical travel reads as dismissal.
        pan.setValue({ x: gesture.dx, y: Math.min(0, gesture.dy) })
      },
      onPanResponderRelease: (_event, gesture) => {
        const flung = Math.abs(gesture.dx) > 36 && Math.abs(gesture.vx) > 0.8
        const dismiss =
          Math.abs(gesture.dx) > SWIPE_DISMISS_DX || gesture.dy < SWIPE_DISMISS_DY || flung
        if (dismiss) {
          dismissToast()
        } else {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start()
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start()
      },
    }),
  ).current

  useEffect(
    () =>
      subscribeToast((snapshot) => {
        if (snapshot.current) {
          pan.setValue({ x: 0, y: 0 })
          setRendered(snapshot.current)
          setVisible(true)
        } else {
          setVisible(false)
        }
      }),
    [pan],
  )

  useEffect(() => {
    if (visible) {
      if (scale === 0) {
        anim.setValue(1)
        return
      }
      Animated.timing(anim, {
        toValue: 1,
        duration: motion.base * scale,
        useNativeDriver: Platform.OS !== 'web',
      }).start()
      return
    }
    if (scale === 0) {
      anim.setValue(0)
      setRendered(null)
      return
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: motion.fast * scale,
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      // Only unmount when this exit is still the latest one.
      if (finished) setRendered(null)
    })
  }, [visible, scale, anim])

  if (!rendered) return null

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [ENTER_OFFSET, 0] })
  const opacity = anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] })
  const toneColor = rendered.tone === 'error' ? theme.safety : theme.text
  // Top-anchored below the status bar / notch (report §10.1).
  const topOffset = insets.top + space.sm

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      {/* The outer wrapper stretches to the layer's width (capped at 520 so
          tablets/web get a phone-width toast) — the card inside just fills it. */}
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${rendered.message}${rendered.action ? `. Action: ${rendered.action.label}` : ''}`}
        style={[styles.wrap, { opacity, transform: [{ translateY }] }]}
      >
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: theme.bgElevated, marginTop: topOffset },
            elevationStyle('medium', theme.isDark),
            pan.getTranslateTransform(),
          ]}
          {...panResponder.panHandlers}
        >
          {rendered.tone === 'success' ? (
            <Icon name="check" size={18} color={theme.affirm} weight={2.4} />
          ) : null}
          <Text numberOfLines={3} style={[type.label, { color: toneColor, flex: 1 }]}>
            {rendered.message}
          </Text>
          {rendered.action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={rendered.action.label}
              onPress={pressToastAction}
              hitSlop={space.sm}
              style={styles.action}
            >
              <Text style={[type.label, { color: theme.protein, fontWeight: '600' }]}>
                {rendered.action.label}
              </Text>
            </Pressable>
          ) : null}
        </Animated.View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Top-anchored overlay (report §10.1). box-none so only the card itself
  // intercepts touches — the screen behind stays fully interactive.
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Auto margins center the (max-width-capped) layer inside the full-width
    // left/right bounds; on phones the layer is simply full-width. Phone-width
    // toast, centered, everywhere.
    marginHorizontal: 'auto',
    maxWidth: 520 + 2 * space.lg,
    // Below the DOM dialog shim (2147483000) so a visible toast never
    // covers a confirmation dialog.
    zIndex: 2147482000,
  },
  card: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
  },
  wrap: {
    alignSelf: 'stretch',
    marginHorizontal: space.lg,
  },
  action: {
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
})
