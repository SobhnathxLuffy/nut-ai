import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TIER_GLYPH } from '@nutai/confidence'
import { undoOperation } from '@nutai/db-adapter'
import { db, deleteMeal } from '../src/data/repo'
import { isValidLocalDate } from '../src/data/date-utils'
import {
  duplicateLoggedItem,
  getLoggedMeal,
  removeLoggedItem,
  updateLoggedMeal,
  type LoggedMealDetail,
  type LoggedMealItem,
} from '../src/data/logged-meals'
import { loggedRowBandFor, visibilityLabelFor } from '../src/data/meal-honesty'
import { useTheme } from '../src/theme/ThemeProvider'
import { Badge } from '../src/components/Badge'
import { Field } from '../src/components/Field'
import { Icon } from '../src/components/Icon'
import { PressableFX } from '../src/components/PressableFX'
import { MenuSheet } from '../src/components/Sheet'
import { Card } from '../src/components/Screen'
import { showToast } from '../src/components/toast-store'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'
import { confirmDialog } from '../src/ui/alert-web'
// Table 9.2: expanding a row / picking from its menu is a selection; the
// destructive remove confirm lands warning (confirmDialog path).
import { selectionAsync } from '../src/utils/haptics'

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const

interface EditableItem {
  id: number
  name: string
  gramsText: string
  kcalPer100g: number | null
  // Task 11-b: the row's per-100g snapshot macros, shown at the item's current
  // grams and summed into the meal totals. NULL = the log never reported it.
  proteinPer100g: number | null
  fatPer100g: number | null
  carbPer100g: number | null
  fiberPer100g: number | null
  sugarPer100g: number | null
  sodiumPer100Mg: number | null
  // F3 macro overrides (T-IMPL-A): the per-100 g fields the user can hand-
  // correct. The text is the DRAFT; the *Per100g fields above stay the loaded
  // baseline so save() can tell an actual override from a no-op round trip.
  // A per-100 g basis is THE label basis — it is also literally the snap_*
  // column, so totals, previews and later gram edits all rescale from it.
  kcalText: string
  proteinText: string
  carbText: string
  fatText: string
  /** Task 5-5: persisted scan honesty, rendered under the row summary. */
  visibility?: string | null
  bandHalfPct?: number | null
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
  // P3-U1: a deep link with a bad/missing id used to render 'Loading meal…'
  // forever — the load effect had no else branch for a null row.
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const isSavingRef = useRef(false)
  const [undoUuid, setUndoUuid] = useState<string | null>(null)
  // Row actions (Ch. 8.3): the item whose context menu is open, and the item
  // whose inline editor is expanded.
  const [menuItemId, setMenuItemId] = useState<number | null>(null)
  const [editingItemId, setEditingItemId] = useState<number | null>(null)

  const applyLoggedMeal = useCallback((value: LoggedMealDetail) => {
    setMeal({
      id: value.id,
      date: value.date,
      slot: value.slot,
      items: value.items.map((item) => ({
        id: item.id,
        name: item.name,
        gramsText: String(item.grams),
        kcalPer100g: item.kcalPer100g,
        proteinPer100g: item.proteinPer100g ?? null,
        fatPer100g: item.fatPer100g ?? null,
        carbPer100g: item.carbPer100g ?? null,
        fiberPer100g: item.fiberPer100g ?? null,
        sugarPer100g: item.sugarPer100g ?? null,
        sodiumPer100Mg: item.sodiumPer100Mg ?? null,
        // F3: the draft macro fields prefill with the row's stored per-100 g
        // values (empty = the log never reported it — the field shows the
        // honest missing-data state, never a fake 0).
        kcalText: item.kcalPer100g != null ? String(item.kcalPer100g) : '',
        proteinText: item.proteinPer100g != null ? String(item.proteinPer100g) : '',
        carbText: item.carbPer100g != null ? String(item.carbPer100g) : '',
        fatText: item.fatPer100g != null ? String(item.fatPer100g) : '',
        visibility: item.visibility ?? null,
        bandHalfPct: item.bandHalfPct ?? null,
      })),
    })
  }, [])

  const reloadMeal = useCallback(async (targetId: number) => {
    const restored = await getLoggedMeal(await db(), targetId)
    if (restored) applyLoggedMeal(restored)
  }, [applyLoggedMeal])

