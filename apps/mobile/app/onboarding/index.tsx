import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CountUp, ProgressRing } from '../../src/components/ProgressRing'
import { Skeleton, SkeletonLine } from '../../src/components/Skeleton'
import { useReducedMotion } from '../../src/components/PressableFX'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { elevationStyle, MIN_TAP_TARGET, radius, space, type } from '../../src/theme/tokens'

/**
 * Welcome — with a LIVE DEMO of the scan (UI/UX report Ch. 8.1: the tilted
 * phone mock is replaced by "a live demo of the scan", the Cal AI pattern of
 * showing product value before asking for setup).
 *
 * The demo plays the real flow's shape — photo → scanning → result → day — on
 * a loop. It is honest by construction:
 *   - it is LABELLED a demo, and says the user's numbers will be theirs;
 *   - the scanning phase shows the SAME skeleton rows the real analyzing state
 *     uses (report §8.4: skeleton list, not a vendor caption);
 *   - the numbers are arithmetic-coherent (rows sum to 613 kcal; 613 + 1019
 *     already logged = 1,632 of 2,400 — the ring's 0.68 is 1,632/2,400);
 *   - no vendor or model name appears mid-scan (that lives in diagnostics).
 *
 * Two deliberate departures from the reference survive:
 *
 *   NO "Already have an account? Sign In". There are no accounts. There is no
 *   server. Offering a sign-in link that cannot work would be the first thing a
 *   new user tapped and the first promise broken.
 *
 *   NO language pill. English is the only shipped locale; a picker with one
 *   option is a control that lies about what it does.
 */

type Phase = 'photo' | 'scanning' | 'result'

const PHASE_MS: Record<Phase, number> = { photo: 1600, scanning: 2600, result: 5200 }

/** Demo rows — coherent arithmetic: 210 + 208 + 195 = 613 kcal. */
const DEMO_ROWS = [
  { name: 'Dal makhani', kcal: 210 },
  { name: 'Roti × 2', kcal: 208 },
  { name: 'Rice', kcal: 195 },
] as const

const DEMO_MEAL_KCAL = 613
const DEMO_DAY_KCAL = 1632
const DEMO_DAY_TARGET = 2400

/** The scanning sweep crosses the photo tile — Table 9.1's calm, no strobe. */
const SCAN_SWEEP_MS = 1500
const TILE_H = 150

