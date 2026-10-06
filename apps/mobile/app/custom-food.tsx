import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,  } from 'react-native'
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
import { useWebDirtyGuard } from '../src/ui/web-dirty-guard'
import { useTheme } from '../src/theme/ThemeProvider'
import { Field } from '../src/components/Field'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'
import { showToast } from '../src/components/toast-store'
import { confirmDialog } from '../src/ui/alert-web'

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

  // P2-15: browser back cannot be intercepted on web (expo-router's fork
  // dispatches a NAVIGATE action, which never fires beforeRemove), so for the
  // create flow the draft persists in sessionStorage and is restored on
  // return — losing work becomes impossible instead of announced. Cleared on
  // save and delete. The create form is the high-value case: editing an
  // existing food falls back to its last-saved DB state, like a native cancel.
  const draftKey = editId === null ? 'nutai:custom-food-draft:new' : `nutai:custom-food-draft:${editId}`
  const restoreTriedRef = useRef(false)
  useEffect(() => {
    if (Platform.OS !== 'web' || editId !== null || restoreTriedRef.current) return
    restoreTriedRef.current = true
    try {
      const raw = window.sessionStorage.getItem(draftKey)
      if (raw) setForm(JSON.parse(raw) as FormState)
    } catch {
      // A corrupt draft is worse than none — drop it.
      window.sessionStorage.removeItem(draftKey)
    }
  }, [])
  useEffect(() => {
    if (Platform.OS !== 'web' || editId !== null) return
    if (JSON.stringify(form) === JSON.stringify(EMPTY)) {
      window.sessionStorage.removeItem(draftKey)
      return
    }
    window.sessionStorage.setItem(draftKey, JSON.stringify(form))
  }, [form, draftKey, editId])
  const clearDraft = () => {
    if (Platform.OS === 'web') window.sessionStorage.removeItem(draftKey)
  }

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
        // UI/UX report §10.1 (Wave 1b): the row is gone but the screen still
        // renders — the toast states the fact and offers the way out.
        showToast({
          message: 'This custom food may have been removed.',
          tone: 'error',
          action: { label: 'Go back', onPress: () => router.back() },
        })
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
      showToast({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
    })
    return () => { alive = false }
  }, [editId])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  // P2-15: reload/tab-close get the browser's own leave-confirmation while the
  // form is dirty; the create flow additionally persists its draft (above), so
  // a browser back loses nothing.
  useWebDirtyGuard(dirty)
  const cancel = () => dirty
    // Losing unsaved edits is irreversible — the one destructive confirm on
    // this screen (UI/UX report §10.1 rule two).
    ? confirmDialog({
        title: 'Discard changes?',
        message: 'Your unsaved food changes will be lost.',
        confirmLabel: 'Discard',
        destructive: true,
        onConfirm: () => { clearDraft(); router.back() },
      })
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
      // Reversible validation/save failures are toasts (§10.1); an inline
      // Field error slot is the Wave 2 Field primitive's job.
      showToast({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
      return
    }

    setSaving(true)
    try {
      const handle = await db()
      const food = editId === null
        ? await createCustomFood(handle, input, Date.now())
        : await updateCustomFood(handle, editId, input, Date.now())
      if (logAfter) {
        clearDraft()
        router.replace({ pathname: '/food-review', params: { payload: encodeFoodReview({
          selection: customFoodSelection(food),
          date: params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : localDate(Date.now()),
        }) } } as never)
      } else { clearDraft(); router.back() }
    } catch (error) {
      isSavingRef.current = false
      showToast({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      // Edge-to-edge (Expo SDK 53+) broke Android's windowSoftInputMode
      // resize the old `undefined` behavior leaned on — 'height' keeps the
      // custom-food fields above the keyboard. Web never shows a software
      // keyboard and react-native-web's KeyboardAvoidingView is a plain
      // View, so this is inert there.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
            <Field label="Food name" value={form.name} onValueChange={(value) => update('name', value)} placeholder="e.g. Homemade ladoo" />
            <Field label="Brand (optional)" value={form.brand} onValueChange={(value) => update('brand', value)} placeholder="e.g. MTR" />

            <View style={styles.row}>
              <Field label="Serving amount" value={form.servingAmount} onValueChange={(value) => update('servingAmount', value)} numeric />
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
              <Field label="Calories" value={form.calories} onValueChange={(value) => update('calories', value)} numeric />
              <Field label="Protein (g)" value={form.protein} onValueChange={(value) => update('protein', value)} numeric />
            </View>
            <View style={styles.row}>
              <Field label="Carbs (g)" value={form.carbs} onValueChange={(value) => update('carbs', value)} numeric />
              <Field label="Fat (g)" value={form.fat} onValueChange={(value) => update('fat', value)} numeric />
            </View>
            <View style={styles.row}>
              <Field label="Fiber (g, optional)" value={form.fiber} onValueChange={(value) => update('fiber', value)} numeric />
              <Field label="Barcode (optional)" value={form.barcode} onValueChange={(value) => update('barcode', value)} keyboardType="number-pad" />
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

            {editId !== null ? <Pressable accessibilityRole="button" onPress={() => confirmDialog({title:'Delete this food?',message:'Existing diary entries keep their saved nutrition.',confirmLabel:'Delete',destructive:true,onConfirm:()=>void (async()=>{await deleteCustomFood(await db(),editId,Date.now());clearDraft();router.back()})()})} style={[styles.secondary,{borderColor:theme.safety}]}><Text style={[type.bodyStrong,{color:theme.safety}]}>Delete food</Text></Pressable> : null}

            {editId === null && existing.length > 0 ? (
              <View style={{ gap: space.sm, marginTop: space.lg }}>
                <Text style={[type.heading, { color: theme.text }]}>Your custom foods</Text>
                <Field label="Search your foods" value={filter} onValueChange={setFilter} placeholder="Search by name or brand" />
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
                    <Text style={[type.label, { color: theme.proteinText }]}>Edit</Text>
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
    // Wave 1a: 17px ad-hoc input joins type.body (Table 3.1).
    fontSize: type.body.fontSize,
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