  useEffect(() => {
    if (!mealId) {
      setNotFound(true)
      return
    }
    let alive = true
    void (async () => {
      const value = await getLoggedMeal(await db(), mealId)
      if (!alive) return
      if (!value) {
        setNotFound(true)
        return
      }
      applyLoggedMeal(value)
    })().catch((e) => setError(String(e)))
    return () => {
      alive = false
    }
  }, [mealId, applyLoggedMeal])

  const changeItem = (index: number, key: 'name' | 'gramsText' | 'kcalText' | 'proteinText' | 'carbText' | 'fatText', value: string) => {
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
    if (!isValidLocalDate(meal.date)) {
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
      // F3: a non-empty macro field must be a real, non-negative per-100 g
      // value. "" stays honest (the log never reported it); garbage blocks.
      for (const t of [item.kcalText, item.proteinText, item.carbText, item.fatText]) {
        const v = Number(t.trim())
        if (t.trim() !== '' && (!Number.isFinite(v) || v < 0)) {
          isSavingRef.current = false
          setError(`Macro values must be zero or more for "${item.name.trim() || 'food'}"`)
          return
        }
      }
    }

    setBusy(true)
    setError(null)
    try {
      const detail: LoggedMealDetail = {
        id: meal.id,
        date: meal.date,
        slot: meal.slot,
        items: meal.items.map((item) => {
          // F3: only the macro fields the user actually CHANGED travel as
          // overrides (baseline → text round trip must not mark rows user-
          // edited when nothing was touched). Empty text = keep what the log
          // reported; the per-100 g override IS the snap_* basis, so every
          // total, preview and later gram edit rescales from it end-to-end.
          const overrides: NonNullable<LoggedMealItem['overrides']> = {}
          const kcal = parseMacroOverride(item.kcalText)
          if (kcal !== null && kcal !== item.kcalPer100g) overrides.kcal = kcal
          const protein = parseMacroOverride(item.proteinText)
          if (protein !== null && protein !== item.proteinPer100g) overrides.protein = protein
          const carbs = parseMacroOverride(item.carbText)
          if (carbs !== null && carbs !== item.carbPer100g) overrides.carbs = carbs
          const fat = parseMacroOverride(item.fatText)
          if (fat !== null && fat !== item.fatPer100g) overrides.fat = fat
          return {
            id: item.id,
            name: item.name.trim(),
            grams: Number(item.gramsText),
            kcalPer100g: item.kcalPer100g,
            ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
          }
        }),
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

  const menuItem = meal?.items.find((item) => item.id === menuItemId) ?? null

  /** Row actions: duplicate/remove write through the operation ledger and
   *  confirm with the same Undo-toast pattern every logging path uses. */
  const runItemAction = (kind: 'duplicate' | 'remove', itemId: number) => {
    if (!meal) return
    const target = meal.id
    void (async () => {
      try {
        const uuid =
          kind === 'duplicate'
            ? await duplicateLoggedItem(await db(), target, itemId, Date.now())
            : await removeLoggedItem(await db(), target, itemId, Date.now())
        await reloadMeal(target)
        showToast({
          message: kind === 'duplicate' ? 'Item duplicated.' : 'Item removed.',
          tone: 'success',
          action: {
            label: 'Undo',
            onPress: () => {
              void (async () => {
                await undoOperation(await db(), uuid)
                await reloadMeal(target)
              })()
            },
          },
        })
      } catch (e) {
        showToast({ message: e instanceof Error ? e.message : 'Could not update this item', tone: 'error' })
      }
    })()
  }

  if (!meal) {
    if (notFound && !error) {
      // P3-U1: an honest dead end with a way out, not an eternal spinner.
      return (
        <View style={{ flex: 1, backgroundColor: theme.bg, padding: space.lg, paddingTop: insets.top + space.lg, gap: space.md }}>
          <Text style={[type.title, { color: theme.text }]}>Meal not found</Text>
          <Text style={[type.body, { color: theme.textMuted }]}>
            This meal may have been deleted or the link is out of date.
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={[styles.primaryBtn, { backgroundColor: theme.text }]}>
            <Text style={[type.bodyStrong, { color: theme.bg }]}>Back</Text>
          </Pressable>
        </View>
      )
    }
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: space.lg, paddingTop: insets.top + space.lg }}>
        <Text style={[type.body, { color: error ? theme.safety : theme.textMuted }]}>{error ?? 'Loading meal…'}</Text>
      </View>
    )
  }

