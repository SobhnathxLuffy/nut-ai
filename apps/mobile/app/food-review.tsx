import { router, useLocalSearchParams } from 'expo-router'
import { assistantGlobalStatus } from '../src/inference/pathA/assistant'
import { useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { decodeFoodReview } from '../src/data/food-review'
import { logManualFood, logManualMealWithItems } from '../src/data/manual-food'
import { db, undoLastOperation } from '../src/data/repo'
import { slotFor, localDate, isValidLocalDate } from '../src/data/date-utils'
import { useTheme } from '../src/theme/ThemeProvider'
import { Field } from '../src/components/Field'
import { showToast } from '../src/components/toast-store'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
const SOURCE_NAMES: Record<string, string> = {
  ifct: 'Indian Food Composition Tables', usda: 'USDA FoodData Central',
  userfood: 'Your food', recipe: 'Your recipe', indian_dish_kb: 'Nut AI dish library',
  ingredient_decomposition: 'Ingredient estimate',
}

export default function FoodReview() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ payload?: string; assistantMsgId?: string }>()
  const decoded = useMemo(() => {
    try { 
      const parsed = decodeFoodReview(params.payload)
      // PROTECT MOBILE: Ensure nutrientSnapshot exists to prevent fatal JS crashes during render.
      // A crash here causes the Expo app to reload and drop the user at Onboarding.
      if (parsed?.selection && !parsed.selection.nutrientSnapshot) {
        throw new Error('Data corrupted')
      }
      return { value: parsed, error: null } 
    }
    catch { 
      return { value: null, error: 'This saved meal has damaged data and cannot be opened. Go back and log the food again.' }
    }
  }, [params.payload])
  const base = decoded.value?.selection
  const [name, setName] = useState(base?.displayName ?? '')
  const [quantity, setQuantity] = useState('1')
  // Piece-weight model: total grams = quantity x grams-per-1-quantity. Every
  // field is editable and the others follow — rotis become "2 x 40 g", not a
  // bare gram count.
  const [unitGrams, setUnitGrams] = useState(base ? String(Math.round(base.grams * 10) / 10) : '100')
  const [grams, setGrams] = useState(base ? String(Math.round(base.grams * 10) / 10) : '')
  const [date, setDate] = useState(decoded.value?.date || localDate(Date.now()))
  const [slot, setSlot] = useState<(typeof SLOTS)[number]>(slotFor(Date.now()) as (typeof SLOTS)[number])
  const [busy, setBusy] = useState(false)
  const isSavingRef = useRef(false)
  const [error, setError] = useState<string | null>(decoded.error)

  const round1 = (value: number) => String(Math.round(value * 10) / 10)

  const updateQuantity = (value: string) => {
    setQuantity(value)
    const count = Number(value)
    const unit = Number(unitGrams)
    if (Number.isFinite(count) && count > 0 && Number.isFinite(unit) && unit > 0) {
      setGrams(round1(count * unit))
    }
  }

  const updateUnitGrams = (value: string) => {
    setUnitGrams(value)
    const unit = Number(value)
    const count = Number(quantity)
    if (Number.isFinite(unit) && unit > 0 && Number.isFinite(count) && count > 0) {
      setGrams(round1(count * unit))
    }
  }

  const updateGrams = (value: string) => {
    setGrams(value)
    const weight = Number(value)
    const count = Number(quantity)
    if (base && base.grams > 0 && Number.isFinite(weight) && weight > 0 && Number.isFinite(count) && count > 0) {
      setUnitGrams(round1(weight / count))
    }
  }

  // P1-6: the date field is free text, so validate it live instead of letting
  // the user discover the problem through a database error on save.
  const dateValid = isValidLocalDate(date)

  async function save() {
    if (!base || busy || isSavingRef.current) return
    isSavingRef.current = true
    const weight = Number(grams)
    if (!name.trim()) {
      isSavingRef.current = false
      return setError('Food name is required')
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      isSavingRef.current = false
      return setError('Grams must be greater than zero')
    }
    if (!dateValid) {
      isSavingRef.current = false
      return setError('Enter a real calendar date in YYYY-MM-DD format, like 2026-02-27')
    }
    setBusy(true); setError(null)
    try {
      const options = { localDate: date, mealSlot: slot }
      const selections = decoded.value?.selections
      if (selections && selections.length > 1) {
        const originalTotal = selections.reduce((sum, item) => sum + item.grams, 0)
        const scale = weight / originalTotal
        await logManualMealWithItems(await db(), selections.map(item => ({ ...item, grams: item.grams * scale })), Date.now(), options)
      } else {
        await logManualFood(await db(), { ...base, displayName: name.trim(), grams: weight }, Date.now(), options)
      }
      if (params.assistantMsgId) {
        assistantGlobalStatus[params.assistantMsgId] = 'SAVED';
      }
      // UI/UX report §10.1 (Wave 1b): every logging path through this screen
      // (food-search, custom food, dish composer, recipes, assistant, saved
      // foods) confirms with the same Undo toast the scan result screen uses.
      // The toast host is mounted at the app root, so it outlives the dismiss;
      // undoLastOperation emits the food-mutation event that refreshes the
      // Home/Food timelines.
      showToast({
        message: 'Meal logged.',
        tone: 'success',
        durationMs: 6000,
        action: {
          label: 'Undo',
          onPress: () => {
            void undoLastOperation().then((r) => {
              if (!r.success) {
                showToast({ message: 'Could not undo — the log changed since this meal was added.', tone: 'error' })
              }
            })
          },
        },
      })
      if (router.canDismiss?.()) {
        router.dismissAll()
      } else {
        router.back()
      }
    } catch (caught) {
      isSavingRef.current = false
      setError(caught instanceof Error ? caught.message : 'Could not save this food')
      setBusy(false)
    }
  }

  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + 80, gap: space.md }}>
      <View style={styles.header}><Text style={[type.title,{color:theme.text}]}>Review food</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel review" onPress={()=>router.back()} hitSlop={space.md}><Text style={[type.label,{color:theme.textMuted}]}>Cancel</Text></Pressable></View>
      {base ? <>
        <Field label="Food name" value={name} onValueChange={setName}/>
        <Text style={[type.caption,{color:theme.textMuted}]}>{SOURCE_NAMES[base.matchedFoodSource] ?? 'Food database'}{base.matchedFoodSource === 'ingredient_decomposition' ? ' · cooking amounts are estimates' : ''}</Text>
        {decoded.value?.selections && decoded.value.selections.length > 1 ? <Text style={[type.caption,{color:theme.textMuted}]}>{decoded.value.selections.map(item=>item.displayName).join(' · ')}</Text> : null}
        <View style={styles.row}>
          <Field label="Quantity (how many)" value={quantity} onValueChange={updateQuantity} numeric/>
          <Field label="Grams in 1 quantity" value={unitGrams} onValueChange={updateUnitGrams} numeric/>
        </View>
        <Field label="Total grams" value={grams} onValueChange={updateGrams} numeric/>
        {base.grams > 0 ? (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: -space.xs }]}>
            Standard serving: 1 × {Math.round(base.grams * 10) / 10} g — change how many you had and the weight of one piece or bowl
          </Text>
        ) : null}
        {decoded.value?.ingredients && decoded.value.ingredients.length > 0 ? (
          <View style={styles.ingredientsCard}>
            <Text style={[type.label, { color: theme.textMuted, fontWeight: '700' }]}>
              What's inside — per {Math.round(base.grams * 10) / 10} g serving
            </Text>
            {decoded.value.ingredients.map((item) => (
              <View key={item.label} style={styles.ingredientRow}>
                <Text style={[type.caption, { color: theme.text, flex: 1 }]} numberOfLines={2}>{item.label}</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>{item.grams > 0 ? `${item.grams} g` : '—'}</Text>
              </View>
            ))}
            {decoded.value.dishId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit this dish's ingredients in the recipe composer"
                onPress={() => router.push({
                  pathname: '/dish-composer',
                  params: { dishId: decoded.value!.dishId!, date },
                } as never)}
                style={[styles.editIngredientsBtn, { borderColor: theme.protein }]}
              >
                <Text style={[type.label, { color: theme.protein, fontWeight: '700' }]}>Edit ingredients to your version</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Field label="Date (YYYY-MM-DD)" value={date} onValueChange={setDate} keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" autoCorrect={false} autoCapitalize="none"/>
        {!dateValid ? <Text style={[type.caption,{color:theme.safety}]}>Enter a real calendar date in YYYY-MM-DD format, like {localDate(Date.now())}.</Text> : null}
        <Text style={[type.caption,{color:theme.textMuted}]}>Meal</Text>
        <View style={styles.slots}>{SLOTS.map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={`Select ${value} meal slot`} onPress={()=>setSlot(value)} style={[styles.slot,{borderColor:theme.border,backgroundColor:slot===value?theme.text:theme.bgElevated}]}><Text style={[type.label,{color:slot===value?theme.bg:theme.text}]}>{value[0]!.toUpperCase()+value.slice(1)}</Text></Pressable>)}</View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md, marginVertical: space.xs }}>
          <Text style={[type.title, { color: theme.text }]}>
            {base.nutrientSnapshot.kcal !== null
              ? `${Math.round((base.nutrientSnapshot.kcal ?? 0) * (Number(grams) || 0) / 100)} kcal`
              : 'Calories unavailable'}
          </Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            P: {base.nutrientSnapshot.protein_g !== null ? `${Math.round(((base.nutrientSnapshot.protein_g ?? 0) * (Number(grams) || 0) / 100) * 10) / 10}g` : '—'} ·
            C: {base.nutrientSnapshot.carbs_g !== null ? `${Math.round(((base.nutrientSnapshot.carbs_g ?? 0) * (Number(grams) || 0) / 100) * 10) / 10}g` : '—'} ·
            F: {base.nutrientSnapshot.fat_g !== null ? `${Math.round(((base.nutrientSnapshot.fat_g ?? 0) * (Number(grams) || 0) / 100) * 10) / 10}g` : '—'}
          </Text>
        </View>
        {error ? <Text style={[type.caption,{color:theme.safety}]}>{error}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Save to diary" disabled={busy || !dateValid} onPress={()=>void save()} style={[styles.primary,{backgroundColor:busy||!dateValid?theme.border:theme.text}]}><Text style={[type.bodyStrong,{color:theme.bg}]}>{busy?'Saving…':'Save to diary'}</Text></Pressable>
      </> : <><Text style={[type.body,{color:theme.safety}]}>{error}</Text><Pressable accessibilityRole="button" onPress={()=>router.back()} style={[styles.primary,{backgroundColor:theme.text}]}><Text style={[type.bodyStrong,{color:theme.bg}]}>Back</Text></Pressable></>}
    </ScrollView>
  </KeyboardAvoidingView>
}

