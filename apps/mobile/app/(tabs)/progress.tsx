import { formatWeightKg, kgToLb, type PeriodReport, type WeightUnit } from '@nutai/analytics'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BarChart, LineChart } from '../../src/components/Charts'
import { analyticsStartDate, loadReport } from '../../src/data/analytics'
import { localDate, db } from '../../src/data/repo'
import { readWeightUnit } from '../../src/data/weight-units'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

const SECTIONS = ['Overview', 'Body', 'Nutrition', 'Strength', 'Training'] as const
type Section = (typeof SECTIONS)[number]
const WINDOWS = [
  { key: '7D', days: 7 }, { key: '30D', days: 30 }, { key: '3M', days: 92 },
  { key: '6M', days: 183 }, { key: '1Y', days: 365 }, { key: 'ALL', days: null },
] as const
type WindowKey = (typeof WINDOWS)[number]['key']

function offsetDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}
function percent(value: number | null): string { return value === null ? '—' : `${Math.round(value * 100)}%` }
function metric(value: number | null, suffix = ''): string {
  return value === null || !Number.isFinite(value) ? '—' : `${Math.round(value)}${suffix}`
}
function displayWeight(kg: number, unit: WeightUnit): number { return unit === 'kg' ? kg : kgToLb(kg) }

export default function Progress() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [section, setSection] = useState<Section>('Overview')
  const [window, setWindow] = useState<WindowKey>('30D')
  const [report, setReport] = useState<PeriodReport | null>(null)
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const handle = await db()
      const end = localDate(Date.now())
      const selected = WINDOWS.find((item) => item.key === window)!
      const start = selected.days === null ? await analyticsStartDate(handle, end) : offsetDate(end, -(selected.days - 1))
      const [nextReport, nextUnit] = await Promise.all([loadReport(handle, 'month', start, end), readWeightUnit(handle)])
      setReport(nextReport); setWeightUnit(nextUnit)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }, [window])
  useFocusEffect(useCallback(() => { void refresh() }, [refresh]))

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 150, gap: space.md }} showsVerticalScrollIndicator={false}>
      <Text accessibilityRole="header" style={[type.title, { color: theme.text }]}>Progress</Text>
      <Text style={[type.caption, { color: theme.textMuted }]}>Stored data only. Incomplete nutrition days stay out of averages.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {SECTIONS.map((item) => <Chip key={item} label={item} selected={section === item} onPress={() => setSection(item)} />)}
      </ScrollView>
      <View style={styles.windows}>
        {WINDOWS.map((item) => <Chip key={item.key} label={item.key} selected={window === item.key} onPress={() => setWindow(item.key)} compact />)}
      </View>
      {loading ? <ActivityIndicator accessibilityLabel="Loading progress" /> : null}
      {error ? <Text accessibilityRole="alert" style={[type.body, { color: theme.safety }]}>{error}</Text> : null}
      {!loading && report ? <>
        {section === 'Overview' ? <Overview report={report} unit={weightUnit} /> : null}
        {section === 'Body' ? <Body report={report} unit={weightUnit} /> : null}
        {section === 'Nutrition' ? <Nutrition report={report} /> : null}
        {section === 'Strength' ? <Strength report={report} /> : null}
        {section === 'Training' ? <Training report={report} /> : null}
      </> : null}
      <View style={styles.reportRow}>
        <Chip label="Weekly report" selected={false} onPress={() => router.push('/weekly-report' as never)} />
        <Chip label="Monthly report" selected={false} onPress={() => router.push('/monthly-report' as never)} />
      </View>
    </ScrollView>
  )
}

function Overview({ report, unit }: { report: PeriodReport; unit: WeightUnit }) {
  return <>
    <View style={styles.metricGrid}>
      <MetricCard label="Weight trend" value={report.body.change_kg === null ? '—' : signedWeight(report.body.change_kg, unit)} detail={`${report.body.points.length} weigh-ins`} />
      <MetricCard label="Average calories" value={metric(report.nutrition.avg_kcal)} detail={`${report.nutrition.days_included} valid days`} />
      <MetricCard label="Average protein" value={metric(report.nutrition.avg_protein_g, ' g')} detail="valid days only" />
      <MetricCard label="Workouts" value={String(report.training.session_count)} detail={`${report.training.sessions_per_week.toFixed(1)} per week`} />
      <MetricCard label="Recent PRs" value={String(report.prs.length)} detail="completed working sets" />
      <MetricCard label="Complete nutrition days" value={String(report.nutrition.complete_days)} detail={`${report.data_quality.incomplete_nutrition_days} incomplete`} />
    </View>
    <Warnings report={report} />
  </>
}