  // Task 11-b: the meal totals — each item's snapshot macro at its CURRENT
  // editor grams (snap per-100g × grams / 100), summed across items. A nutrient
  // no item reported sums to null and renders '—'; the calorie caption
  // discloses how many items the total excludes (missing snapshot or grams
  // mid-edit), so a partial total is never presented as the whole meal.
  const totalsGrams = meal.items.map((item) => ({ item, grams: validGramsOf(item.gramsText) }))
  const kcalParts = totalsGrams.map(({ item, grams }) => macroAtGrams(effPer100(item.kcalText, item.kcalPer100g), grams))
  const totalKcal = sumPresent(kcalParts)
  const totalProtein = sumPresent(totalsGrams.map(({ item, grams }) => macroAtGrams(effPer100(item.proteinText, item.proteinPer100g), grams)))
  const totalCarb = sumPresent(totalsGrams.map(({ item, grams }) => macroAtGrams(effPer100(item.carbText, item.carbPer100g), grams)))
  const totalFat = sumPresent(totalsGrams.map(({ item, grams }) => macroAtGrams(effPer100(item.fatText, item.fatPer100g), grams)))
  const totalFiber = sumPresent(totalsGrams.map(({ item, grams }) => macroAtGrams(item.fiberPer100g, grams)))
  const totalSugar = sumPresent(totalsGrams.map(({ item, grams }) => macroAtGrams(item.sugarPer100g, grams)))
  const totalSodium = sumPresent(totalsGrams.map(({ item, grams }) => macroAtGrams(item.sodiumPer100Mg, grams)))
  const totalsMicroLine = [
    totalFiber !== null ? `Fiber ${gramText(totalFiber)}` : null,
    totalSugar !== null ? `Sugar ${gramText(totalSugar)}` : null,
    totalSodium !== null ? `Sodium ${Math.round(totalSodium)}mg` : null,
  ].filter(Boolean).join(' · ')
  const missingKcal = kcalParts.filter((part) => part === null).length

