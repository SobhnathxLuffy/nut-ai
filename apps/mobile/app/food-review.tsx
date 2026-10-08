import { router, useLocalSearchParams } from 'expo-router'
import { assistantGlobalStatus } from '../src/inference/pathA/assistant'
import { useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { decodeFoodReview } from '../src/data/food-review'
import { logManualFood, logManualMealWithItems, type ManualFoodSelection } from '../src/data/manual-food'
import { db } from '../src/data/repo'
import { showUndoableLoggedToast } from '../src/data/undo-toast'
import { slotFor, localDate, isValidLocalDate } from '../src/data/date-utils'
import { useTheme } from '../src/theme/ThemeProvider'
import { Field } from '../src/components/Field'
import { Icon } from '../src/components/Icon'
import { PressableFX } from '../src/components/PressableFX'
import { Button, Card } from '../src/components/Screen'
// UI/UX report Table 9.2 (Wave 1c): "Log meal → Success (notification)" — the
// core reward moment fires with the Undo toast, never instead of it.
import { selectionAsync, success as hapticSuccess } from '../src/utils/haptics'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
const SOURCE_NAMES: Record<string, string> = {
  ifct: 'Indian Food Composition Tables', usda: 'USDA FoodData Central',
  userfood: 'Your food', recipe: 'Your recipe', indian_dish_kb: 'Nut AI dish library',
  ingredient_decomposition: 'Ingredient estimate',
}

/** The gram ladder — large touch steps for the most common bowl/plate masses. */
const GRAM_LADDER = [25, 50, 100, 150, 200, 250] as const
/** Fine step for the total-grams stepper. */
const GRAM_STEP = 10

/**
 * Per-100g snapshot value scaled to a gram weight. Null stays null — missing
 * nutrition is shown as '—' and excluded from sums, never silently counted as
 * zero (§19). An unknown (null/non-finite) gram weight scales nothing: null
 * out, never 0.
 */
function scaledPer100(per100: number | null | undefined, grams: number | null): number | null {
  return per100 != null && grams != null && Number.isFinite(grams) ? (per100 * grams) / 100 : null
}

/** One macro triple line. Colon form (footer, the full-meal readout). */
function macroLine(protein: number | null, carbs: number | null, fat: number | null): string {
  const fmt = (v: number | null) => (v != null ? `${Math.round(v * 10) / 10}g` : '—')
  return `P: ${fmt(protein)} · C: ${fmt(carbs)} · F: ${fmt(fat)}`
}

/** One macro triple line, compact form (per-item rows) so the footer's colon
    form stays the single full-meal readout for assistive tech and e2e. */
function macroLineCompact(protein: number | null, carbs: number | null, fat: number | null): string {
  const fmt = (v: number | null) => (v != null ? `${Math.round(v * 10) / 10}g` : '—')
  return `P ${fmt(protein)} · C ${fmt(carbs)} · F ${fmt(fat)}`
}

/**
 * Food review — THE STEPPER (UI/UX report Ch. 8.3, Wave 3).
 *
 * "Quantity and unit confirmed in one card with large touch ladders, slot
 * picker as a segmented row, and a sticky summary footer with the log button."
 * This is a re-layout of the SAME data logic: the piece-weight model
 * (quantity × grams-in-1-quantity, all three synced), dish-KB breakdowns, the
 * composer jump, date validation, the assistant-proposal status write, and the
 * Undo toast are all unchanged.
 *
 * 11-d separate-food logging: a MULTI-item payload (assistant proposal,
 * composite meal, saved food) no longer renders one global total-grams stepper
 * that rescaled every item proportionally on save. It renders one row per
 * selection — name, editable grams, live kcal + macro line — and saves each
 * item with its own grams (the footer shows the Σ of the rows). The global
 * stepper remains for the single-food case.
 */
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
  // Per-item review (multi-item payloads — assistant proposals, composite
  // meals, saved foods): one editable gram weight per selection row. Each
  // row's grams is AUTHORITATIVE at save time; no global weight rescales them.
  const reviewSelections: ManualFoodSelection[] = decoded.value?.selections ?? []
  const isMulti = reviewSelections.length > 1
  const [itemGrams, setItemGrams] = useState<string[]>(() =>
    reviewSelections.map((item) => String(Math.round(item.grams * 10) / 10)),
  )
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

  // Per-item grams: only the edited row moves. (11-d separate-food logging —
  // the old single global weight rescaled every item proportionally, so
  // individual weights could not be changed.)
  const updateItemGrams = (index: number, value: string) => {
    setItemGrams((current) => current.map((g, i) => (i === index ? value : g)))
  }

  /** A row's grams as it will be saved: the edited text, falling back to the
      payload's own grams when the row state is missing (stale payload). Null
      while the field is mid-edit blank or non-numeric ("", "1.") — display
      renders the missing-data dialect and save() blocks, never "NaN kcal" or
      a silent 0 (§8.3/§19). */
  const rowGramsAt = (index: number): number | null => {
    const raw = itemGrams[index] ?? String(Math.round(reviewSelections[index]!.grams * 10) / 10)
    if (raw.trim() === '') return null
    const grams = Number(raw)
    return Number.isFinite(grams) ? grams : null
  }

  // ---- Large touch ladders (Ch. 8.3). Each step lands the Table 9.2
  // selection haptic and keeps the piece-weight fields synced.
  const stepQuantity = (delta: number) => {
    const count = Number(quantity)
    const next = Math.max(0, (Number.isFinite(count) ? count : 0) + delta)
    updateQuantity(String(next))
    void selectionAsync()
  }
  const stepGrams = (delta: number) => {
    const weight = Number(grams)
    const next = Math.max(0, Math.round(((Number.isFinite(weight) ? weight : 0) + delta) * 10) / 10)
    updateGrams(String(next))
    void selectionAsync()
  }
  const setLadderGrams = (preset: number) => {
    updateGrams(String(preset))
    void selectionAsync()
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
    // Single-item payloads keep the one total-grams field. Multi-item
    // payloads skip it — the aggregated selection is never written, so its
    // grams is not a meaningful thing to require; each ROW is validated
    // instead (below).
    if (!isMulti && (!Number.isFinite(weight) || weight <= 0)) {
      isSavingRef.current = false
      return setError('Grams must be greater than zero')
    }
    if (!dateValid) {
      isSavingRef.current = false
      return setError('Enter a real calendar date in YYYY-MM-DD format, like 2026-02-27')
    }
    if (isMulti) {
      for (let i = 0; i < reviewSelections.length; i++) {
        const grams = rowGramsAt(i)
        // Null (mid-edit text) blocks exactly like the NaN it replaces —
        // validation behavior is unchanged.
        if (grams === null || grams <= 0) {
          isSavingRef.current = false
          return setError(`Enter a valid gram weight greater than zero for "${reviewSelections[i]!.displayName}"`)
        }
      }
    }
    setBusy(true); setError(null)
    try {
      const options = { localDate: date, mealSlot: slot }
      if (isMulti) {
        // 11-d separate-food logging: each item saves with ITS OWN edited
        // grams. The old single-global-weight proportional rescale is gone —
        // editing one row never moves another, and each food still lands as
        // its own log_item.
        await logManualMealWithItems(
          await db(),
          // Every row validated finite > 0 above, so grams cannot be null here.
          reviewSelections.map((item, i) => ({ ...item, grams: rowGramsAt(i)! })),
          Date.now(),
          options,
        )
      } else {
        await logManualFood(await db(), { ...base, displayName: name.trim(), grams: weight }, Date.now(), options)
      }
      if (params.assistantMsgId) {
        assistantGlobalStatus[params.assistantMsgId] = 'SAVED';
      }
      // Table 9.2: log meal → success haptic.
      void hapticSuccess()
      // UI/UX report §10.1 (Wave 1b): every logging path through this screen
      // (food-search, custom food, dish composer, recipes, assistant, saved
      // foods) confirms with the same Undo toast the scan result screen uses.
      // The toast host is mounted at the app root, so it outlives the dismiss;
      // undoLastOperation emits the food-mutation event that refreshes the
      // Home/Food timelines.
      showUndoableLoggedToast('Meal logged.')
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

  // Mid-edit the grams field can hold "" or "1." — that is UNKNOWN, not zero
  // (§19: missing nutrition never becomes zero). A null weight renders the
  // missing-data dialect ('Calories unavailable' / '—') instead of a false
  // "0 kcal"; save validation is unchanged (save() parses the field itself).
  const weight = grams.trim() !== '' && Number.isFinite(Number(grams)) ? Number(grams) : null
  const kcalNow = base && base.nutrientSnapshot.kcal !== null && weight != null
    ? Math.round((base.nutrientSnapshot.kcal ?? 0) * weight / 100)
    : null
  // Ladder highlight sits off while the field is mid-edit (−1 matches no preset).
  const ladderGrams = weight != null ? Math.round(weight) : -1

  // Footer totals. Multi-item meals total their rows' CURRENT grams (a
  // nutrient is summed only when every row reports it — no zero-filling).
  const multiTotals = isMulti
    ? reviewSelections.reduce(
        (acc, item, i) => {
          const grams = rowGramsAt(i)
          const snap = item.nutrientSnapshot
          return {
            // An unknown row weight (mid-edit) makes every total unknown —
            // the footer shows the missing-data dialect, never "NaN kcal".
            kcal: acc.kcal !== null && snap?.kcal != null && grams != null ? acc.kcal + (snap.kcal * grams) / 100 : null,
            protein: acc.protein !== null && snap?.protein_g != null && grams != null ? acc.protein + (snap.protein_g * grams) / 100 : null,
            carbs: acc.carbs !== null && snap?.carbs_g != null && grams != null ? acc.carbs + (snap.carbs_g * grams) / 100 : null,
            fat: acc.fat !== null && snap?.fat_g != null && grams != null ? acc.fat + (snap.fat_g * grams) / 100 : null,
          }
        },
        { kcal: 0 as number | null, protein: 0 as number | null, carbs: 0 as number | null, fat: 0 as number | null },
      )
    : null
  const footerKcal = isMulti && multiTotals
    ? (multiTotals.kcal != null ? Math.round(multiTotals.kcal) : null)
    : kcalNow
  const footerMacros = isMulti && multiTotals
    ? macroLine(multiTotals.protein, multiTotals.carbs, multiTotals.fat)
    : base
      ? macroLine(
          scaledPer100(base.nutrientSnapshot.protein_g, weight),
          scaledPer100(base.nutrientSnapshot.carbs_g, weight),
          scaledPer100(base.nutrientSnapshot.fat_g, weight),
        )
      : ''

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* 'height' on Android: its default adjustResize + 'padding' leaves the
          fields under the keyboard, so the scroll area must shrink instead
          (iOS keeps 'padding', which works there). */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 180, gap: space.md }}
        >
          <View style={styles.header}>
            <Text style={[type.title, { color: theme.text }]}>Review food</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel review" onPress={() => router.back()} hitSlop={space.md}>
              <Text style={[type.label, { color: theme.textMuted }]}>Cancel</Text>
            </Pressable>
          </View>
          {base ? <>
            <Field label="Food name" value={name} onValueChange={setName} />
            <Text style={[type.caption, { color: theme.textMuted }]}>{SOURCE_NAMES[base.matchedFoodSource] ?? 'Food database'}{base.matchedFoodSource === 'ingredient_decomposition' ? ' · cooking amounts are estimates' : ''}</Text>

            {isMulti ? (
              /* STEP 1 (multi-item meal) — ONE ROW PER FOOD, each with its own
                 editable grams. This is the 11-d separate-food contract: a
                 proposal like "3 parathas and 400g curd" arrives as separate
                 rows that are weighed (and saved) individually — the old
                 single total-grams stepper could only rescale every item
                 proportionally, so it stays single-selection only. */
              <Card>
                <Text style={[type.label, { color: theme.text }]}>Foods in this meal</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  Each food saves as its own item — set the weight you actually had for each row.
                </Text>
                {reviewSelections.map((item, index) => {
                  const rowGrams = rowGramsAt(index)
                  const snap = item.nutrientSnapshot
                  return (
                    <View key={`${item.displayName}-${index}`} style={styles.itemReview}>
                      <View style={styles.itemReviewHead}>
                        <Text style={[type.bodyStrong, { color: theme.text, flex: 1 }]} numberOfLines={2}>{item.displayName}</Text>
                        <Text style={[type.bodyStrong, type.monoData, { color: theme.text }]}>
                          {snap?.kcal != null && rowGrams != null ? `${Math.round((snap.kcal * rowGrams) / 100)} kcal` : '—'}
                        </Text>
                      </View>
                      <Field
                        label={`${item.displayName} grams`}
                        value={itemGrams[index] ?? String(Math.round(item.grams * 10) / 10)}
                        onValueChange={(value) => updateItemGrams(index, value)}
                        numeric
                      />
                      <Text style={[type.caption, { color: theme.textMuted }]}>
                        {macroLineCompact(
                          scaledPer100(snap?.protein_g, rowGrams),
                          scaledPer100(snap?.carbs_g, rowGrams),
                          scaledPer100(snap?.fat_g, rowGrams),
                        )}
                      </Text>
                    </View>
                  )
                })}
              </Card>
            ) : (
              /* STEP 1 (single food) — Quantity & unit confirmed in ONE card,
                 with large touch ladders: a how-many stepper, a gram stepper,
                 and the gram ladder of common bowl/plate masses. */
              <Card>
                <Text style={[type.label, { color: theme.text }]}>How much</Text>
                <StepperRow
                  label="How many"
                  value={quantity}
                  onMinus={() => stepQuantity(-1)}
                  onPlus={() => stepQuantity(1)}
                />
                <View style={styles.row}>
                  <Field label="Grams in 1 quantity" value={unitGrams} onValueChange={updateUnitGrams} numeric />
                  <Field label="Quantity (how many)" value={quantity} onValueChange={updateQuantity} numeric />
                </View>
                <StepperRow
                  label="Total grams"
                  step={GRAM_STEP}
                  value={grams}
                  onMinus={() => stepGrams(-GRAM_STEP)}
                  onPlus={() => stepGrams(GRAM_STEP)}
                />
                <Field label="Total grams (type to fine-tune)" value={grams} onValueChange={updateGrams} numeric />
                <View style={styles.ladder}>
                  {GRAM_LADDER.map((preset) => (
                    <PressableFX
                      key={preset}
                      accessibilityRole="button"
                      accessibilityLabel={`Set ${preset} grams`}
                      accessibilityState={{ selected: ladderGrams === preset }}
                      onPress={() => setLadderGrams(preset)}
                      style={[styles.ladderChip, { borderColor: theme.border, backgroundColor: ladderGrams === preset ? theme.text : theme.bgSunken }]}
                    >
                      <Text style={[type.label, { color: ladderGrams === preset ? theme.bg : theme.text }]}>{preset} g</Text>
                    </PressableFX>
                  ))}
                </View>
                {base.grams > 0 ? (
                  <Text style={[type.caption, { color: theme.textMuted }]}>
                    Standard serving: 1 × {Math.round(base.grams * 10) / 10} g — change how many you had and the weight of one piece or bowl
                  </Text>
                ) : null}
              </Card>
            )}

            {/* STEP 2 — Meal slot as a segmented row + the date, one card. */}
            <Card>
              <Text style={[type.label, { color: theme.text }]}>Meal & day</Text>
              <View style={[styles.slotRow, { borderColor: theme.border }]}>
                {SLOTS.map((value, index) => {
                  const active = slot === value
                  return (
                    <PressableFX
                      key={value}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${value} meal slot`}
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        // Table 9.2: slot picker → selection haptic, only on a change.
                        if (value !== slot) void selectionAsync()
                        setSlot(value)
                      }}
                      style={[
                        styles.slotSeg,
                        index === 0 && styles.slotFirst,
                        index === SLOTS.length - 1 && styles.slotLast,
                        active ? { backgroundColor: theme.text } : { backgroundColor: theme.bgSunken },
                      ]}
                    >
                      <Text style={[type.label, { color: active ? theme.bg : theme.text }]}>{value[0]!.toUpperCase() + value.slice(1)}</Text>
                    </PressableFX>
                  )
                })}
              </View>
              <Field label="Date (YYYY-MM-DD)" value={date} onValueChange={setDate} keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" autoCorrect={false} autoCapitalize="none" />
              {!dateValid ? <Text style={[type.caption, { color: theme.safety }]}>Enter a real calendar date in YYYY-MM-DD format, like {localDate(Date.now())}.</Text> : null}
            </Card>

            {decoded.value?.ingredients && decoded.value.ingredients.length > 0 ? (
              <Card>
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
                    <Text style={[type.label, { color: theme.proteinText, fontWeight: '700' }]}>Edit ingredients to your version</Text>
                  </Pressable>
                ) : null}
              </Card>
            ) : null}

            {error ? <Text style={[type.caption, { color: theme.safety }]}>{error}</Text> : null}
          </> : <><Text style={[type.body, { color: theme.safety }]}>{error}</Text><Button label="Back" size="lg" selected onPress={() => router.back()} style={{ marginTop: space.md }} /></>}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* STICKY SUMMARY FOOTER (Ch. 8.3) — the totals the stepper (or, for a
          multi-item meal, the per-item rows) are building, and the log button,
          always visible above the fold. Multi-item meals show the Σ of the
          rows' CURRENT grams; a nutrient is summed only when every row
          reports it — missing values are never counted as zero. */}
      {base ? (
        <View style={[styles.footer, { backgroundColor: theme.bgElevated, borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, space.md) }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.title, type.monoData, { color: theme.text }]}>
              {footerKcal != null ? `${footerKcal} kcal` : 'Calories unavailable'}
            </Text>
            <Text style={[type.caption, { color: theme.textMuted }]}>{footerMacros}</Text>
          </View>
          <Button
            label={busy ? 'Saving…' : 'Save to diary'}
            icon="check"
            size="lg"
            selected
            disabled={busy || !dateValid}
            onPress={() => void save()}
          />
        </View>
      ) : null}
    </View>
  )
}

/** One large-touch stepper row — label, 44pt minus, tabular value, 44pt plus. */
function StepperRow({
  label,
  value,
  step = 1,
  onMinus,
  onPlus,
}: {
  label: string
  value: string
  step?: number
  onMinus: () => void
  onPlus: () => void
}) {
  const theme = useTheme()
  return (
    <View style={styles.stepperRow}>
      <Text style={[type.caption, { color: theme.textMuted, flex: 1 }]}>{label}</Text>
      <PressableFX
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label} by ${step}`}
        onPress={onMinus}
        style={[styles.stepperBtn, { borderColor: theme.border, backgroundColor: theme.bgSunken }]}
      >
        <Icon name="minus" size={20} color={theme.text} weight={2.2} />
      </PressableFX>
      <Text style={[type.bodyStrong, type.monoData, { color: theme.text, minWidth: 64, textAlign: 'center' }]}>
        {value}
      </Text>
      <PressableFX
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label} by ${step}`}
        onPress={onPlus}
        style={[styles.stepperBtn, { borderColor: theme.border, backgroundColor: theme.bgSunken }]}
      >
        <Icon name="plus" size={20} color={theme.text} weight={2.2} />
      </PressableFX>
    </View>
  )
}

// Wave 1a: the 17px ad-hoc input size joins type.body (UI/UX report Table 3.1).
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', gap: space.md },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepperBtn: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ladder: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  ladderChip: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotRow: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  slotSeg: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  slotFirst: { borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md },
  slotLast: { borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Per-item review rows (multi-item meals): name + kcal head, grams field,
  // compact macro line — one block per food, matching the card's gap rhythm.
  itemReview: { gap: space.xs },
  itemReviewHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TAP_TARGET / 2 },
  editIngredientsBtn: {
    marginTop: space.xs,
    minHeight: MIN_TAP_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
})