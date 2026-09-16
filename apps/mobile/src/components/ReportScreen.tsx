import { formatWeightKg, kgToLb, type PeriodReport, type ReportPeriod, type WeightUnit } from '@nutai/analytics'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { db, localDate } from '../data/repo'
import { loadReport } from '../data/analytics'
import { readWeightUnit } from '../data/weight-units'
import { useTheme } from '../theme/ThemeProvider'
import { radius, space, type } from '../theme/tokens'
import { BarChart, LineChart } from './Charts'
import { Button, Card, Label, Row, Screen } from './Screen'

function utcDate(date: string): Date { return new Date(`${date}T12:00:00Z`) }
function iso(date: Date): string { return date.toISOString().slice(0, 10) }
function addDays(date: string, days: number): string { return iso(new Date(utcDate(date).getTime() + days * 86_400_000)) }

export function weekBounds(today: string): { start: string; end: string } {
  const day = utcDate(today).getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return { start: addDays(today, mondayOffset), end: today }
}

export function monthBounds(today: string, offset: number): { start: string; end: string; label: string } {
  const current = utcDate(today)
  const first = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset, 1, 12))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12))
  return {
    start: iso(first), end: offset === 0 && iso(last) > today ? today : iso(last),
    label: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

export function ReportScreen({ period }: { period: ReportPeriod }) {
  const theme = useTheme()
  const [monthOffset, setMonthOffset] = useState(0)
  const [report, setReport] = useState<PeriodReport | null>(null)
  const [unit, setUnit] = useState<WeightUnit>('kg')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const today = localDate(Date.now())
  const bounds = useMemo(() => period === 'week'
    ? { ...weekBounds(today), label: 'This week' }
    : monthBounds(today, monthOffset), [monthOffset, period, today])

  const refresh = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const handle = await db()
      const [next, nextUnit] = await Promise.all([
        loadReport(handle, period, bounds.start, bounds.end), readWeightUnit(handle),
      ])
      setReport(next); setUnit(nextUnit)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }, [bounds.end, bounds.start, period])
  useFocusEffect(useCallback(() => { void refresh() }, [refresh]))

  return <Screen title={period === 'week' ? 'Weekly report' : 'Monthly report'} back>
    <View style={styles.periodHeader}>
      {period === 'month' ? <Button label="Previous month" onPress={() => setMonthOffset((value) => value - 1)} /> : null}
      <View style={{ flex: 1, minWidth: 120 }}><Text style={[type.bodyStrong, { color: theme.text, textAlign: 'center' }]}>{bounds.label}</Text><Text style={[type.micro, { color: theme.textMuted, textAlign: 'center' }]}>{bounds.start} — {bounds.end}</Text></View>
      {period === 'month' ? <Button label="Next month" disabled={monthOffset >= 0} onPress={() => setMonthOffset((value) => Math.min(0, value + 1))} /> : null}
    </View>
    {busy ? <ActivityIndicator accessibilityLabel="Loading report" /> : null}
    {error ? <Text accessibilityRole="alert" style={[type.body, { color: theme.safety }]}>{error}</Text> : null}
    {!busy && report ? <ReportBody report={report} unit={unit} /> : null}
  </Screen>
}

