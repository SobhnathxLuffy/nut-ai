import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  BackHandler,
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
import {
  createCustomFood,
  customFoodSelection,
  deleteCustomFood,
  getCustomFood,
  listCustomFoods,
  updateCustomFood,
  type CustomFood,
  type CustomFoodInput,
  type FoodServingUnit,
} from '../src/data/custom-foods'
import { db, localDate } from '../src/data/repo'
import { encodeFoodReview } from '../src/data/food-review'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

interface FormState {
  name: string
  brand: string
  barcode: string
  servingAmount: string
  servingUnit: FoodServingUnit
  calories: string
  protein: string
  carbs: string
  fat: string
  fiber: string
}

const EMPTY: FormState = {
  name: '',
  brand: '',
  barcode: '',
  servingAmount: '100',
  servingUnit: 'g',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
}

function requiredNumber(value: string, label: string): number {
  if (!value.trim()) throw new Error(`${label} is required`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a finite non-negative number`)
  return parsed
}

function inputFromForm(form: FormState): CustomFoodInput {
  return {
    name: form.name,
    brand: form.brand,
    barcode: form.barcode,
    servingAmount: requiredNumber(form.servingAmount, 'Serving amount'),
    servingUnit: form.servingUnit,
    calories: requiredNumber(form.calories, 'Calories'),
    protein_g: requiredNumber(form.protein, 'Protein'),
    carbs_g: requiredNumber(form.carbs, 'Carbs'),
    fat_g: requiredNumber(form.fat, 'Fat'),
    fiber_g: form.fiber.trim() ? requiredNumber(form.fiber, 'Fiber') : null,
  }
}

/** Create or edit a custom food through the shared domain write path. */
export default function CustomFoodScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id?: string; date?: string }>()
  const editId = params.id && /^\d+$/.test(params.id) ? Number(params.id) : null
  const [form, setForm] = useState<FormState>(EMPTY)
  const [loading, setLoading] = useState(editId !== null)
  const [saving, setSaving] = useState(false)
  const isSavingRef = useRef(false)
  const [existing, setExisting] = useState<CustomFood[]>([])
  const [filter, setFilter] = useState('')
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY)

  useEffect(() => {
    let alive = true
    void (async () => {
      const handle = await db()
      const foods = await listCustomFoods(handle)
      if (alive) setExisting(foods)
      if (editId === null) return
      const food = await getCustomFood(handle, editId)
      if (!alive) return
      if (!food) {
        Alert.alert('Food not found', 'This custom food may have been removed.', [
          { text: 'Close', onPress: () => router.back() },
        ])
        return
      }
      setForm({
        name: food.name,
        brand: food.brand ?? '',
        barcode: food.barcode ?? '',
        servingAmount: String(food.servingAmount),
        servingUnit: food.servingUnit,
        calories: String(food.calories),
        protein: String(food.protein_g),
        carbs: String(food.carbs_g),
        fat: String(food.fat_g),
        fiber: food.fiber_g == null ? '' : String(food.fiber_g),
      })
      setInitialForm({
        name: food.name, brand: food.brand ?? '', barcode: food.barcode ?? '',
        servingAmount: String(food.servingAmount), servingUnit: food.servingUnit,
        calories: String(food.calories), protein: String(food.protein_g), carbs: String(food.carbs_g),
        fat: String(food.fat_g), fiber: food.fiber_g == null ? '' : String(food.fiber_g),
      })
      setLoading(false)
    })().catch((error) => {
      setLoading(false)
      Alert.alert('Could not load food', error instanceof Error ? error.message : String(error))
    })
    return () => { alive = false }
  }, [editId])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  const cancel = () => dirty
    ? Alert.alert('Discard changes?', 'Your unsaved food changes will be lost.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => router.back() }])
    : router.back()

  useEffect(() => {
    const onBackPress = () => {
      if (dirty) {
        cancel()
        return true
      }
      return false
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return () => sub.remove()
  }, [dirty])

  async function save(logAfter = false) {
    if (saving || isSavingRef.current) return
    isSavingRef.current = true
    let input: CustomFoodInput
    try {
      input = inputFromForm(form)
    } catch (error) {
      isSavingRef.current = false
      Alert.alert('Check this food', error instanceof Error ? error.message : String(error))
      return
    }

    setSaving(true)
    try {
      const handle = await db()
      const food = editId === null
        ? await createCustomFood(handle, input, Date.now())
        : await updateCustomFood(handle, editId, input, Date.now())
      if (logAfter) {
        router.replace({ pathname: '/food-review', params: { payload: encodeFoodReview({
          selection: customFoodSelection(food),
          date: params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : localDate(Date.now()),
        }) } } as never)
      } else router.back()
    } catch (error) {
      isSavingRef.current = false
      Alert.alert('Could not save food', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.lg,
          paddingBottom: Math.max(insets.bottom, space.lg) + 96,
          gap: space.md,
        }}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[type.title, { color: theme.text }]}>
            {editId === null ? 'Custom food' : 'Edit custom food'}
          </Text>
          <Pressable accessibilityRole="button" onPress={cancel} hitSlop={space.md}>
            <Text style={[type.label, { color: theme.textMuted }]}>Cancel</Text>
          </Pressable>
        </View>

        {loading ? (
          <Text style={[type.body, { color: theme.textMuted }]}>Loading food…</Text>
        ) : (
          <>
            <Field label="Food name" value={form.name} onChangeText={(value) => update('name', value)} placeholder="e.g. Homemade ladoo" />
            <Field label="Brand (optional)" value={form.brand} onChangeText={(value) => update('brand', value)} placeholder="e.g. MTR" />

            <View style={styles.row}>
              <Field label="Serving amount" value={form.servingAmount} onChangeText={(value) => update('servingAmount', value)} numeric />
              <View style={{ flex: 1 }}>
                <Text style={[type.caption, { color: theme.textMuted, marginBottom: space.xs }]}>Serving unit</Text>
                <View style={styles.unitRow}>
                  {(['g', 'oz'] as const).map((unit) => {
                    const selected = form.servingUnit === unit
                    return (
                      <Pressable
                        key={unit}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => update('servingUnit', unit)}
                        style={[
                          styles.unitButton,
                          { backgroundColor: selected ? theme.text : theme.bgElevated, borderColor: theme.border },
                        ]}
                      >
                        <Text style={[type.label, { color: selected ? theme.bg : theme.text }]}>{unit}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            </View>

            <Text style={[type.caption, { color: theme.textMuted, lineHeight: 18 }]}>Enter nutrients for one serving. This will be saved as your food.</Text>
            <View style={styles.row}>
              <Field label="Calories" value={form.calories} onChangeText={(value) => update('calories', value)} numeric />
              <Field label="Protein (g)" value={form.protein} onChangeText={(value) => update('protein', value)} numeric />
            </View>
            <View style={styles.row}>
              <Field label="Carbs (g)" value={form.carbs} onChangeText={(value) => update('carbs', value)} numeric />
              <Field label="Fat (g)" value={form.fat} onChangeText={(value) => update('fat', value)} numeric />
            </View>
            <View style={styles.row}>
              <Field label="Fiber (g, optional)" value={form.fiber} onChangeText={(value) => update('fiber', value)} numeric />
              <Field label="Barcode (optional)" value={form.barcode} onChangeText={(value) => update('barcode', value)} keyboardType="number-pad" />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editId === null ? 'Save custom food' : 'Save custom food changes'}
              disabled={saving}
              onPress={() => void save()}
              style={[styles.save, { backgroundColor: saving ? theme.border : theme.text }]}
            >
              <Text style={[type.bodyStrong, { color: theme.bg }]}>{saving ? 'Saving…' : editId === null ? 'Save food' : 'Save changes'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => void save(true)}
              style={[styles.secondary, { borderColor: theme.border }]}
            ><Text style={[type.bodyStrong, { color: theme.text }]}>Save &amp; review log</Text></Pressable>

            {editId !== null ? <Pressable accessibilityRole="button" onPress={() => Alert.alert('Delete this food?', 'Existing diary entries keep their saved nutrition.', [{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void (async()=>{await deleteCustomFood(await db(),editId,Date.now());router.back()})()}])} style={[styles.secondary,{borderColor:theme.safety}]}><Text style={[type.bodyStrong,{color:theme.safety}]}>Delete food</Text></Pressable> : null}

            {editId === null && existing.length > 0 ? (
              <View style={{ gap: space.sm, marginTop: space.lg }}>
                <Text style={[type.heading, { color: theme.text }]}>Your custom foods</Text>
                <Field label="Search your foods" value={filter} onChangeText={setFilter} placeholder="Search by name or brand" />
                {existing.filter(food => `${food.name} ${food.brand ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase())).map((food) => (
                  <Pressable
                    key={food.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${food.name}`}
                    onPress={() => router.push({ pathname: '/custom-food', params: { id: food.id } } as never)}
                    style={[styles.foodRow, { borderColor: theme.border }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[type.bodyStrong, { color: theme.text }]}>{food.name}</Text>
                      <Text style={[type.caption, { color: theme.textMuted }]}>{food.servingAmount} {food.servingUnit} · {Math.round(food.calories)} kcal</Text>
                    </View>
                    <Text style={[type.label, { color: theme.protein }]}>Edit</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  numeric = false,
  keyboardType,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  numeric?: boolean
  keyboardType?: 'number-pad'
}) {
  const theme = useTheme()
  return (
    <View style={{ flex: 1 }}>
      <Text style={[type.caption, { color: theme.textMuted, marginBottom: space.xs }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textFaint}
        keyboardType={keyboardType ?? (numeric ? 'decimal-pad' : 'default')}
        autoCapitalize={label.includes('Barcode') ? 'none' : 'sentences'}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-end' },
  unitRow: { flexDirection: 'row', gap: space.sm },
  unitButton: {
    flex: 1,
    minHeight: MIN_TAP_TARGET,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    fontSize: 17,
  },
  save: {
    minHeight: 54,
    marginTop: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: { minHeight: MIN_TAP_TARGET, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  foodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TAP_TARGET,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.md,
  },
})
