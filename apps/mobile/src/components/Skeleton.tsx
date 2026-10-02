import { useEffect, useRef, useState } from 'react'
import { Animated, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useMotionScale, useTheme } from '../theme/ThemeProvider'
import { radius, space } from '../theme/tokens'

/**
 * The Skeleton primitive — UI/UX Transformation Report §9.2 / Table 9.1 (Wave 1c).
 *
 * NN/g placement rules, adopted wholesale:
 *   - under 1s: show NOTHING (flash-and-vanish placeholders annoy);
 *   - 1–10s: skeletons that MIMIC the coming layout (what this file draws);
 *   - over 10s (streaming): spinner + textual progress — those paths
 *     deliberately never render a Skeleton.
 *   - EXCEPTION (UI/UX report §8.4, Wave 3): the scan ANALYZING state is
 *     over-10s, but the report explicitly wants a skeleton INGREDIENT LIST
 *     building while the model works. The two rules are reconciled, not
 *     traded: result.tsx keeps the spinner AND the honest stage copy AND adds
 *     the content-shaped list — structure plus textual progress together.
 *   - frame-only skeletons (chrome with no content placeholders) are forbidden;
 *     every composition below places content-shaped blocks.
 *
 * The shimmer is ONE slow sweep — 1.2s loop, a 20% band crossing the block —
 * never a pulse or a strobe: NN/g flags aggressive placeholder animation as an
 * accessibility risk. Under reduce-motion (useMotionScale() === 0) the loop is
 * never constructed and the block renders as a static 8% ink fill (the theme's
 * `skeletonBase` token), so it still communicates structure without movement.
 */

/** Table 9.1: "Skeleton shimmer — 1.2s loop, 20% sweep". */
export const SKELETON_SWEEP_MS = 1200
export const SKELETON_SWEEP_WIDTH_RATIO = 0.2

/**
 * The reduce-motion gate, extracted so it is testable in the plain-Node vitest
 * environment (the same discipline as toast-store). When false, the Animated
 * loop in the component is never started — the block is static ink.
 */
export function shimmerEnabled(motionScale: number): boolean {
  return motionScale !== 0
}

export interface SkeletonProps {
  /** Fixed px or a `${number}%` string, exactly like RN width styles. */
  width?: number | `${number}%`
  height?: number
  radius?: number
  style?: StyleProp<ViewStyle>
}

/** One skeleton block. Compose these to mimic the layout that is coming. */
export function Skeleton({ width = '100%', height = 16, radius: r = radius.md, style }: SkeletonProps) {
  const theme = useTheme()
  const motionScale = useMotionScale()
  const shimmer = shimmerEnabled(motionScale)
  const progress = useRef(new Animated.Value(0)).current
  // The sweep band travels in px, so percent widths are measured once after
  // layout; until then the band simply has no width to sweep through.
  const [measuredWidth, setMeasuredWidth] = useState(0)

  useEffect(() => {
    if (!shimmer) return // reduce-motion: no loop is ever constructed or started
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SKELETON_SWEEP_MS,
        useNativeDriver: Platform.OS !== 'web',
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [shimmer, progress])

  const bandWidth = measuredWidth * SKELETON_SWEEP_WIDTH_RATIO
  const sweepX = shimmer
    ? progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-bandWidth, measuredWidth],
      })
    : undefined

  return (
    <View
      accessibilityLabel="Loading"
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width
        setMeasuredWidth((prev) => (prev === w ? prev : w))
      }}
      style={[styles.block, { width, height, borderRadius: r, backgroundColor: theme.skeletonBase }, style]}
    >
      {shimmer && bandWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.sweep, { width: bandWidth, backgroundColor: theme.skeletonSweep }, sweepX != null && { transform: [{ translateX: sweepX }] }]}
        />
      ) : null}
    </View>
  )
}

/** A single text-line placeholder — the atom of every list/card composition. */
export function SkeletonLine({ width = '100%', height = 14, radius: r = radius.sm }: { width?: number | `${number}%`; height?: number; radius?: number }) {
  return <Skeleton width={width} height={height} radius={r} />
}

/**
 * A list-row placeholder: optional leading avatar circle plus 2–3 tapering
 * text lines. This is the shape of food-search results, timeline rows and
 * assistant replies — the three 1–10s windows the report calls out.
 */
export function SkeletonRow({ lines = 2, avatar = false }: { lines?: number; avatar?: boolean }) {
  const row: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  }
  return (
    <View style={row}>
      {avatar ? <Skeleton width={40} height={40} radius={radius.pill} /> : null}
      <View style={{ flex: 1, gap: space.xs }}>
        <SkeletonLine height={16} />
        {lines > 1 ? <SkeletonLine width="70%" height={12} /> : null}
        {lines > 2 ? <SkeletonLine width="45%" height={12} /> : null}
      </View>
    </View>
  )
}

/** A card-sized placeholder — chart bodies, hero cards, timeline cards. */
export function SkeletonCard({ height = 120, lines = 0, radius: r = radius.xl }: { height?: number; lines?: number; radius?: number }) {
  return (
    <View style={{ gap: space.sm }}>
      {lines > 0 ? <SkeletonLine width="40%" height={14} /> : null}
      <Skeleton height={height} radius={r} />
      {lines > 1 ? <SkeletonLine width="55%" height={12} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  block: {
    overflow: 'hidden', // the sweep band is clipped to the block's rounded rect
  },
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
})