export default function Welcome() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<Phase>('photo')

  // The loop only runs with motion enabled; reduce-motion renders the finished
  // state directly — the demo still communicates, minus the movement.
  const effective: Phase = reduced ? 'result' : phase

  useEffect(() => {
    if (reduced) return
    const t = setTimeout(() => {
      setPhase((p) => (p === 'photo' ? 'scanning' : p === 'scanning' ? 'result' : 'photo'))
    }, PHASE_MS[phase])
    return () => clearTimeout(t)
  }, [phase, reduced])

  const sweep = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (effective !== 'scanning') return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: SCAN_SWEEP_MS, useNativeDriver: false }),
        Animated.timing(sweep, { toValue: 0, duration: SCAN_SWEEP_MS, useNativeDriver: false }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [effective, sweep])

  const scanning = effective === 'scanning'
  const result = effective === 'result'

  return (
    <View style={[styles.root, { backgroundColor: theme.bg, paddingTop: insets.top + space.lg }]}>
      <View style={styles.hero}>
        <View
          style={[styles.demoCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }, elevationStyle('subtle', theme.isDark)]}
        >
          {/* The photo tile: the "meal" being scanned. */}
          <View style={[styles.tile, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
            <Icon name="bowl" size={40} color={theme.textMuted} />
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm }]}>
              {result ? 'Your plate, scanned' : 'Your plate'}
            </Text>

            {scanning ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.scanLine,
                  {
                    backgroundColor: theme.text,
                    transform: [
                      {
                        translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [10, TILE_H - 30] }),
                      },
                    ],
                  },
                ]}
              />
            ) : null}
          </View>

          {scanning ? (
            <View style={{ marginTop: space.lg, gap: space.md }}>
              {/* The SAME skeleton-row language the real analyzing state uses
                  (report §8.4) — the demo previews the wait, not a vendor. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Skeleton width={36} height={36} radius={radius.pill} />
                <View style={{ flex: 1 }}>
                  <SkeletonLine height={14} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Skeleton width={36} height={36} radius={radius.pill} />
                <View style={{ flex: 1 }}>
                  <SkeletonLine height={14} />
                </View>
              </View>
              <Text style={[type.caption, { color: theme.textFaint }]}>Scanning your photo…</Text>
            </View>
          ) : null}

          {result ? (
            <View style={{ marginTop: space.lg, gap: space.sm }}>
              {DEMO_ROWS.map((row) => (
                <View key={row.name} style={styles.resultRow}>
                  <View style={[styles.rowGlyph, { backgroundColor: theme.bgSunkenVariant }]}>
                    <Icon name="bowl" size={16} color={theme.text} />
                  </View>
                  <Text style={[type.body, { color: theme.text, flex: 1 }]}>{row.name}</Text>
                  <Text style={[type.monoData, { color: theme.text }]}>{row.kcal} kcal</Text>
                </View>
              ))}

              {/* The day summary: the ring sweeps to 0.68 (1,632 of 2,400) and
                  the number counts up in tabular figures (Table 9.1). */}
              <View style={styles.dayRow}>
                <ProgressRing value={0.68} size={104} stroke={9} />
                <View style={{ flex: 1, paddingLeft: space.lg, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                    <CountUp value={DEMO_DAY_KCAL} />
                    <Text style={[type.body, { color: theme.textMuted }]}> / {DEMO_DAY_TARGET} kcal</Text>
                  </View>
                  <Text style={[type.caption, { color: theme.textMuted }]}>today, after this meal</Text>
                  <Text style={[type.caption, { color: theme.textFaint }]}>
                    +{DEMO_MEAL_KCAL} kcal logged from one photo
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {!scanning && !result ? (
            <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, textAlign: 'center' }]}>
              Watch the scan →
            </Text>
          ) : null}
        </View>

        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.md }]}>
          A demo of the scan — your photos and your numbers will be yours.
        </Text>
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space.xl) }]}>
        <Text style={[styles.title, { color: theme.text }]}>Calorie tracking{'\n'}made easy</Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/onboarding/activity' as never)}
          style={[styles.cta, { backgroundColor: theme.text }]}
        >
          {/* Wave 1a: CTA text drops the 18px override — bodyStrong is the
              button voice (UI/UX report Table 3.1). */}
          <Text style={[type.bodyStrong, { color: theme.bg }]}>Get Started</Text>
        </Pressable>

        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.lg }]}>
          No account. No subscription. Your food data never leaves this device.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/onboarding/restore' as never)}
          hitSlop={space.sm}
          style={{ marginTop: space.md, alignSelf: 'center' }}
        >
          <Text style={[type.label, { color: theme.textMuted, textDecorationLine: 'underline' }]}>
            Restore from a backup
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  demoCard: {
    width: 312,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
  },
  tile: {
    height: TILE_H,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scanLine: { position: 'absolute', left: space.lg, right: space.lg, height: 2.5, borderRadius: 2, opacity: 0.6 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowGlyph: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  bottom: { paddingHorizontal: space.lg },
  title: {
    // Wave 1a: the welcome wordmark-pair hero → type.display (report Table 3.1
    // — "display replaces welcome 42-56").
    ...type.display,
    // Wave 4b: display caps at 1.2× (56×1.2 = 67.2 > 60) — lineHeight 68
    // keeps descenders unclipped; the scroll layout absorbs the +8px.
    lineHeight: 68,
    textAlign: 'center',
    marginBottom: space.xl,
  },
  cta: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TAP_TARGET },
})