function Body({ report, unit }: { report: PeriodReport; unit: WeightUnit }) {
  const colors = useTheme()
  const raw = report.body.points.map((point) => ({ x: Date.parse(`${point.date}T12:00:00Z`), y: displayWeight(point.weight_kg, unit), id: point.date, label: point.date }))
  const trend = report.body.trend.map((point) => ({ x: Date.parse(`${point.date}T12:00:00Z`), y: displayWeight(point.trend_kg, unit), id: point.date, label: point.date }))
  return <Card title="Bodyweight">
    <LineChart series={[{ key: 'raw', label: 'Weigh-ins', color: colors.textFaint, points: raw }, { key: 'trend', label: '7-day trend', color: colors.protein, points: trend }]} emptyText="No weigh-ins in this period. Log one to begin a trend." formatValue={(value) => `${value.toFixed(1)} ${unit}`} />
    <View style={styles.metricGrid}>
      <SmallMetric label="Average" value={formatWeightKg(report.body.average_weight_kg, unit)} />
      <SmallMetric label="Change" value={report.body.change_kg === null ? 'Need 2 points' : signedWeight(report.body.change_kg, unit)} />
    </View>
    {report.body.points.length === 1 ? <Muted>One point is shown, but change and a meaningful trend require more data.</Muted> : null}
    {report.body.points.length > 1 && report.body.points.length < 3 ? <Muted>The available trend is sparse.</Muted> : null}
  </Card>
}

function Nutrition({ report }: { report: PeriodReport }) {
  const colors = useTheme(); const valid = new Set(report.nutrition.included_dates)
  const calories = report.nutrition_days.filter((day) => valid.has(day.date)).map((day) => ({ x: Date.parse(`${day.date}T12:00:00Z`), y: day.kcal, id: day.date, label: day.date }))
  const protein = report.nutrition_days.filter((day) => valid.has(day.date)).map((day) => ({ x: Date.parse(`${day.date}T12:00:00Z`), y: day.protein_g, id: day.date, label: day.date }))
  return <>
    <Card title="Calories"><LineChart series={[{ key: 'calories', label: 'Valid days', color: colors.carbs, points: calories }]} formatValue={(value) => `${Math.round(value)} kcal`} /><Muted>Average {metric(report.nutrition.avg_kcal, ' kcal')} · {report.nutrition.days_included} valid days</Muted></Card>
    <Card title="Protein"><LineChart series={[{ key: 'protein', label: 'Valid days', color: colors.protein, points: protein }]} formatValue={(value) => `${value.toFixed(1)} g`} /><Muted>Average {metric(report.nutrition.avg_protein_g, ' g')}</Muted></Card>
    <Card title="Targets and completeness">
      <DataRow label="Calories within ±10%" value={`${percent(report.nutrition.adherence.calorie_within_target_rate)} (${report.nutrition.adherence.calorie_within_target_days}/${report.nutrition.adherence.calorie_comparable_days})`} />
      <DataRow label="Protein target met" value={`${percent(report.nutrition.adherence.protein_target_rate)} (${report.nutrition.adherence.protein_target_days}/${report.nutrition.adherence.protein_comparable_days})`} />
      <DataRow label="Complete days" value={String(report.nutrition.complete_days)} /><DataRow label="Intentional fasts" value={String(report.nutrition.fasting_days)} />
      <DataRow label="Excluded partial/unknown" value={String(report.data_quality.incomplete_nutrition_days)} />
      {report.nutrition.excluded_days.slice(0, 8).map((day) => <Muted key={day.date}>{day.date}: {day.reason.replaceAll('_', ' ')}</Muted>)}
    </Card>
  </>
}

function Strength({ report }: { report: PeriodReport }) {
  const theme = useTheme()
  const [exerciseId, setExerciseId] = useState<number | null>(report.training.exercise_trends[0]?.exercise_id ?? null)
  const exercise = report.training.exercise_trends.find((item) => item.exercise_id === exerciseId) ?? report.training.exercise_trends[0]
  if (!exercise) return <Card title="Strength"><Muted>No completed working sets in this period. Warmups are excluded.</Muted></Card>
  return <>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{report.training.exercise_trends.map((item) => <Chip key={item.exercise_id} label={item.exercise_name} selected={item.exercise_id === exercise.exercise_id} onPress={() => setExerciseId(item.exercise_id)} />)}</ScrollView>
    <Card title={exercise.exercise_name}>
      <LineChart series={[
        { key: 'e1rm', label: 'Estimated 1RM', color: theme.protein, points: exercise.points.map((point) => ({ x: point.session_id, y: point.e1rm_kg, id: point.session_id, label: point.date })) },
        { key: 'heavy', label: 'Heaviest working set', color: theme.fat, points: exercise.points.map((point) => ({ x: point.session_id, y: point.heaviest_working_set_kg, id: point.session_id, label: point.date })), dashed: true },
      ]} formatValue={(value) => `${value.toFixed(1)} kg`} />
      <DataRow label="Sessions" value={String(exercise.frequency)} /><DataRow label="Rep PRs" value={String(exercise.rep_prs.length)} />
      {exercise.rep_prs.slice(-5).reverse().map((record) => <Muted key={`${record.reps}:${record.date}`}>{record.reps} reps × {record.load_kg.toFixed(1)} kg · {record.date}</Muted>)}
    </Card>
  </>
}