function ReportBody({ report, unit }: { report: PeriodReport; unit: WeightUnit }) {
  const theme = useTheme()
  const validDates = new Set(report.nutrition.included_dates)
  const caloriePoints = report.nutrition_days.filter((day) => validDates.has(day.date)).map((day) => ({ x: Date.parse(`${day.date}T12:00:00Z`), y: day.kcal, id: day.date, label: day.date }))
  const weightPoints = report.body.trend.map((point) => ({ x: Date.parse(`${point.date}T12:00:00Z`), y: unit === 'kg' ? point.trend_kg : kgToLb(point.trend_kg), id: point.date, label: point.date }))
  const muscleGroups = Object.entries(report.training.muscle_group_sets).sort((a, b) => b[1] - a[1])
  const improvements = report.training.exercise_trends.map((exercise) => {
    const points = exercise.points.map((point) => point.e1rm_kg).filter((value): value is number => value !== null)
    if (points.length < 2 || points[0] === 0) return null
    return { name: exercise.exercise_name, change: (points.at(-1)! - points[0]) / points[0] * 100 }
  }).filter((item): item is { name: string; change: number } => item !== null && Number.isFinite(item.change))

  return <>
    <Card><SectionTitle>Body</SectionTitle>
      <LineChart series={[{ key: 'weight', label: 'Weight trend', color: theme.protein, points: weightPoints }]} emptyText="No weigh-ins in this period." formatValue={(value) => `${value.toFixed(1)} ${unit}`} />
      <DataRow label="Average weight" value={formatWeightKg(report.body.average_weight_kg, unit)} />
      <DataRow label="Start trend" value={formatWeightKg(report.body.start_weight_kg, unit)} /><DataRow label="End trend" value={formatWeightKg(report.body.end_weight_kg, unit)} />
      <DataRow label="Change" value={report.body.change_kg === null ? 'Not enough data' : signedWeight(report.body.change_kg, unit)} />
    </Card>
    <Card><SectionTitle>Nutrition</SectionTitle>
      <LineChart series={[{ key: 'calories', label: 'Valid-day calories', color: theme.carbs, points: caloriePoints }]} emptyText="No complete nutrition days with usable data." formatValue={(value) => `${Math.round(value)} kcal`} />
      <DataRow label="Average calories" value={number(report.nutrition.avg_kcal, ' kcal')} /><DataRow label="Average protein" value={number(report.nutrition.avg_protein_g, ' g')} />
      <DataRow label="Average carbs" value={number(report.nutrition.avg_carbs_g, ' g')} /><DataRow label="Average fat" value={number(report.nutrition.avg_fat_g, ' g')} />
      <DataRow label="Complete days" value={String(report.nutrition.complete_days)} />
      <DataRow label="Calorie target adherence" value={rate(report.nutrition.adherence.calorie_within_target_rate, report.nutrition.adherence.calorie_comparable_days)} />
      <DataRow label="Protein target adherence" value={rate(report.nutrition.adherence.protein_target_rate, report.nutrition.adherence.protein_comparable_days)} />
      {report.data_quality.incomplete_nutrition_days > 0 ? <Label muted>{report.data_quality.incomplete_nutrition_days} partial or unknown day(s) excluded from averages.</Label> : null}
    </Card>
    <Card><SectionTitle>Training</SectionTitle>
      <Row><Stat label="Sessions" value={String(report.training.session_count)} /><Stat label="Frequency" value={`${report.training.sessions_per_week.toFixed(1)}/wk`} /><Stat label="Working sets" value={String(report.training.working_sets)} /></Row>
      <BarChart points={muscleGroups.map(([name, value], index) => ({ x: index, y: value, id: name, label: name }))} color={theme.fat} emptyText="No completed working sets." formatValue={(value) => `${value.toFixed(1)} sets`} />
      {muscleGroups.slice(0, 6).map(([name, value]) => <DataRow key={name} label={name} value={`${value.toFixed(1)} sets`} />)}
      {report.training.average_session_duration_min !== null ? <DataRow label="Average session" value={`${Math.round(report.training.average_session_duration_min)} min`} /> : null}
    </Card>
    <Card><SectionTitle>Strength</SectionTitle>
      <DataRow label="PRs" value={String(report.prs.length)} />
      {report.prs.slice(-8).reverse().map((pr) => <Label key={`${pr.exercise_name}:${pr.kind}:${pr.date}`} muted>{pr.exercise_name}: {pr.value.toFixed(1)} {pr.unit} · {pr.date}</Label>)}
      {improvements.slice(0, 6).map((item) => <Label key={item.name} muted>{item.name} e1RM {item.change >= 0 ? 'increased' : 'decreased'} {Math.abs(item.change).toFixed(1)}% during this period. Average protein was {number(report.nutrition.avg_protein_g, ' g/day')}.</Label>)}
      {report.prs.length === 0 && improvements.length === 0 ? <Label muted>No strength changes with enough comparable data.</Label> : null}
    </Card>
    <Card><SectionTitle>Adaptive</SectionTitle>
      {report.adaptive.estimated_expenditure_kcal === null ? <Label muted>Not enough valid intake and weight data for an expenditure estimate.</Label> : <>
        <DataRow label="Estimated expenditure" value={`${report.adaptive.estimated_expenditure_kcal} kcal/day`} />
        {report.adaptive.evidence ? <Label muted>{report.adaptive.evidence}</Label> : null}
        {report.adaptive.recommended_calorie_adjustment !== null ? <>
          <DataRow label="Potential target adjustment" value={`${report.adaptive.recommended_calorie_adjustment > 0 ? '+' : ''}${report.adaptive.recommended_calorie_adjustment} kcal`} />
          <Label muted>This is a deterministic suggestion, not an automatic change. Explicit acceptance is required.</Label>
          <Button label="Review and accept in check-in" onPress={() => router.push('/checkin' as never)} />
        </> : <Label muted>No target adjustment is suggested.</Label>}
      </>}
    </Card>
    <Card><SectionTitle>Data quality</SectionTitle>
      <DataRow label="Weigh-ins" value={String(report.data_quality.weigh_ins)} /><DataRow label="Complete nutrition days" value={String(report.data_quality.complete_nutrition_days)} />
      <DataRow label="Incomplete nutrition days" value={String(report.data_quality.incomplete_nutrition_days)} /><DataRow label="Days with pending analysis" value={String(report.data_quality.pending_nutrition_days)} />
      {report.data_quality.warnings.map((warning) => <Label key={warning} muted>{warning}</Label>)}
    </Card>
  </>
}

function SectionTitle({ children }: { children: React.ReactNode }) { const t = useTheme(); return <Text accessibilityRole="header" style={[type.heading, { color: t.text }]}>{children}</Text> }
function DataRow({ label, value }: { label: string; value: string }) { const t = useTheme(); return <View style={styles.dataRow}><Text style={[type.body, { color: t.text, flex: 1 }]}>{label}</Text><Text style={[type.bodyStrong, { color: t.text, textAlign: 'right' }]}>{value}</Text></View> }
function Stat({ label, value }: { label: string; value: string }) { const t = useTheme(); return <View style={[styles.stat, { backgroundColor: t.bgSunken }]}><Text style={[type.caption, { color: t.textMuted }]}>{label}</Text><Text style={[type.heading, { color: t.text }]}>{value}</Text></View> }
function number(value: number | null, suffix: string): string { return value === null || !Number.isFinite(value) ? '—' : `${Math.round(value)}${suffix}` }
function rate(value: number | null, denominator: number): string { return value === null ? `— (0 days)` : `${Math.round(value * 100)}% (${denominator} days)` }
function signedWeight(kg: number, unit: WeightUnit): string { const value = unit === 'kg' ? kg : kgToLb(kg); return `${value > 0 ? '+' : ''}${value.toFixed(1)} ${unit}` }

const styles = StyleSheet.create({
  periodHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  dataRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  stat: { minWidth: 95, padding: space.md, borderRadius: radius.md, gap: space.xs },
})
