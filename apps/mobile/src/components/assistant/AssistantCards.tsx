import { StyleSheet, Text, View, Pressable } from 'react-native'
import { router } from 'expo-router'
import { useTheme } from '../../../src/theme/ThemeProvider'
import { radius, space, type } from '../../../src/theme/tokens'

export function LastWorkoutCard({ data }: { data: any }) {
  const t = useTheme()
  if (!data) {
    return (
      <View style={[s.card, { backgroundColor: t.bgElevated }]}>
        <Text style={[s.title, { color: t.text }]}>No records found</Text>
        <Text style={[s.body, { color: t.textMuted }]}>We couldn't find a past workout for that exercise.</Text>
        <Pressable onPress={() => router.push('/log-exercise')} style={[s.btn, { backgroundColor: t.text }]}>
          <Text style={[s.btnText, { color: t.bgElevated }]}>Log an exercise</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={[s.card, { backgroundColor: t.bgElevated }]}>
      <Text style={[s.title, { color: t.text }]}>{data.name} (Last logged)</Text>
      <Text style={[s.body, { color: t.textMuted }]}>Date: {data.local_date}</Text>
      <Text style={[s.body, { color: t.textMuted }]}>Calories burned: {Math.round(data.kcal)} kcal</Text>
    </View>
  )
}

export function NutritionSummaryCard({ data }: { data: any }) {
  const t = useTheme()

  return (
    <View style={[s.card, { backgroundColor: t.bgElevated }]}>
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
  card: { padding: space.md, borderRadius: radius.md, marginVertical: space.sm, borderWidth: 1, borderColor: '#ccc' },
  title: { ...type.heading, fontWeight: 'bold', marginBottom: space.xs },
  body: { ...type.body, marginBottom: space.xs },
  row: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  btn: { padding: space.sm, borderRadius: radius.sm, alignItems: 'center', marginTop: space.sm },
  btnText: { fontWeight: 'bold' }
})

export function MealProposalCard({ data, onConfirm, onCancel }: { data: any, onConfirm?: () => void, onCancel?: () => void }) {
  const t = useTheme()
  return (
    <View style={[s.card, { backgroundColor: t.bgElevated }]}>
      <Text style={[s.title, { color: t.text }]}>Meal Proposal: {data.name}</Text>
      {data.ingredients.map((ing: any, i: number) => (
        <Text key={i} style={[s.body, { color: t.text }]}>• {ing.name} ({ing.grams}g)</Text>
      ))}
      <View style={s.row}>
        <Pressable onPress={onConfirm} style={[s.btn, { backgroundColor: t.text, flex: 1 }]}>
          <Text style={[s.btnText, { color: t.bgElevated }]}>Confirm</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={[s.btn, { backgroundColor: t.bgElevated, borderWidth: 1, borderColor: t.text, flex: 1 }]}>
          <Text style={[s.btnText, { color: t.text }]}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

export function WorkoutRoutineProposalCard({ data, onConfirm, onCancel }: { data: any, onConfirm?: () => void, onCancel?: () => void }) {
  const t = useTheme()
  return (
    <View style={[s.card, { backgroundColor: t.bgElevated }]}>
      <Text style={[s.title, { color: t.text }]}>Routine Proposal: {data.name}</Text>
      {data.exercises.map((ex: any, i: number) => (
        <Text key={i} style={[s.body, { color: t.text }]}>• {ex.name}: {ex.sets} sets x {ex.reps}</Text>
      ))}
      <View style={s.row}>
        <Pressable onPress={onConfirm} style={[s.btn, { backgroundColor: t.text, flex: 1 }]}>
          <Text style={[s.btnText, { color: t.bgElevated }]}>Confirm</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={[s.btn, { backgroundColor: t.bgElevated, borderWidth: 1, borderColor: t.text, flex: 1 }]}>
          <Text style={[s.btnText, { color: t.text }]}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}