  return (
    // §8.3 (the keyboard must not hide required controls): 'padding' tracks the
    // keyboard on iOS; RN's padding mode does not resize on Android, where
    // 'height' is the mode that does — same component, per-OS behavior.
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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

        <Field label="Date (YYYY-MM-DD)" value={meal.date} onValueChange={(value) => setMeal({ ...meal, date: value })} keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" autoCorrect={false} autoCapitalize="none" />
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

        {/* ITEM ROWS — the row-action pattern (Ch. 8.3): tap a row to expand
            its inline editor, long-press (or the ⋯ affordance) for the
            context menu with edit / duplicate / remove. Swipe is native-only,
            so the visible affordance is the honest web+native pattern. */}
        {meal.items.map((item, index) => {
          const parsedGrams = parseFloat(item.gramsText)
          const validGrams = Number.isFinite(parsedGrams) && parsedGrams > 0 ? parsedGrams : null
          // The preview and the band read the DRAFT per-100 g values, so a
          // hand-corrected macro recomputes the row live (F3 end-to-end).
          const kcalEff = effPer100(item.kcalText, item.kcalPer100g)
          const preview =
            kcalEff === null
              ? 'Calories not reported'
              : validGrams !== null
              ? `${Math.round((kcalEff * validGrams) / 100)} kcal`
              : '— kcal'
          const editing = editingItemId === item.id
          const visibilityCaption = visibilityLabelFor(item.visibility)
          // The band range is around the SAME row preview kcal — snap × grams / 100 —
          // so the badge and the preview never disagree about which number is banded.
          const rowKcal =
            kcalEff !== null && validGrams !== null ? (kcalEff * validGrams) / 100 : null
          const rowBand = rowKcal !== null ? loggedRowBandFor(item.bandHalfPct, rowKcal) : null
          // Task 11-b: the row's macros at its CURRENT grams — snap per-100g ×
          // grams / 100 — so editing grams rescales the preview live (the snaps
          // themselves are per-100g and are never rewritten on save).
          const proteinNow = macroAtGrams(effPer100(item.proteinText, item.proteinPer100g), validGrams)
          const carbNow = macroAtGrams(effPer100(item.carbText, item.carbPer100g), validGrams)
          const fatNow = macroAtGrams(effPer100(item.fatText, item.fatPer100g), validGrams)
          const fiberNow = macroAtGrams(item.fiberPer100g, validGrams)
          const sugarNow = macroAtGrams(item.sugarPer100g, validGrams)
          const sodiumNow = macroAtGrams(item.sodiumPer100Mg, validGrams)
          const hasMacros = proteinNow !== null || carbNow !== null || fatNow !== null
          const macroLine = `P: ${gramText(proteinNow)} · C: ${gramText(carbNow)} · F: ${gramText(fatNow)}`
          // Fiber/sugar/sodium join the compact secondary line only when the
          // log actually reported them — NULL stays silent, never zero.
          const microLine = [
            fiberNow !== null ? `Fiber ${gramText(fiberNow)}` : null,
            sugarNow !== null ? `Sugar ${gramText(sugarNow)}` : null,
            sodiumNow !== null ? `Sodium ${Math.round(sodiumNow)}mg` : null,
          ].filter(Boolean).join(' · ')
          // Spoken summary carries only the nutrients this row really has.
          const macrosSpoken = [
            proteinNow !== null ? `${oneDecimal(proteinNow)} grams protein` : null,
            carbNow !== null ? `${oneDecimal(carbNow)} grams carbs` : null,
            fatNow !== null ? `${oneDecimal(fatNow)} grams fat` : null,
            fiberNow !== null ? `${oneDecimal(fiberNow)} grams fiber` : null,
            sugarNow !== null ? `${oneDecimal(sugarNow)} grams sugar` : null,
            sodiumNow !== null ? `${Math.round(sodiumNow)} milligrams sodium` : null,
          ].filter(Boolean).join(', ')

          return (
            <View key={item.id} style={[styles.card, { borderColor: theme.border }]}>
              <View style={styles.itemRow}>
                <PressableFX
                  accessibilityRole="button"
                  accessibilityLabel={`Item ${item.name}, ${item.gramsText} grams, ${preview}${macrosSpoken ? `, ${macrosSpoken}` : ''}`}
                  accessibilityHint="Tap to edit this item. Long-press for actions."
                  accessibilityState={{ expanded: editing }}
                  onPress={() => {
                    // Table 9.2: expanding a row is a selection.
                    void selectionAsync()
                    setEditingItemId(editing ? null : item.id)
                  }}
                  onLongPress={() => setMenuItemId(item.id)}
                  style={styles.itemSummary}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[type.bodyStrong, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[type.caption, { color: theme.textMuted }]}>{item.gramsText} g · {preview}</Text>
                    {/* Task 11-b: the item's logged macros at its current grams. */}
                    {hasMacros ? (
                      <Text style={[type.caption, { color: theme.textMuted }]}>{macroLine}</Text>
                    ) : null}
                    {microLine ? (
                      <Text style={[type.caption, { color: theme.textFaint }]}>{microLine}</Text>
                    ) : null}
                    {/* Task 5-5 (O6): the row's persisted scan honesty — the
                        basis (how this row earned its place: the model's own
                        visibility claim) and the band around its calories,
                        reconstructed from the persisted half-width by the same
                        bandTier()/rangeFor() the ConfidenceChip uses. Both
                        degrade to nothing on NULL (pre-v12 rows, manual rows):
                        a row that made no claim renders no claim. An inferred
                        row is the one visibility worth violet — the same
                        "invitation, not scold" ruling as the result screen. */}
                    {visibilityCaption ? (
                      <Text
                        style={[
                          type.caption,
                          { color: item.visibility === 'inferred' ? theme.uncertainText : theme.textMuted },
                        ]}
                      >
                        {visibilityCaption}
                      </Text>
                    ) : null}
                    {rowBand && rowKcal !== null ? (
                      <Badge
                        variant="uncertain"
                        size="sm"
                        accessibilityLabel={`Estimated ${Math.round(rowKcal)} kcal, likely between ${Math.round(rowBand.low)} and ${Math.round(rowBand.high)} kcal.`}
                      >
                        <Text style={[type.caption, { color: theme.uncertainText }]}>{TIER_GLYPH[rowBand.tier]}</Text>
                        <Text style={[type.caption, { color: theme.uncertainText }]}>
                          {`${Math.round(rowBand.low)}–${Math.round(rowBand.high)} kcal`}
                        </Text>
                      </Badge>
                    ) : null}
                  </View>
                  <Icon name={editing ? 'chevron' : 'pencil'} size={16} color={theme.textFaint} />
                </PressableFX>
                {/* The visible affordance — same menu as the long-press. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Item actions for ${item.name}`}
                  onPress={() => setMenuItemId(item.id)}
                  hitSlop={space.xs}
                  style={styles.itemMenuBtn}
                >
                  <Icon name="dot3" size={20} color={theme.text} />
                </Pressable>
              </View>
              {editing ? (
                <View style={{ gap: space.sm }}>
                  <Field label="Food" value={item.name} onValueChange={(value) => changeItem(index, 'name', value)} />
                  <Field
                    label="Grams"
                    value={item.gramsText}
                    onValueChange={(value) => changeItem(index, 'gramsText', value)}
                    numeric
                  />
                  {/* F3: hand-corrected macros — per-100 g, THE label basis and
                      literally the snap_* column, so every total and preview
                      rescales live. Empty = the log never reported it (never a
                      fake 0); a filled value overrides the AI's number. */}
                  <View style={styles.macroGrid}>
                    <View style={styles.macroRow}>
                      <Field label="kcal / 100 g" value={item.kcalText} onValueChange={(value) => changeItem(index, 'kcalText', value)} numeric />
                      <Field label="Protein / 100 g" value={item.proteinText} onValueChange={(value) => changeItem(index, 'proteinText', value)} numeric />
                    </View>
                    <View style={styles.macroRow}>
                      <Field label="Carbs / 100 g" value={item.carbText} onValueChange={(value) => changeItem(index, 'carbText', value)} numeric />
                      <Field label="Fat / 100 g" value={item.fatText} onValueChange={(value) => changeItem(index, 'fatText', value)} numeric />
                    </View>
                  </View>
                  <Text style={[type.caption, { color: theme.textMuted }]}>Use “Save changes” to persist edits, or the ⋯ menu for quick actions.</Text>
                </View>
              ) : null}
            </View>
          )
        })}

        {/* Task 11-b: the meal totals — what the user actually logged, at the
            current gram weights, in the ONE per-100g computational basis.
            Nutrients nothing reported stay '—' (never a silent zero); the
            caption discloses what the calorie total excludes. */}
        <Card>
          <Text style={[type.label, { color: theme.textMuted }]}>Meal totals</Text>
          <Text style={[type.title, type.monoData, { color: theme.text }]}>
            {totalKcal !== null ? `${Math.round(totalKcal)} kcal` : 'Calories not reported'}
          </Text>
          <Text style={[type.body, { color: theme.text }]}>
            P: {gramText(totalProtein)} · C: {gramText(totalCarb)} · F: {gramText(totalFat)}
          </Text>
          {totalsMicroLine ? (
            <Text style={[type.caption, { color: theme.textMuted }]}>{totalsMicroLine}</Text>
          ) : null}
          {missingKcal > 0 ? (
            <Text style={[type.caption, { color: theme.textFaint }]}>
              {missingKcal} of {meal.items.length} {missingKcal === 1 ? 'item has' : 'items have'} no calorie data and {missingKcal === 1 ? 'is' : 'are'} not in this total.
            </Text>
          ) : null}
        </Card>

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
                      proteinPer100g: item.proteinPer100g ?? null,
                      fatPer100g: item.fatPer100g ?? null,
                      carbPer100g: item.carbPer100g ?? null,
                      fiberPer100g: item.fiberPer100g ?? null,
                      sugarPer100g: item.sugarPer100g ?? null,
                      sodiumPer100Mg: item.sodiumPer100Mg ?? null,
                      // F3: the undo path prefills the override drafts from the
                      // restored row, same as the initial load does.
                      kcalText: item.kcalPer100g != null ? String(item.kcalPer100g) : '',
                      proteinText: item.proteinPer100g != null ? String(item.proteinPer100g) : '',
                      carbText: item.carbPer100g != null ? String(item.carbPer100g) : '',
                      fatText: item.fatPer100g != null ? String(item.fatPer100g) : '',
                      // Task 5-5: the undo path keeps the persisted honesty on
                      // screen — applyLoggedMeal's mapping, verbatim.
                      visibility: item.visibility ?? null,
                      bandHalfPct: item.bandHalfPct ?? null,
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
            // UI/UX report §10.1 rule two (Wave 1b): deleting a logged meal is
            // the destructive confirmation — kept, via the ONE shared helper.
            confirmDialog({
              title: 'Delete this meal?',
              message: 'You can restore it with Undo.',
              confirmLabel: 'Delete',
              destructive: true,
              onConfirm: () =>
                void (async () => {
                  const op = await deleteMeal(meal.id)
                  if (op) {
                    router.back()
                  }
                })(),
            })
          }
          style={[styles.secondary, { borderColor: theme.safety }]}
        >
          <Text style={[type.label, { color: theme.safety }]}>Delete meal</Text>
        </Pressable>
      </ScrollView>

      {/* The row-action context menu (Sheet primitive) — long-press or the ⋯
          affordance opens it; the sheet closes before the action runs. */}
      <MenuSheet
        open={menuItem != null}
        onClose={() => setMenuItemId(null)}
        title={menuItem?.name}
        sections={
          menuItem
            ? [
                {
                  items: [
                    {
                      key: 'edit',
                      label: 'Edit item',
                      icon: 'pencil',
                      onPress: () => setEditingItemId(menuItem.id),
                    },
                    {
                      key: 'duplicate',
                      label: 'Duplicate item',
                      icon: 'plus',
                      hint: 'Adds the same food with the same grams',
                      onPress: () => runItemAction('duplicate', menuItem.id),
                    },
                    {
                      key: 'remove',
                      label: 'Remove item',
                      icon: 'close',
                      destructive: true,
                      onPress: () => runItemAction('remove', menuItem.id),
                    },
                  ],
                },
              ]
            : []
        }
      />
    </KeyboardAvoidingView>
  )
}

