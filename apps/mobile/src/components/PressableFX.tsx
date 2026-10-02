import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Animated,
  Pressable,
  Platform,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useMotionScale, useTheme } from '../theme/ThemeProvider'
import { motion, stateLayerFor } from '../theme/tokens'

/**
 * PressableFX — UI/UX report Table 9.1 (Wave 2), the app-wide press feedback.
 *
 * "Press feedback: scale 0.97 + dim 6%, 120ms out. Job it does: confirms touch
 * on every Pressable."
 *
 * One wrapper, three jobs:
 *
 *   1. SCALE 0.97 while pressed — release eases back over 120ms (Table 9.1's
 *      own duration; the press-in joins at motion.instant, the token set's
 *      90ms). React Native Animated only — reanimated stays off the web
 *      bundle's import graph (report §9's library note, applied conservatively).
 *   2. DIM 6% — the stateLayer.pressed token (§4.3): a 6% ink overlay on the
 *      resting surface, never a hand-rolled opacity, and never a second
 *      dimming path the next screen can drift from.
 *   3. DISABLED carries the stateLayer.disabled token (38% + no shadow).
 *
 * Reduce motion (report §9: "collapsing to instant states when the user opts
 * out"): the scale/dim states still APPLY — feedback is information, not
 * decoration — but they land instantly with zero animation.
 *
 * Structure note: the caller's style lands on the inner Animated.View (the
 * visual box: background, padding, layout) and the Pressable wrapper hugs it,
 * so the hit area still covers the padding — the same hit box a plain
 * Pressable with that style would have. This keeps the transform, the state
 * layer and the caller's surface on ONE element instead of splitting them.
 */

/** Table 9.1: press scale. */
export const PRESS_SCALE = 0.97
/** Table 9.1: release ("out") duration, ms. */
export const PRESS_RELEASE_MS = 120
/** Press-in duration — motion.instant (90ms), the token set's nearest step. */
const PRESS_IN_MS = motion.instant

/**
 * Web half of the reduce-motion gate. react-native-web does not implement
 * AccessibilityInfo.isReduceMotionEnabled, so the media query is honoured
 * directly — the same check Screen.tsx and Toast.tsx make (§9.2).
 */
export function useWebReducedMotion(): boolean {
  const [webReducedMotion, setWebReducedMotion] = useState(false)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setWebReducedMotion(query.matches)
    const onChange = (event: MediaQueryListEvent) => setWebReducedMotion(event.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  return webReducedMotion
}

/** Both reduce-motion sources folded into one boolean: token scale + web query. */
export function useReducedMotion(): boolean {
  const motionScale = useMotionScale()
  return motionScale === 0 || useWebReducedMotion()
}

export function PressableFX({
  children,
  style,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style'> & {
  children: ReactNode
  /** Surface + layout style — goes on the scaled visual box. */
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const layers = stateLayerFor(theme.isDark)
  const scale = useRef(new Animated.Value(1)).current

  const animate = (to: number, duration: number) => {
    if (reduced) {
      // Reduce motion: the state applies instantly, with no choreography.
      scale.setValue(to)
      return
    }
    Animated.timing(scale, {
      toValue: to,
      duration,
      useNativeDriver: Platform.OS !== 'web',
    }).start()
  }

  const pressIn: PressableProps['onPressIn'] = (event) => {
    animate(PRESS_SCALE, PRESS_IN_MS)
    onPressIn?.(event)
  }
  const pressOut: PressableProps['onPressOut'] = (event) => {
    animate(1, PRESS_RELEASE_MS)
    onPressOut?.(event)
  }

  return (
    <Pressable {...rest} disabled={disabled} onPressIn={pressIn} onPressOut={pressOut}>
      {({ pressed }) => (
        <Animated.View
          style={[
            style,
            pressed && !disabled ? layers.pressed : null,
            disabled ? layers.disabled : null,
            { transform: [{ scale }] },
          ]}
        >
          {children}
        </Animated.View>
      )}
    </Pressable>
  )
}
