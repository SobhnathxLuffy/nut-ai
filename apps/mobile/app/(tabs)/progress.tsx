import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Line as SvgLine, Path, Rect, Text as SvgText } from 'react-native-svg'
import { bmi, computeTrend, trendSlopeLbPerWeek, type TrendPoint, type WeightPoint } from '@nutai/goals'
import {
  deriveRecords,
  performanceHistory,
  listExercises,
  type PersonalRecord,
  type Performance,
  type Exercise,
} from '@nutai/training'
import { currentGoal, db, setting, weightHistory, type CurrentGoal } from '../../src/data/repo'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

const LB_PER_KG = 2.20462

const WINDOWS = [
  { key: '90D', days: 90 },
  { key: '6M', days: 182 },
  { key: '1Y', days: 365 },
  { key: 'ALL', days: Number.POSITIVE_INFINITY },
] as const

const CHANGE_WINDOWS = [3, 7, 14, 30, 90] as const

export default function Progress() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [points, setPoints] = useState<WeightPoint[]>([])
  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [heightCm, setHeightCm] = useState<number | null>(null)
  const [goalKg, setGoalKg] = useState<number | null>(null)
  const [streak, setStreak] = useState(0)
  const [window, setWindow] = useState<(typeof WINDOWS)[number]['key']>('90D')
  const [records, setRecords] = useState<PersonalRecord[]>([])
  const [exerciseHistory, setExerciseHistory] = useState<Performance[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [selectedExerciseId, setSelectedExerciseId] = useState<number | null>(null)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        const h = await db()
        const [pts, g, target, profile, days, perfs, exList] = await Promise.all([
          weightHistory(),
          currentGoal(),
          setting('goal.desiredWeightKg', ''),
          h.get<{ height_cm: number }>('SELECT height_cm FROM user_profile WHERE id = 1'),
          h.all<{ local_date: string }>('SELECT DISTINCT local_date FROM meals ORDER BY local_date DESC'),
          performanceHistory(h),
          listExercises(h),
        ])
        if (!alive) return
        setPoints(pts)
        setGoal(g)
        setGoalKg(target ? Number(target) : null)
        setHeightCm(profile?.height_cm ?? null)
        setStreak(countStreak(days.map((d) => d.local_date)))
        setExerciseHistory(perfs)
        setExercises(exList)
        const recs = deriveRecords(perfs)
        setRecords(recs)
        if (perfs.length > 0) {
          setSelectedExerciseId((prev) => prev ?? perfs[perfs.length - 1]?.exercise_id ?? null)
        }
      })()
      return () => {
        alive = false
      }
    }, []),
  )

  const trend = useMemo(() => computeTrend(points), [points])
  const raw = trend.filter((p) => p.rawKg != null)
  const slope = useMemo(() => trendSlopeLbPerWeek(trend), [trend])

  const currentKg = points[points.length - 1]?.weightKg ?? null
  const startKg = points[0]?.weightKg ?? null

  const pctOfGoal =
    startKg != null && currentKg != null && goalKg != null && Math.abs(goalKg - startKg) > 0.01
      ? Math.max(0, Math.min(1, (currentKg - startKg) / (goalKg - startKg)))
      : 0

  const visible = useMemo(() => {
    const w = WINDOWS.find((x) => x.key === window)
    if (!w || !Number.isFinite(w.days)) return trend
    const last = trend[trend.length - 1]
    if (!last) return trend
    return trend.filter((p) => p.day > last.day - w.days)
  }, [trend, window])

  const bodyBmi = currentKg != null && heightCm != null ? bmi(currentKg, heightCm) : null

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[type.title, { color: theme.text }]}>Progress</Text>

      {/* Streak credits logging INTENT, so our own failures never break it. */}
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: theme.bgSunken }]}>
          <Icon name="flame" size={30} color={theme.text} />
          <Text style={[styles.tileNum, { color: theme.text }]}>{streak}</Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>Day streak</Text>
        </View>
        <View style={[styles.tile, { backgroundColor: theme.bgSunken }]}>
          <Icon name="scale" size={30} color={theme.text} />
          <Text style={[styles.tileNum, { color: theme.text }]}>{raw.length}</Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>Weigh-ins</Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <View style={styles.spread}>
          <Text style={[type.caption, { color: theme.textMuted }]}>Current weight</Text>
          <Pressable onPress={() => router.push('/log-weight' as never)} hitSlop={space.sm}>
            <Text style={[type.label, { color: theme.protein }]}>Log weight</Text>
          </Pressable>
        </View>
        <Text style={[styles.big, { color: theme.text }]}>
          {currentKg != null ? `${(currentKg * LB_PER_KG).toFixed(1)} lbs` : '—'}
        </Text>

        <View style={[styles.bar, { backgroundColor: theme.ringTrack }]}>
          <View style={{ width: `${pctOfGoal * 100}%`, height: 6, borderRadius: 3, backgroundColor: theme.text }} />
        </View>
        <View style={styles.spread}>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Start: {startKg != null ? `${(startKg * LB_PER_KG).toFixed(1)} lbs` : '—'}
          </Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Goal: {goalKg != null ? `${(goalKg * LB_PER_KG).toFixed(1)} lbs` : '—'}
          </Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <View style={styles.spread}>
          <Text style={[type.heading, { color: theme.text }]}>Weight progress</Text>
          <View style={[styles.badge, { backgroundColor: theme.bgElevated }]}>
            <Text style={[type.caption, { color: theme.text }]}>{Math.round(pctOfGoal * 100)}% of goal</Text>
          </View>
        </View>

        {raw.length === 0 ? (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md }]}>
            No weigh-ins yet. It takes about five before a slope means anything.
          </Text>
        ) : (
          <WeightChart trend={visible} />
        )}

        <View style={[styles.segment, { backgroundColor: theme.bgElevated }]}>
          {WINDOWS.map((w) => (
            <Pressable
              key={w.key}
              onPress={() => setWindow(w.key)}
              style={[styles.segItem, window === w.key && { backgroundColor: theme.bg }]}
            >
              <Text style={[type.label, { color: window === w.key ? theme.text : theme.textMuted }]}>
                {w.key}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: theme.textFaint }]} />
            <Text style={[type.caption, { color: theme.textMuted }]}>Each weigh-in</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.line, { backgroundColor: theme.text }]} />
            <Text style={[type.caption, { color: theme.textMuted }]}>Trend</Text>
          </View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.heading, { color: theme.text }]}>Weight changes</Text>
        {CHANGE_WINDOWS.map((d) => (
          <ChangeRow key={d} label={`${d} day`} lbs={changeOver(trend, d)} />
        ))}
        <ChangeRow label="All time" lbs={changeOver(trend, Number.POSITIVE_INFINITY)} />
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 18 }]}>
          Measured on the trend line, not raw weigh-ins — a 3 lb overnight swing is water, and
          reporting it as a change would be reporting noise as progress.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.heading, { color: theme.text }]}>Rate of change</Text>
        <Text style={[styles.big, { color: theme.text }]}>
          {slope == null ? '—' : `${slope > 0 ? '+' : ''}${slope.toFixed(2)} lb/wk`}
        </Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {slope == null ? 'Not enough weigh-ins yet.' : `From ${raw.length} weigh-ins.`}
        </Text>
      </View>

      {bodyBmi != null ? (
        <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Your BMI</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
            <Text style={[styles.big, { color: theme.text }]}>{bodyBmi.toFixed(1)}</Text>
            <Text style={[type.caption, { color: theme.textMuted }]}>{bmiBand(bodyBmi)}</Text>
          </View>
          <BmiScale value={bodyBmi} />
          <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 18 }]}>
            BMI cannot tell muscle from fat and says nothing about an individual's health. It is
            here because it is a common reference point, not because it is a verdict.
          </Text>
        </View>
      ) : null}

      {/* TRN-004: Strength & Personal Records */}
      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <View style={styles.spread}>
          <Text style={[type.heading, { color: theme.text }]}>Strength & Personal Records</Text>
        </View>
        <Text style={[type.caption, { color: theme.textMuted }]}>
          Derived deterministically from completed workout sets using the Epley estimated 1RM formula.
        </Text>

        {records.length > 0 ? (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <Text style={[type.label, { color: theme.text, marginTop: space.xs }]}>Recent Records</Text>
            {records.slice(-5).reverse().map((r) => {
              const ex = exercises.find((e) => e.id === r.exercise_id)
              return (
                <View key={r.id} style={styles.spread}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyStrong, { color: theme.text }]}>
                      {ex?.name ?? `Exercise #${r.exercise_id}`}
                    </Text>
                    <Text style={[type.caption, { color: theme.textMuted }]}>
                      {r.kind} · {r.local_date}
                    </Text>
                  </View>
                  <Text style={[type.label, { color: theme.protein }]}>
                    {Math.round(r.value * 10) / 10} {r.unit}
                  </Text>
                </View>
              )
            })}
          </View>
        ) : (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm }]}>
            No personal records yet. Finish a workout in Train to log sets and track strength progression.
          </Text>
        )}

        {/* Core exercise progress graph */}
        {exerciseHistory.length > 0 ? (
          <View style={{ marginTop: space.md, gap: space.sm }}>
            <Text style={[type.label, { color: theme.text }]}>Exercise Progression</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.md, paddingHorizontal: space.md }}>
              <View style={{ flexDirection: 'row', gap: space.xs }}>
                {Array.from(new Set(exerciseHistory.map((p) => p.exercise_id))).map((exId) => {
                  const ex = exercises.find((e) => e.id === exId)
                  const isSelected = exId === selectedExerciseId
                  return (
                    <Pressable
                      key={exId}
                      onPress={() => setSelectedExerciseId(exId)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: isSelected ? theme.text : theme.bgElevated,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          type.caption,
                          { color: isSelected ? theme.bg : theme.text, fontWeight: '600' },
                        ]}
                      >
                        {ex?.name ?? `Exercise #${exId}`}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </ScrollView>

            {selectedExerciseId ? (
              <ExerciseProgressGraph
                exerciseId={selectedExerciseId}
                history={exerciseHistory}
                exerciseName={exercises.find((e) => e.id === selectedExerciseId)?.name ?? 'Exercise'}
              />
            ) : null}
          </View>
        ) : null}
      </View>

      {goal ? (
        <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Daily target</Text>
          <Text style={[styles.big, { color: theme.text }]}>{Math.round(goal.targetKcal)} kcal</Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            {goal.adaptive ? 'Adapting from your own trend and intake.' : 'Fixed — you set this by hand.'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
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
  if (!set.has(iso(cursor))) cursor -= day
  while (set.has(iso(cursor))) {
    n++
    cursor -= day
  }
  return n
}

function iso(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Change over N days, measured on the TREND rather than raw entries. */
function changeOver(trend: TrendPoint[], days: number): number | null {
  const last = trend[trend.length - 1]
  const first = trend[0]
  if (!last || !first) return null
  const target = Number.isFinite(days) ? last.day - days : first.day
  const start = [...trend].reverse().find((p) => p.day <= target) ?? first
  return (last.trendKg - start.trendKg) * LB_PER_KG
}

function ChangeRow({ label, lbs }: { label: string; lbs: number | null }) {
  const theme = useTheme()
  const none = lbs == null || Math.abs(lbs) < 0.05
  const up = (lbs ?? 0) > 0
  return (
    <View style={styles.changeRow}>
      <Text style={[type.body, { color: theme.textMuted, width: 78 }]}>{label}</Text>
      <Text style={[type.bodyStrong, { color: theme.text, flex: 1 }]}>
        {lbs == null ? '—' : `${lbs > 0 ? '+' : ''}${lbs.toFixed(1)} lbs`}
      </Text>
      <Text style={[type.caption, { color: none ? theme.textMuted : theme.protein }]}>
        {none ? 'No change' : up ? 'Increase' : 'Decrease'}
      </Text>
    </View>
  )
}

function WeightChart({ trend }: { trend: TrendPoint[] }) {
  const theme = useTheme()
  const W = 300
  const H = 170

  if (trend.length === 0) return null

  const values = trend.flatMap((p) => [p.trendKg, ...(p.rawKg != null ? [p.rawKg] : [])])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min < 0.5 ? 1 : max - min
  const pad = span * 0.2

  const x = (i: number) => (trend.length <= 1 ? W / 2 : (i / (trend.length - 1)) * (W - 50) + 40)
  const y = (kg: number) => H - 24 - ((kg - min + pad) / (span + pad * 2)) * (H - 48)

  const gridVals = [min + span, min + span / 2, min]
  let d = ''
  trend.forEach((p, i) => {
    d += `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.trendKg)} `
  })

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: space.md }}>
      {gridVals.map((v, i) => (
        <SvgLine key={i} x1={40} y1={y(v)} x2={W - 10} y2={y(v)} stroke={theme.border} strokeWidth="1" />
      ))}
      {gridVals.map((v, i) => (
        <SvgText key={`t${i}`} x={2} y={y(v) + 4} fontSize="10" fill={theme.textFaint}>
          {(v * LB_PER_KG).toFixed(0)}
        </SvgText>
      ))}
      {trend.map((p, i) =>
        p.rawKg != null ? <Circle key={i} cx={x(i)} cy={y(p.rawKg)} r="3" fill={theme.textFaint} /> : null,
      )}
      <Path d={d} stroke={theme.text} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

function bmiBand(v: number): string {
  if (v < 18.5) return 'Underweight'
  if (v < 25) return 'Healthy'
  if (v < 30) return 'Overweight'
  return 'Obese'
}

function BmiScale({ value }: { value: number }) {
  const theme = useTheme()
  const W = 300
  const pos = Math.max(0, Math.min(1, (value - 15) / 20))
  const segs = [
    { w: (18.5 - 15) / 20, c: '#6E9BFF' },
    { w: (25 - 18.5) / 20, c: '#2E9E6B' },
    { w: (30 - 25) / 20, c: '#F2A93B' },
    { w: (35 - 30) / 20, c: '#D5453B' },
  ]
  let cursor = 0
  return (
    <Svg width="100%" height={26} viewBox={`0 0 ${W} 26`} style={{ marginTop: space.md }}>
      {segs.map((s, i) => {
        const x = cursor * W
        cursor += s.w
        return <Rect key={i} x={x} y={9} width={s.w * W - 3} height={8} rx={4} fill={s.c} />
      })}
      <Rect x={pos * W - 1.5} y={3} width={3} height={20} rx={1.5} fill={theme.text} />
    </Svg>
  )
}

function ExerciseProgressGraph({
  exerciseId,
  history,
  exerciseName,
}: {
  exerciseId: number
  history: Performance[]
  exerciseName: string
}) {
  const theme = useTheme()
  const sessions = useMemo(() => {
    const forEx = history.filter(
      (p) => p.exercise_id === exerciseId && p.load_kg != null && (p.reps ?? 0) > 0,
    )
    const byWorkout = new Map<number, { date: string; best1rm: number; bestLoad: number }>()
    for (const s of forEx) {
      const e1rm = s.reps === 1 ? s.load_kg! : s.load_kg! * (1 + s.reps! / 30)
      const existing = byWorkout.get(s.workout_id)
      if (!existing) {
        byWorkout.set(s.workout_id, { date: s.local_date, best1rm: e1rm, bestLoad: s.load_kg! })
      } else {
        existing.best1rm = Math.max(existing.best1rm, e1rm)
        existing.bestLoad = Math.max(existing.bestLoad, s.load_kg!)
      }
    }
    return Array.from(byWorkout.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [exerciseId, history])

  if (sessions.length === 0) {
    return (
      <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm }]}>
        No weighted repetitions recorded for {exerciseName} yet.
      </Text>
    )
  }

  const W = 320
  const H = 140
  const padL = 36
  const padR = 16
  const padT = 16
  const padB = 24

  const maxVal = Math.max(...sessions.map((s) => s.best1rm))
  const minVal = Math.min(...sessions.map((s) => s.best1rm))
  const range = maxVal === minVal ? Math.max(1, maxVal * 0.2) : maxVal - minVal
  const yMin = Math.max(0, minVal - range * 0.1)
  const yMax = maxVal + range * 0.1

  const x = (i: number) =>
    sessions.length === 1
      ? (W - padL - padR) / 2 + padL
      : padL + (i / (sessions.length - 1)) * (W - padL - padR)
  const y = (val: number) => H - padB - ((val - yMin) / (yMax - yMin)) * (H - padT - padB)

  const pathD = sessions
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s.best1rm).toFixed(1)}`)
    .join(' ')

  const latest = sessions[sessions.length - 1]!

  return (
    <View style={{ marginTop: space.sm }}>
      <View style={styles.spread}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>
          Latest: {latest.best1rm.toFixed(1)} kg e1RM
        </Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>
          Top load: {latest.bestLoad} kg ({latest.date})
        </Text>
      </View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: space.xs }}>
        <SvgLine x1={padL} y1={padT} x2={padL} y2={H - padB} stroke={theme.border} strokeWidth="1" />
        <SvgLine x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={theme.border} strokeWidth="1" />
        <SvgText x={2} y={padT + 8} fontSize="9" fill={theme.textFaint}>
          {Math.round(yMax)}kg
        </SvgText>
        <SvgText x={2} y={H - padB} fontSize="9" fill={theme.textFaint}>
          {Math.round(yMin)}kg
        </SvgText>
        {sessions.length > 1 && (
          <Path d={pathD} stroke={theme.protein} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {sessions.map((s, i) => (
          <Circle key={i} cx={x(i)} cy={y(s.best1rm)} r="4" fill={theme.text} />
        ))}
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  tile: { flex: 1, padding: space.lg, borderRadius: radius.xl, alignItems: 'center' },
  tileNum: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, marginTop: space.xs },
  card: { marginTop: space.md, padding: space.lg, borderRadius: radius.xl },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  big: { fontSize: 30, fontWeight: '800', letterSpacing: -1, marginTop: space.xs },
  bar: { height: 6, borderRadius: 3, marginTop: space.md, marginBottom: space.sm, overflow: 'hidden' },
  badge: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill },
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, marginTop: space.md },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.pill },
  legend: { flexDirection: 'row', gap: space.lg, marginTop: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  line: { width: 18, height: 3, borderRadius: 2 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  chip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill },
})
