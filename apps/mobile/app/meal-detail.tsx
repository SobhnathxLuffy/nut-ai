import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { undoOperation } from '@nutai/db-adapter'
import { db, deleteMeal } from '../src/data/repo'
import { getLoggedMeal, updateLoggedMeal, type LoggedMealDetail } from '../src/data/logged-meals'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const

interface EditableItem {
  id: number
  name: string
  gramsText: string
  kcalPer100g: number | null
}

interface EditableMeal {
  id: number
  date: string
  slot: string
  items: EditableItem[]
}

export default function MealDetail() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const mealId = id && /^\d+$/.test(id) ? Number(id) : null
  const [meal, setMeal] = useState<EditableMeal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isSavingRef = useRef(false)
  const [undoUuid, setUndoUuid] = useState<string | null>(null)

  useEffect(() => {
    if (!mealId) return
    let alive = true
    void (async () => {
      const value = await getLoggedMeal(await db(), mealId)
      if (alive && value) {
        setMeal({
          id: value.id,
          date: value.date,
          slot: value.slot,
          items: value.items.map((item) => ({
            id: item.id,
            name: item.name,
            gramsText: String(item.grams),
            kcalPer100g: item.kcalPer100g,
          })),
        })
      }
    })().catch((e) => setError(String(e)))
    return () => {
      alive = false
    }
  }, [mealId])

  const changeItem = (index: number, key: 'name' | 'gramsText', value: string) => {
    setMeal((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
          }
        : current,
    )
  }

  async function save() {
    if (!meal || busy || isSavingRef.current) return
    isSavingRef.current = true
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meal.date) || Number.isNaN(Date.parse(meal.date))) {
      isSavingRef.current = false
      setError('Choose a valid date in YYYY-MM-DD format')
      return
    }
    for (const item of meal.items) {
      if (!item.name.trim()) {
        isSavingRef.current = false
        setError('Each food item needs a name')
        return
      }
      const g = Number(item.gramsText)
      if (!Number.isFinite(g) || g <= 0) {
        isSavingRef.current = false
        setError(`Enter a valid gram weight greater than zero for "${item.name.trim() || 'food'}"`)
        return
      }
    }

    setBusy(true)
    setError(null)
    try {
      const detail: LoggedMealDetail = {
        id: meal.id,
        date: meal.date,
        slot: meal.slot,
        items: meal.items.map((item) => ({
          id: item.id,
          name: item.name.trim(),
          grams: Number(item.gramsText),
          kcalPer100g: item.kcalPer100g,
        })),
      }
      const uuid = await updateLoggedMeal(await db(), detail, Date.now())
      setUndoUuid(uuid)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      isSavingRef.current = false
      setBusy(false)
    }
  }

  if (!meal) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: space.lg, paddingTop: insets.top + space.lg }}>
        <Text style={[type.body, { color: error ? theme.safety : theme.textMuted }]}>{error ?? 'Loading meal…'}</Text>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + 80,
          gap: space.md,
        }}
      >
        <View style={styles.header}>
          <Text style={[type.title, { color: theme.text }]}>Logged meal</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Done editing meal" onPress={() => router.back()} hitSlop={space.md}>
            <Text style={[type.label, { color: theme.textMuted }]}>Done</Text>
          </Pressable>
        </View>

        <Field label="Date (YYYY-MM-DD)" value={meal.date} onChange={(value) => setMeal({ ...meal, date: value })} />
        <View style={styles.row}>
          {SLOTS.map((slot) => {
            const selected = meal.slot === slot
            return (
              <Pressable
                key={slot}
                accessibilityRole="button"
                accessibilityLabel={`Select ${slot} meal slot`}
                onPress={() => setMeal({ ...meal, slot })}
                style={[
                  styles.slot,
                  {
                    borderColor: theme.border,
                    backgroundColor: selected ? theme.text : theme.bgElevated,
                  },
                ]}
              >
                <Text style={[type.caption, { color: selected ? theme.bg : theme.text }]}>{slot}</Text>
              </Pressable>
            )
          })}
        </View>

        {meal.items.map((item, index) => {
          const parsedGrams = parseFloat(item.gramsText)
          const validGrams = Number.isFinite(parsedGrams) && parsedGrams > 0 ? parsedGrams : null
          const preview =
            item.kcalPer100g === null
              ? 'Calories not reported'
              : validGrams !== null
              ? `${Math.round((item.kcalPer100g * validGrams) / 100)} kcal`
              : '— kcal'

          return (
            <View key={item.id} style={[styles.card, { borderColor: theme.border }]}>
              <Field label="Food" value={item.name} onChange={(value) => changeItem(index, 'name', value)} />
              <Field
                label="Grams"
                value={item.gramsText}
                onChange={(value) => changeItem(index, 'gramsText', value)}
                numeric
              />
              <Text style={[type.caption, { color: theme.textMuted }]}>{preview}</Text>
            </View>
          )
        })}

        {error ? <Text style={[type.caption, { color: theme.safety }]}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          disabled={busy}
          onPress={() => void save()}
          style={[styles.primary, { backgroundColor: busy ? theme.border : theme.text }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>{busy ? 'Saving…' : 'Save changes'}</Text>
        </Pressable>

        {undoUuid ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo these changes"
            onPress={() =>
              void (async () => {
                await undoOperation(await db(), undoUuid)
                setUndoUuid(null)
                const restored = await getLoggedMeal(await db(), meal.id)
                if (restored) {
                  setMeal({
                    id: restored.id,
                    date: restored.date,
                    slot: restored.slot,
                    items: restored.items.map((item) => ({
                      id: item.id,
                      name: item.name,
                      gramsText: String(item.grams),
                      kcalPer100g: item.kcalPer100g,
                    })),
                  })
                }
              })()
            }
            style={[styles.secondary, { borderColor: theme.border }]}
          >
            <Text style={[type.label, { color: theme.text }]}>Undo these changes</Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete meal"
          onPress={() =>
            Alert.alert('Delete this meal?', 'You can restore it with Undo.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () =>
                  void (async () => {
                    const op = await deleteMeal(meal.id)
                    if (op) {
                      router.back()
                    }
                  })(),
              },
            ])
          }
          style={[styles.secondary, { borderColor: theme.safety }]}
        >
          <Text style={[type.label, { color: theme.safety }]}>Delete meal</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  numeric?: boolean
}) {
  const theme = useTheme()
  return (
    <View style={{ flex: 1 }}>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  slot: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  card: { gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md },
  input: {
    minHeight: MIN_TAP_TARGET,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: 17,
  },
  primary: { minHeight: 54, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  secondary: {
    minHeight: MIN_TAP_TARGET,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