function Training({ report }: { report: PeriodReport }) {
  const theme = useTheme(); const muscles = Object.entries(report.training.muscle_group_sets).sort((a, b) => b[1] - a[1])
  return <>
    <View style={styles.metricGrid}>
      <MetricCard label="Sessions" value={String(report.training.session_count)} detail={`${report.training.sessions_per_week.toFixed(1)} / week`} />
      <MetricCard label="Working sets" value={String(report.training.working_sets)} detail={`${report.training.working_sets_per_week.toFixed(1)} / week`} />
      <MetricCard label="Session duration" value={report.training.average_session_duration_min === null ? '—' : `${Math.round(report.training.average_session_duration_min)} min`} detail="average completed session" />
      <MetricCard label="Exercises" value={String(report.training.exercise_trends.length)} detail="with working sets" />
    </View>
    <Card title="Muscle-group sets">
      <BarChart points={muscles.map(([name, sets], index) => ({ x: index, y: sets, id: name, label: name }))} color={theme.fat} emptyText="No working-set muscle data in this period." formatValue={(value) => `${value.toFixed(1)} sets`} />
      {muscles.slice(0, 8).map(([name, sets]) => <DataRow key={name} label={name} value={sets.toFixed(1)} />)}
      <Muted>Warmups and cooldowns are excluded. Volume-load is context, not an overall progress score.</Muted>
    </Card>
  </>
}

function Warnings({ report }: { report: PeriodReport }) { return report.data_quality.warnings.length > 0 ? <Card title="Data quality">{report.data_quality.warnings.map((warning) => <Muted key={warning}>{warning}</Muted>)}</Card> : null }
function Card({ title, children }: { title: string; children: React.ReactNode }) { const t = useTheme(); return <View style={[styles.card, { backgroundColor: t.bgElevated, borderColor: t.border }]}><Text style={[type.heading, { color: t.text }]}>{title}</Text>{children}</View> }
function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) { const t = useTheme(); return <View style={[styles.metricCard, { backgroundColor: t.bgSunken }]}><Text style={[type.caption, { color: t.textMuted }]}>{label}</Text><Text style={[styles.metricValue, { color: t.text }]}>{value}</Text><Text style={[type.micro, { color: t.textFaint }]}>{detail}</Text></View> }
function SmallMetric({ label, value }: { label: string; value: string }) { const t = useTheme(); return <View style={{ minWidth: '44%' }}><Text style={[type.caption, { color: t.textMuted }]}>{label}</Text><Text style={[type.bodyStrong, { color: t.text }]}>{value}</Text></View> }
function DataRow({ label, value }: { label: string; value: string }) { const t = useTheme(); return <View style={styles.dataRow}><Text style={[type.body, { color: t.text, flex: 1 }]}>{label}</Text><Text style={[type.bodyStrong, { color: t.text }]}>{value}</Text></View> }
function Muted({ children }: { children: React.ReactNode }) { const t = useTheme(); return <Text style={[type.caption, { color: t.textMuted, lineHeight: 19 }]}>{children}</Text> }
function Chip({ label, selected, onPress, compact = false }: { label: string; selected: boolean; onPress: () => void; compact?: boolean }) { const t = useTheme(); return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, compact && styles.compactChip, { backgroundColor: selected ? t.text : t.bgSunken }]}><Text style={[type.label, { color: selected ? t.bg : t.text }]}>{label}</Text></Pressable> }

function signedWeight(kg: number, unit: WeightUnit): string {
  const value = displayWeight(kg, unit)
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} ${unit}`
}

const styles = StyleSheet.create({
  tabs: { gap: space.sm, paddingRight: space.lg }, windows: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill }, compactChip: { minHeight: 40, paddingHorizontal: 11 },
  card: { borderWidth: 1, borderRadius: radius.xl, padding: space.lg, gap: space.md }, metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  metricCard: { width: '48%', minHeight: 120, borderRadius: radius.lg, padding: space.md, gap: space.xs }, metricValue: { fontSize: 23, fontWeight: '700' },
  dataRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md }, reportRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
})