// ---------------------------------------------------------------------------
// Task 11-b macro display helpers — pure arithmetic over the per-100g snapshot
// columns (the ONE computational basis). NaN never escapes: mid-edit gram text
// ("", "1.") parses to null and renders '—', never a broken number (§8.3).
// ---------------------------------------------------------------------------

/** The editor's gram text as a usable weight, or null while it doesn't parse. */
function validGramsOf(gramsText: string): number | null {
  const parsed = parseFloat(gramsText)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** F3: the value a macro field effectively shows — the user's draft override when
 *  it parses, otherwise the loaded per-100 g baseline. ONE definition so the
 *  totals, the row preview and the spoken summary can never disagree. */
function effPer100(text: string, baseline: number | null): number | null {
  return parseMacroOverride(text) ?? baseline
}

/** F3: a per-100 g override draft → number, or null when the field is empty or
 *  not a usable number (save validation blocks garbage; this only renders). */
function parseMacroOverride(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** A snapshot macro at `grams`, or null when the row reported nothing (or grams are mid-edit). */
function macroAtGrams(per100g: number | null, grams: number | null): number | null {
  if (per100g === null || grams === null) return null
  const value = (per100g * grams) / 100
  return Number.isFinite(value) ? value : null
}

/** Sum of the values that exist — stays null when NOTHING was reported, never a silent zero. */
function sumPresent(values: Array<number | null>): number | null {
  let total: number | null = null
  for (const value of values) {
    if (value === null) continue
    total = (total ?? 0) + value
  }
  return total
}

/** One-decimal gram figure — the food-review footer convention ('—' when unreported). */
function gramText(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 10) / 10}g`
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}


const styles = StyleSheet.create({
  primaryBtn: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  // F3: the per-100 g macro override grid — two rows of two compact fields.
  macroGrid: { gap: 8, marginTop: 4 },
  macroRow: { flexDirection: 'row', gap: 8 },
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
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  itemSummary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TAP_TARGET,
    paddingVertical: space.xs,
  },
  itemMenuBtn: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: MIN_TAP_TARGET,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    // Wave 1a: 17px ad-hoc input joins type.body (Table 3.1).
    fontSize: type.body.fontSize,
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
