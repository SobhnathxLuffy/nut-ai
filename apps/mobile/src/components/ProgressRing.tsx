import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useReducedMotion } from './PressableFX'
import { useTheme } from '../theme/ThemeProvider'
import { type } from '../theme/tokens'

/**
 * The ONE ProgressRing (UI/UX report Table 5.1 / Table 12.2, Wave 2).
 *
 * "Progress — 3 ring implementations → One ProgressRing (stroke + track)."
 *
 * One ring draws: a track circle, the primary stroke, and — when the day runs
 * OVER target — a second inner overflow arc (the Home rule: over target is
 * STATED, not scolded; the ring never clamps at 100% and lies about it).
 *
 * Table 9.1 "Ring / count-up: 600ms ease-out on focus": every value change
 * tweens the arc from where it currently sits to the new fraction over
 * 600ms, easing out. Reduce motion renders the new state instantly — the
 * information (the arc) still arrives, only the movement is dropped.
 *
 * React Native Animated with the JS driver only (report §9's library note —
 * reanimated is deliberately NOT enabled for the web export): the tween
 * drives arc + number through a listener, which keeps the SVG props
 * type-plain instead of threading Animated values through react-native-svg.
 */

/** Table 9.1: ring / count-up duration. */
export const RING_COUNT_MS = 600

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * Shared geometry — one formula for every ring (the audit's three rings each
 * hand-rolled their own radius arithmetic). Exported for the unit tests.
 */
export function ringGeometry(size: number, stroke: number): { r: number; circumference: number } {
  const r = size / 2 - stroke
  return { r, circumference: 2 * Math.PI * r }
}

export interface ProgressRingProps {
  /** Primary fraction 0..1; values above 1 clamp to a full ring. */
  value: number
  /**
   * Fraction beyond the target (0 = on/under target) — drawn as a thinner
   * inner arc in the uncertain colour, the honest overflow the report keeps.
   */
  overflow?: number
  /** Outer diameter, points. */
  size?: number
  /** Stroke width, points. */
  stroke?: number
  /** Stroke colour override (macro rings pass their identity colour). */
  color?: string
  /** Center content — the icon, hero number or label the ring frames. */
  children?: ReactNode
}

export function ProgressRing({
  value,
  overflow = 0,
  size = 128,
  stroke = 12,
  color,
  children,
}: ProgressRingProps) {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const { r, circumference } = ringGeometry(size, stroke)
  const innerR = r - stroke - 3
  const innerC = 2 * Math.PI * innerR

  // The fractions rendered this frame. Starts at zero so the FIRST real value
  // sweeps in — the "count-up on focus" moment for the hero number.
  const [display, setDisplay] = useState({ primary: 0, overflow: 0 })
  const current = useRef({ primary: 0, overflow: 0 })
  const tween = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const to = { primary: clamp01(value), overflow: clamp01(overflow) }
    if (reduced) {
      current.current = to
      setDisplay(to)
      return
    }
    const start = current.current
    tween.setValue(0)
    const stop = tween.addListener(({ value: t }) => {
      const next = {
        primary: start.primary + (to.primary - start.primary) * t,
        overflow: start.overflow + (to.overflow - start.overflow) * t,
      }
      current.current = next
      setDisplay(next)
    })
    Animated.timing(tween, {
      toValue: 1,
      duration: RING_COUNT_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        current.current = to
        setDisplay(to)
      }
    })
    return () => tween.removeListener(stop)
  }, [value, overflow, reduced, tween])

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.ringTrack} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color ?? theme.ring} strokeWidth={stroke} fill="none"
          strokeDasharray={`${circumference * display.primary} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {display.overflow > 0 ? (
          <Circle
            cx={size / 2} cy={size / 2} r={innerR}
            stroke={theme.uncertain} strokeWidth={stroke * 0.6} fill="none"
            strokeDasharray={`${innerC * display.overflow} ${innerC}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  )
}

/**
 * The count-up twin (Table 9.1, same 600ms ease-out): the hero number animates
 * WITH the ring instead of snapping, set in monoData tabular figures so the
 * digits align while they count — the report's §4.2 "numbers app" upgrade.
 */
export function CountUp({
  value,
  format = (n: number) => String(Math.round(n)),
  style,
}: {
  value: number
  /** Rendered form of each frame's value; keep the reference stable. */
  format?: (n: number) => string
  style?: StyleProp<TextStyle>
}) {
  const reduced = useReducedMotion()
  const [text, setText] = useState(() => format(0))
  const shown = useRef(0)
  const tween = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (reduced) {
      shown.current = value
      setText(format(value))
      return
    }
    const start = shown.current
    tween.setValue(0)
    const stop = tween.addListener(({ value: t }) => {
      const next = start + (value - start) * t
      shown.current = next
      setText(format(next))
    })
    Animated.timing(tween, {
      toValue: 1,
      duration: RING_COUNT_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        shown.current = value
        setText(format(value))
      }
    })
    return () => tween.removeListener(stop)
    // `format` is intentionally out of the deps: call sites pass inline
    // arrows, and a changing identity must not restart a running count.
  }, [value, reduced, tween])

  return <Text style={[type.monoData, style]}>{text}</Text>
}