// Wave 1a: the 17px ad-hoc input size joins type.body (UI/UX report Table 3.1).
const styles=StyleSheet.create({header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},row:{flexDirection:'row',gap:space.md},input:{minHeight:MIN_TAP_TARGET,borderWidth:StyleSheet.hairlineWidth,borderRadius:radius.md,paddingHorizontal:space.md,fontSize:type.body.fontSize},slots:{flexDirection:'row',flexWrap:'wrap',gap:space.sm},slot:{minHeight:MIN_TAP_TARGET,paddingHorizontal:space.md,borderWidth:StyleSheet.hairlineWidth,borderRadius:radius.pill,alignItems:'center',justifyContent:'center'},primary:{minHeight:54,borderRadius:radius.pill,alignItems:'center',justifyContent:'center',marginTop:space.md},ingredientsCard:{borderWidth:StyleSheet.hairlineWidth,borderColor:'rgba(128,128,128,0.35)',borderRadius:radius.md,padding:space.md,gap:space.xs},ingredientRow:{flexDirection:'row',alignItems:'center',gap:space.sm},editIngredientsBtn:{marginTop:space.xs,minHeight:MIN_TAP_TARGET,borderWidth:1,borderRadius:radius.md,alignItems:'center',justifyContent:'center',paddingHorizontal:space.md}})
