import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { Icon, type IconName } from '../../src/components/Icon'
import { DayTimeline } from '../../src/components/DayTimeline'
import {
  currentGoal,
  dayTotals,
  db,
  localDate,
  runAdaptive,
  type AdaptiveOutcome,
  type CurrentGoal,
  type DayTotals,
} from '../../src/data/repo'
import { subscribeFoodMutations } from '../../src/data/food-mutations'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Home.
 *
 * Three rules this screen will not break, all of them about not moralising:
 *
 *   A day with nothing logged reads "no entries logged" in a neutral colour.
 *   Never "missed", never red — red is reserved for safety warnings.
 *
 *   Over target is STATED, not scolded. The ring draws a second overflow arc
 *   rather than clamping at 100% and lying about it.
 *
 *   Pending scans contribute ZERO calories and show as a count. A number that
 *   silently grows later is worse than one that is visibly incomplete.
 */
export default function Home() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [totals, setTotals] = useState<DayTotals | null>(null)
  const [adaptive, setAdaptive] = useState<AdaptiveOutcome | null>(null)
  const [offset, setOffset] = useState(0)
  const [streak, setStreak] = useState(0)

  const selected = useMemo(() => Date.now() + offset * 86_400_000, [offset])

  const loadData = useCallback(async () => {
    // The adaptive loop runs BEFORE reading the goal, so a target it just
    // changed is the one rendered. Its own gates decide whether it may act.
    const outcome = await runAdaptive(Date.now())
    const h = await db()
    const [g, t, days] = await Promise.all([
      currentGoal(),
      dayTotals(localDate(selected)),
      h.all<{ local_date: string }>(
        'SELECT DISTINCT local_date FROM meals WHERE deleted_at IS NULL ORDER BY local_date DESC',
      ),
    ])
    setAdaptive(outcome)
    setGoal(g)
    setTotals(t)
    setStreak(countStreak(days.map((d) => d.local_date)))
  }, [selected])

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        if (!alive) return
        await loadData()
      })()
      return () => {
        alive = false
      }
    }, [loadData]),
  )

  useEffect(() => subscribeFoodMutations(() => { void loadData() }), [loadData])

  if (!goal || !totals) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[type.body, { color: theme.textMuted }]}>Loading your day…</Text>
      </View>
    )
  }

  const remaining = goal.targetKcal - totals.kcal
  const over = remaining < 0
  const pct = goal.targetKcal > 0 ? totals.kcal / goal.targetKcal : 0
  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.wordmark, { color: theme.text }]}>Nut AI</Text>
        <View style={[styles.streakPill, { backgroundColor: theme.bgSunken }]}>
          <Icon name="flame" size={16} color={theme.text} />
          <Text style={[type.bodyStrong, { color: theme.text }]}>{streak}</Text>
        </View>
      </View>

      {/* Day strip */}
      <DayStrip selected={offset} onSelect={setOffset} />

      {/* Calories + macros — single view, no fake carousel */}
      <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
        <View style={[styles.heroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.hero, { color: theme.text }]}>
              {Math.abs(Math.round(remaining))}
            </Text>
            <Text style={[type.body, { color: theme.textMuted }]}>
              {over ? 'Calories over' : 'Calories left'}
            </Text>
          </View>
          <Ring pct={pct} over={over} size={128} stroke={12}>
            <Icon name="flame" size={26} color={theme.text} />
          </Ring>
        </View>

        <View style={styles.macroRow}>
          <MacroCard label="Protein" icon="protein" eaten={totals.protein_g} target={goal.protein_g} color={theme.protein} />
          <MacroCard label="Carbs" icon="carbs" eaten={totals.carbs_g} target={goal.carbs_g} color={theme.carbs} />
          <MacroCard label="Fat" icon="fat" eaten={totals.fat_g} target={goal.fat_g} color={theme.fat} />
        </View>
      </View>

      {/* Adaptive target status — always legible, never a silent change. */}
      <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
        <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: 'transparent' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="target" size={18} color={theme.text} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Your target</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
            {adaptive?.surfaced
              ? `Updated to ${Math.round(adaptive.newKcal ?? 0)} kcal. ${adaptive.explanation}`
              : goal.adaptive
                ? (adaptive?.reason ?? 'Adapting from your own trend and intake.')
                : 'Fixed — you set this by hand, so we leave it alone.'}
          </Text>
          <Pressable
            onPress={() => router.push('/log-weight' as never)}
            hitSlop={space.sm}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.md }}
          >
            <Icon name="scale" size={16} color={theme.protein} />
            <Text style={[type.label, { color: theme.protein }]}>Log today's weight</Text>
          </Pressable>
        </View>
      </View>

      {/* Daily Timeline */}
      <View style={{ paddingHorizontal: space.lg, marginTop: space.xl, gap: space.md }}>
        <Text style={[type.title, { color: theme.text, fontSize: 24 }]}>Daily timeline</Text>
        <DayTimeline selectedDate={localDate(selected)} hideDateControls hideTotals />
      </View>
    </ScrollView>
  )
}

