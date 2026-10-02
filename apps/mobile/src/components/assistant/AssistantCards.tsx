import { StyleSheet, Text, View, Pressable } from 'react-native'
import { router } from 'expo-router'
import { useTheme } from '../../../src/theme/ThemeProvider'
import { radius, space, type } from '../../../src/theme/tokens'
import { expandProposalIngredients } from '../../data/proposal-ingredients'
import { Badge } from '../Badge'

/**
 * §8.7 tool-card status badge (Wave 3): every proposal card carries ONE Badge
 * stating its lifecycle — proposed (outline), applied/saved (affirm), failed
 * (safety) — instead of each card growing its own status typography.
 */
export function ProposalStatusBadge({ status, savedLabel = 'Saved' }: { status?: string; savedLabel?: string }) {
  if (status === 'SAVED') return <Badge label={savedLabel} variant="affirm" size="sm" />
  if (status === 'FAILED') return <Badge label="Failed" variant="safety" size="sm" />
  if (status === 'CANCELLED') return <Badge label="Cancelled" size="sm" />
  if (status === 'PENDING') return <Badge label="Applying…" size="sm" />
  if (status === 'PROPOSED') return <Badge label="Proposed" variant="outline" size="sm" />
  return null
}

export function LastWorkoutCard({ data }: { data: any }) {
  const t = useTheme()
  if (!data) {
    return (
      <View style={[s.card, { backgroundColor: t.bgElevated, borderColor: t.border }]}>
        <Text style={[s.title, { color: t.text }]}>No records found</Text>
        <Text style={[s.body, { color: t.textMuted }]}>We couldn't find a past workout for that exercise.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Log an exercise" onPress={() => router.push('/log-exercise')} style={[s.btn, { backgroundColor: t.text }]}>
          <Text style={[s.btnText, { color: t.bgElevated }]}>Log an exercise</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={[s.card, { backgroundColor: t.bgElevated, borderColor: t.border }]}>
      <Text style={[s.title, { color: t.text }]}>{data.name} (Last logged)</Text>
      <Text style={[s.body, { color: t.textMuted }]}>Date: {data.local_date}</Text>
      <Text style={[s.body, { color: t.textMuted }]}>Calories burned: {Math.round(data.kcal)} kcal</Text>
    </View>
  )
}

export function NutritionSummaryCard({ data }: { data: any }) {
  const t = useTheme()

  return (
    <View style={[s.card, { backgroundColor: t.bgElevated, borderColor: t.border }]}>
      <Text style={[s.title, { color: t.text }]}>Nutrition Summary ({data.timeframe})</Text>
      {data.excludedDays?.length > 0 && (
        <Text style={[s.body, { color: t.safety }]}>
          Note: {data.excludedDays.length} day(s) were excluded (e.g. fast/sick days).
        </Text>
      )}
      <View style={s.row}>
        <Text style={[s.body, { color: t.text }]}>Calories: {Math.round(data.totals.kcal)} kcal</Text>
      </View>
      <View style={s.row}>
        <Text style={[s.body, { color: t.text }]}>Protein: {Math.round(data.totals.protein)}g</Text>
        <Text style={[s.body, { color: t.text }]}>Carbs: {Math.round(data.totals.carbs)}g</Text>
        <Text style={[s.body, { color: t.text }]}>Fat: {Math.round(data.totals.fat)}g</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  card: { padding: space.md, borderRadius: radius.md, marginVertical: space.sm, borderWidth: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  title: { ...type.heading, fontWeight: 'bold' },
  body: { ...type.body, marginBottom: space.xs },
  row: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  btn: { padding: space.sm, borderRadius: radius.sm, alignItems: 'center', marginTop: space.sm },
  btnText: { fontWeight: 'bold' }
})

/**
 * P2-30 (f): ONE proposal card. MealProposalCard and
 * WorkoutRoutineProposalCard were the same component wearing two names —
 * identical SAVED/FAILED/CANCELLED/PENDING rows, identical Confirm/Cancel
 * pair — and their failure copy had already drifted ("tap Review & Save"
 * vs "tap Confirm"). Callers now pass a title, the bullet lines, and the
 * confirm-button label.
 */
export function ProposalCard({
  title,
  lines,
  status,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  lines: string[]
  status?: string
  confirmLabel: string
  onConfirm?: () => void
  onCancel?: () => void
}) {
  const t = useTheme()
  return (
    <View style={[s.card, { backgroundColor: t.bgElevated, borderColor: t.border }]}>
      <View style={s.cardHeader}>
        <Text style={[s.title, { color: t.text, flex: 1 }]}>{title}</Text>
        <ProposalStatusBadge status={status} />
      </View>
      {lines.map((line, i) => (
        <Text key={i} style={[s.body, { color: t.text }]}>• {line}</Text>
      ))}
      {status === 'FAILED' && <Text style={[s.body, { color: t.safety }]}>Save failed — tap {confirmLabel} to try again.</Text>}

      {(status === 'PROPOSED' || status === 'FAILED') && (
        <View style={s.row}>
          <Pressable accessibilityRole="button" accessibilityLabel={confirmLabel} onPress={onConfirm} style={[s.btn, { backgroundColor: t.text, flex: 1 }]}>
            <Text style={[s.btnText, { color: t.bgElevated }]}>{confirmLabel}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Cancel this ${confirmLabel.toLowerCase()} proposal`} onPress={onCancel} style={[s.btn, { backgroundColor: t.bgElevated, borderWidth: 1, borderColor: t.text, flex: 1 }]}>
            <Text style={[s.btnText, { color: t.text }]}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

export function MealProposalCard({ data, status, onConfirm, onCancel }: { data: any, status?: string, onConfirm?: () => void, onCancel?: () => void }) {
  // Unit-count aware: "2 rotis" renders as "2 × 40 g", not one 80 g blob.
  return (
    <ProposalCard
      title={`Meal Proposal: ${data.name}`}
      lines={expandProposalIngredients(data.ingredients).map((ing) => ing.display)}
      status={status}
      confirmLabel="Review & Save"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

export function WorkoutRoutineProposalCard({ data, status, onConfirm, onCancel }: { data: any, status?: string, onConfirm?: () => void, onCancel?: () => void }) {
  return (
    <ProposalCard
      title={`Routine Proposal: ${data.name}`}
      lines={data.exercises.map((ex: { name: string; sets: string | number; reps: string | number }) => `${ex.name}: ${ex.sets} sets x ${ex.reps}`)}
      status={status}
      confirmLabel="Confirm"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
