import { router, useLocalSearchParams } from 'expo-router'
import { assistantGlobalStatus } from '../src/inference/pathA/assistant'
import { useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { decodeFoodReview } from '../src/data/food-review'
import { logManualFood, logManualMealWithItems } from '../src/data/manual-food'
import { db } from '../src/data/repo'
import { slotFor, localDate, isValidLocalDate } from '../src/data/date-utils'
import { useTheme } from '../src/theme/ThemeProvider'
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
      return { value: null, error: 'Data corrupted, go back' } 
    }
  }, [params.payload])
  const base = decoded.value?.selection
  const [name, setName] = useState(base?.displayName ?? '')
  const [quantity, setQuantity] = useState('1')
  const [grams, setGrams] = useState(base ? String(Math.round(base.grams * 10) / 10) : '')
  const [date, setDate] = useState(decoded.value?.date || localDate(Date.now()))
  const [slot, setSlot] = useState<(typeof SLOTS)[number]>(slotFor(Date.now()) as (typeof SLOTS)[number])
  const [busy, setBusy] = useState(false)
  const isSavingRef = useRef(false)
  const [error, setError] = useState<string | null>(decoded.error)

  const updateQuantity = (value: string) => {
    setQuantity(value)
    const count = Number(value)
    if (base && Number.isFinite(count) && count > 0) {
      setGrams(String(Math.round(base.grams * count * 10) / 10))
    }
  }

  const updateGrams = (value: string) => {
    setGrams(value)
    const weight = Number(value)
    if (base && base.grams > 0 && Number.isFinite(weight) && weight > 0) {
      const calculatedServings = Math.round((weight / base.grams) * 100) / 100
      setQuantity(String(calculatedServings))
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
        <Field label="Food name" value={name} onChange={setName}/>
        <Text style={[type.caption,{color:theme.textMuted}]}>{SOURCE_NAMES[base.matchedFoodSource] ?? 'Food database'}{base.matchedFoodSource === 'ingredient_decomposition' ? ' · cooking amounts are estimates' : ''}</Text>
        {decoded.value?.selections && decoded.value.selections.length > 1 ? <Text style={[type.caption,{color:theme.textMuted}]}>{decoded.value.selections.map(item=>item.displayName).join(' · ')}</Text> : null}
        <View style={styles.row}>
          <Field label="Servings" value={quantity} onChange={updateQuantity} numeric/>
          <Field label="Total grams" value={grams} onChange={updateGrams} numeric/>
        </View>
        {base.grams > 0 ? (
          <Text style={[type.micro, { color: theme.textMuted, marginTop: -space.xs }]}>
            Reference serving: 1 serving = {Math.round(base.grams * 10) / 10} g
          </Text>
        ) : null}
        <Field label="Date (YYYY-MM-DD)" value={date} onChange={setDate}/>
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

function Field({label,value,onChange,numeric=false}:{label:string;value:string;onChange:(v:string)=>void;numeric?:boolean}) { const theme=useTheme(); return <View style={{flex:1}}><Text style={[type.caption,{color:theme.textMuted,marginBottom:space.xs}]}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} keyboardType={numeric?'decimal-pad':'default'} style={[styles.input,{color:theme.text,borderColor:theme.border,backgroundColor:theme.bgElevated}]}/></View> }
const styles=StyleSheet.create({header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},row:{flexDirection:'row',gap:space.md},input:{minHeight:MIN_TAP_TARGET,borderWidth:StyleSheet.hairlineWidth,borderRadius:radius.md,paddingHorizontal:space.md,fontSize:17},slots:{flexDirection:'row',flexWrap:'wrap',gap:space.sm},slot:{minHeight:MIN_TAP_TARGET,paddingHorizontal:space.md,borderWidth:StyleSheet.hairlineWidth,borderRadius:radius.pill,alignItems:'center',justifyContent:'center'},primary:{minHeight:54,borderRadius:radius.pill,alignItems:'center',justifyContent:'center',marginTop:space.md}})