function DayStrip({ selected, onSelect }: { selected: number; onSelect: (o: number) => void }) {
  const theme = useTheme()
  const now = new Date()
  // Monday-first week containing today.
  const dow = (now.getDay() + 6) % 7
  const days = Array.from({ length: 7 }, (_, i) => i - dow)

  return (
    <View style={styles.strip}>
      {days.map((off) => {
        const d = new Date(Date.now() + off * 86_400_000)
        const isSel = off === selected
        const future = off > 0
        return (
          <Pressable
            key={off}
            disabled={future}
            onPress={() => onSelect(off)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSel, disabled: future }}
            style={[styles.dayCol, isSel && { backgroundColor: theme.bgElevated }]}
          >
            <Text style={[type.caption, { color: future ? theme.textFaint : theme.textMuted }]}>
              {DAY_LABELS[d.getDay()]}
            </Text>
            <View
              style={[
                styles.dayCircle,
                {
                  borderColor: isSel ? theme.text : theme.border,
                  borderStyle: off < 0 ? 'dashed' : 'solid',
                  opacity: future ? 0.4 : 1,
                },
              ]}
            >
              <Text style={[type.bodyStrong, { color: future ? theme.textFaint : theme.text }]}>
                {d.getDate()}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Consecutive logged days ending today, or yesterday if today is still open. */
function countStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const set = new Set(dates)
  const day = 86_400_000
  let n = 0
  let cursor = Date.now()
  // A day still in progress must not break a streak that is otherwise intact.
  if (!set.has(isoLocal(cursor))) cursor -= day
  while (set.has(isoLocal(cursor))) {
    n++
    cursor -= day
  }
  return n
}

/** Local date ISO string from a unix timestamp. */
function isoLocal(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Ring({
  pct, over, size, stroke, children,
}: {
  pct: number
  over: boolean
  size: number
  stroke: number
  children?: React.ReactNode
}) {
  const theme = useTheme()
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  const primary = Math.min(1, pct)
  const overflow = over ? Math.min(1, pct - 1) : 0
  const innerR = r - stroke - 3
  const innerC = 2 * Math.PI * innerR

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.ringTrack} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={theme.ring} strokeWidth={stroke} fill="none"
          strokeDasharray={`${c * primary} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {overflow > 0 ? (
          <Circle
            cx={size / 2} cy={size / 2} r={innerR}
            stroke={theme.uncertain} strokeWidth={stroke * 0.6} fill="none"
            strokeDasharray={`${innerC * overflow} ${innerC}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  )
}

function MacroCard({
  label, icon, eaten, target, color,
}: {
  label: string
  icon: IconName
  eaten: number
  target: number
  color: string
}) {
  const theme = useTheme()
  const left = Math.max(0, target - eaten)
  const pct = target > 0 ? Math.min(1, eaten / target) : 0
  const size = 74
  const r = size / 2 - 5
  const c = 2 * Math.PI * r

  return (
    <View style={[styles.macroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
      <Text style={[styles.macroNum, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {Math.round(left)}g
      </Text>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label} left</Text>

      <View style={{ alignItems: 'center', marginTop: space.md }}>
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.ringTrack} strokeWidth={5} fill="none" />
            <Circle
              cx={size / 2} cy={size / 2} r={r}
              stroke={color} strokeWidth={5} fill="none"
              strokeDasharray={`${c * pct} ${c}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </Svg>
          <Icon name={icon} size={22} color={color} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  wordmark: { fontSize: 30, fontWeight: '800', letterSpacing: -1.2 },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  strip: { flexDirection: 'row', paddingHorizontal: space.md, marginTop: space.lg },
  dayCol: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.lg, gap: space.sm },
  dayCircle: {
    width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.xl,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hero: { fontSize: 46, fontWeight: '800', letterSpacing: -1.8 },
  macroRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  macroCard: {
    flex: 1,
    padding: space.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  macroNum: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6 },
  card: { padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
})
