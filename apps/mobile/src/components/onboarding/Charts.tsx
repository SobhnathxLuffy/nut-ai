import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop, Line as SvgLine } from 'react-native-svg'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme/ThemeProvider'
import { radius, space, type } from '../../theme/tokens'

/**
 * The onboarding charts, hand-rolled in react-native-svg.
 *
 * No chart library: these are fixed shapes with no axes, legends or
 * interaction, and a library would import an opinionated axis/legend system to
 * fight. A cubic path plus a gradient fill is about forty lines.
 *
 * Wave 3 (UI/UX report Ch. 8.1): trend and potential are now ONE chart —
 * ProjectionChart fuses the with/without-plan comparison (the old trend
 * screen) and the early-consistency milestones (the old potential screen) into
 * a single moment. The two dead chart components were deleted with their
 * screens.
 */

/** Smooth cubic through points, used by both charts. */
function smoothPath(pts: ReadonlyArray<{ x: number; y: number }>): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]!
    const p1 = pts[i + 1]!
    const cx = (p0.x + p1.x) / 2
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`
  }
  return d
}

const W = 300
const H = 170

/**
 * "Where this goes" — the fused projection (report Ch. 8.1: trend + potential
 * as ONE chart moment).
 *
 * What survives from the two old charts, and why:
 *   - the with-plan vs without-plan comparison (old 'trend'): the shape it
 *     draws is a real, documented phenomenon — unstructured dieting tends to
 *     produce early change followed by regression to baseline.
 *   - the early milestones (old 'potential'): 3 days, a week, a month — the
 *     window where consistency actually decides the curve.
 * The y-axis is labelled as a trend, never a promise.
 */
export function ProjectionChart({ gaining }: { gaining: boolean }) {
  const theme = useTheme()

  // SVG y grows downward, so a GAINING plan line must travel to a smaller y.
  // The "without a plan" line always ends back near the start: the documented
  // pattern is regression to baseline, in either direction.
  const without = gaining
    ? smoothPath([
        { x: 12, y: 138 }, { x: 80, y: 76 }, { x: 140, y: 68 }, { x: 220, y: 120 }, { x: 290, y: 144 },
      ])
    : smoothPath([
        { x: 12, y: 30 }, { x: 80, y: 92 }, { x: 140, y: 100 }, { x: 220, y: 45 }, { x: 290, y: 22 },
      ])

  // The plan line passes through explicit milestone points so the 3-day /
  // 7-day / 30-day dots sit exactly ON the curve — a dot floating off the line
  // reads as a data point the chart does not actually have.
  const planPts = gaining
    ? [
        { x: 12, y: 138 }, { x: 18, y: 135 }, { x: 32, y: 128 }, { x: 62, y: 110 },
        { x: 170, y: 63 }, { x: 250, y: 33 }, { x: 290, y: 30 },
      ]
    : [
        { x: 12, y: 30 }, { x: 18, y: 33 }, { x: 32, y: 40 }, { x: 62, y: 58 },
        { x: 170, y: 105 }, { x: 250, y: 135 }, { x: 290, y: 138 },
      ]
  const withPlan = smoothPath(planPts)
  const milestone = (x: number) => planPts.find((p) => p.x === x)!

  // The first-30-days emphasis band: the window the old 'potential' chart was
  // about, drawn exactly where it lives on the timeline.
  const BAND_X = 12
  const BAND_W = milestone(62).x - BAND_X

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
      <Text style={[type.heading, { color: theme.text }]}>Your projection</Text>

      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: space.md }}>
        <Defs>
          <LinearGradient id="projFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.text} stopOpacity="0.10" />
            <Stop offset="1" stopColor={theme.text} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        <Rect x={BAND_X} y={16} width={BAND_W} height={136} fill={theme.uncertain} fillOpacity={0.08} rx={6} />

        <SvgLine x1="12" y1="30" x2="290" y2="30" stroke={theme.border} strokeDasharray="3 5" strokeWidth="1" />
        <SvgLine x1="12" y1="95" x2="290" y2="95" stroke={theme.border} strokeDasharray="3 5" strokeWidth="1" />

        <Path d={`${withPlan} L 290 150 L 12 150 Z`} fill="url(#projFill)" />
        {/* The "without a plan" series rides the UNCERTAIN family — violet is
            the documented "please check, not a scold" hue (tokens.ts header);
            red is reserved for safety only, and the raw coral hex failed AA
            now that this chart is a live onboarding surface (T4-c). */}
        <Path d={without} stroke={theme.uncertain} strokeWidth="3" fill="none" strokeLinecap="round" />
        <Path d={withPlan} stroke={theme.text} strokeWidth="3.5" fill="none" strokeLinecap="round" />

        <Circle cx={milestone(18).x} cy={milestone(18).y} r="5" fill={theme.bg} stroke={theme.text} strokeWidth="2.5" />
        <Circle cx={milestone(32).x} cy={milestone(32).y} r="5" fill={theme.bg} stroke={theme.text} strokeWidth="2.5" />
        <Circle cx={milestone(62).x} cy={milestone(62).y} r="12" fill={theme.uncertain} />
        <Circle cx={milestone(62).x} cy={milestone(62).y} r="12" fill="none" stroke={theme.bg} strokeWidth="2" />

        <Circle cx="12" cy={gaining ? 138 : 30} r="6" fill={theme.bg} stroke={theme.text} strokeWidth="3" />
        <Circle cx="290" cy={gaining ? 30 : 138} r="6" fill={theme.bg} stroke={theme.text} strokeWidth="3" />
      </Svg>

      <View style={styles.legendRow}>
        <View style={[styles.pill, { backgroundColor: theme.text }]}>
          <Text style={[type.caption, { color: theme.bg }]}>Nut AI</Text>
        </View>
        <Text style={[type.caption, { color: theme.uncertainText }]}>Without a plan</Text>
        <View style={[styles.bandChip, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text }]}>First 30 days</Text>
        </View>
      </View>

      <View style={styles.axisRow}>
        <Text style={[type.caption, { color: theme.textMuted }]}>Now</Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>Month 6</Text>
      </View>

      <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.md }]}>
        The dots mark 3 days, a week and a month — the window where consistency decides the curve.
        Unstructured dieting tends to drift back to baseline; tracking holds the line. This is the
        documented pattern, not a forecast of your weight.
      </Text>
    </View>
  )
}

/** The plan screen's estimated-progress curve, with the target callout. */
export function ProgressChart({
  targetLabel,
  dateLabel,
  gaining,
}: {
  targetLabel: string
  dateLabel: string
  gaining: boolean
}) {
  const theme = useTheme()
  const pts = gaining
    ? [{ x: 12, y: 130 }, { x: 110, y: 118 }, { x: 200, y: 48 }, { x: 270, y: 30 }]
    : [{ x: 12, y: 30 }, { x: 110, y: 42 }, { x: 200, y: 112 }, { x: 270, y: 130 }]
  const d = smoothPath(pts)
  const end = pts[3]!

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
      <Text style={[type.heading, { color: theme.text }]}>Estimated progress</Text>

      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: space.md }}>
        <Defs>
          <LinearGradient id="progFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.text} stopOpacity="0.12" />
            <Stop offset="1" stopColor={theme.text} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        <SvgLine x1="12" y1="45" x2="285" y2="45" stroke={theme.border} strokeDasharray="3 5" strokeWidth="1" />
        <SvgLine x1="12" y1="100" x2="285" y2="100" stroke={theme.border} strokeDasharray="3 5" strokeWidth="1" />

        <Path d={`${d} L 270 145 L 12 145 Z`} fill="url(#progFill)" />
        <Path d={d} stroke={theme.text} strokeWidth="3.5" fill="none" strokeLinecap="round" />

        <Circle cx={pts[0]!.x} cy={pts[0]!.y} r="6" fill={theme.bg} stroke={theme.text} strokeWidth="3" />
        <Circle cx={end.x} cy={end.y} r="7" fill={theme.bg} stroke={theme.text} strokeWidth="3" />
      </Svg>

      <View style={[styles.callout, { backgroundColor: theme.bgElevated, borderColor: theme.text }]}>
        <Text style={[type.caption, { color: theme.text, fontWeight: '700', textAlign: 'center' }]}>
          Target{'\n'}{targetLabel}
        </Text>
      </View>

      <View style={styles.axisRow}>
        <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>Now</Text>
        <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>{dateLabel}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { padding: space.lg, borderRadius: radius.xl },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs, flexWrap: 'wrap' },
  pill: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill },
  bandChip: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill },
  callout: {
    alignSelf: 'flex-end',
    marginTop: -space.xxl,
    marginRight: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 2,
  },
})
