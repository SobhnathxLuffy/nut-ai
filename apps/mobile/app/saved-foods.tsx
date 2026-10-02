import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { IngredientRow } from '@nutai/core-schema'
import { db } from '../src/data/repo'
import { encodeFoodReview } from '../src/data/food-review'
import { localDate } from '../src/data/date-utils'
import type { ManualFoodSelection } from '../src/data/manual-food'
import { Button } from '../src/components/Screen'
import { Empty } from '../src/components/Empty'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'

/**
 * Saved meals.
 *
 * A saved meal stores the CORRECTED ingredient array, not a food name to
 * re-analyze. That is what makes relogging free: zero network requests, zero
 * clarifying questions, and identical numbers to the day you fixed them.
 */
interface SavedMeal {
  id: number
  name: string
  use_count: number
  items_json: string
}

/**
 * Map a stored, corrected ingredient row onto the manual-log selection shape.
 * The matched_food_source ternary mirrors logMeal's mapping in repo.ts so a
 * relogged row carries the same provenance class as the original scan.
 */
function toSelection(row: IngredientRow): ManualFoodSelection {
  return {
    foodId: row.sourceFoodId == null ? null : Number(row.sourceFoodId),
    matchedFoodSource: row.origin === 'web_lookup' ? 'web' : row.sourceFoodId != null ? 'corpus' : 'estimate',
    displayName: row.displayName,
    grams: row.grams,
    gramPathway: row.gramPathway,
    portionSource: row.origin,
    nutrientSnapshot: row.nutrientSnapshot,
  }
}
/** Minimal shape guard so one corrupt row surfaces a message, not a crash. */
function parseSavedItems(itemsJson: string): IngredientRow[] {
  const rows: unknown = JSON.parse(itemsJson)
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    rows.some(r => typeof r !== 'object' || r === null || typeof (r as IngredientRow).displayName !== 'string' || typeof (r as IngredientRow).grams !== 'number')
  ) {
    throw new Error('not items')
  }
  return rows as IngredientRow[]
}

/**
 * Fold multi-row totals into the per-100 g snapshot the review payload's base
 * selection carries (same basis as app/assistant.tsx's meal proposals).
 */
function per100For(selections: ManualFoodSelection[], totalGrams: number): ManualFoodSelection['nutrientSnapshot'] {
  const total = (field: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g') =>
    selections.reduce((sum, s) => sum + ((s.nutrientSnapshot[field] ?? 0) * s.grams) / 100, 0)
  const per100 = (v: number) => Math.round((v * 100) / totalGrams * 10) / 10
  return {
    kcal: per100(total('kcal')),
    protein_g: per100(total('protein_g')),
    carbs_g: per100(total('carbs_g')),
    fat_g: per100(total('fat_g')),
    fiber_g: null,
    sugar_g: null,
    sodium_mg: null,
  }
}

export default function SavedFoods() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [meals, setMeals] = useState<SavedMeal[]>([])
  const [error, setError] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        const h = await db()
        const rows = await h.all<SavedMeal>(
          'SELECT id, name, use_count, items_json FROM saved_meals ORDER BY use_count DESC, last_used_at DESC',
        )
        if (alive) setMeals(rows)
      })()
      return () => { alive = false }
    }, []),
  )

  /**
   * UI/UX report §8.3 / Table 11.1 (Wave 1b): the "Log again" control is now a
   * WORKING primary button. It opens the stored, corrected rows in /food-review
   * — the same surface recipes, the dish composer, custom foods and the
   * assistant log through (mirrors those screens' payload contract: the rows
   * travel as `selections`, scaled when the total weight is edited on the
   * review screen, and the write itself is the same logManualMealWithItems
   * call the old direct-log path used).
   *
   * use_count/last_used_at bump on press: they feed the sort order and the
   * "Logged N times" caption, not a save claim — the actual write (and its
   * Undo toast) happens on the review screen's Save.
   */
  const logAgain = useCallback(async (meal: SavedMeal) => {
    setError(null)
    try {
      const rows = parseSavedItems(meal.items_json)
      const selections = rows.map(toSelection)
      const totalGrams = selections.reduce((sum, s) => sum + s.grams, 0)
      if (!Number.isFinite(totalGrams) || totalGrams <= 0) throw new Error('not items')
      // Single-row meals keep the row itself as the base selection so the
      // review screen writes it with its original food id and provenance —
      // byte-identical to the old direct-log write. Multi-row meals get the
      // assistant-proposal composite (totals folded to a per-100 g snapshot,
      // see app/assistant.tsx resolveMealProposal).
      const base: ManualFoodSelection =
        selections.length === 1
          ? selections[0]!
          : {
              foodId: null,
              matchedFoodSource: 'ingredient_decomposition',
              displayName: meal.name,
              grams: totalGrams,
              gramPathway: 'decomposed_recipe',
              portionSource: 'user_decomposition',
              nutrientSnapshot: per100For(selections, totalGrams),
            }
      const h = await db()
      await h.run(
        'UPDATE saved_meals SET use_count = use_count + 1, last_used_at = ? WHERE id = ?',
        [Date.now(), meal.id],
      )
      setMeals(prev => prev.map(x => (x.id === meal.id ? { ...x, use_count: x.use_count + 1 } : x)))
      router.push({
        pathname: '/food-review',
        params: { payload: encodeFoodReview({ selection: base, selections, date: localDate(Date.now()) }) },
      } as never)
    } catch {
      setError('This saved meal could not be opened — its data may be damaged.')
    }
  }, [])

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Saved foods</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Done</Text>
        </Pressable>
      </View>

      {error ? (
        <Text style={[type.caption, { color: theme.safety, paddingHorizontal: space.lg, marginTop: space.sm }]}>
          {error}
        </Text>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        {meals.length === 0 ? (
          // UI/UX report Ch. 6.3 / Table 10.1 (Wave 1c): the empty-list state is
          // the Empty primitive — icon, explanation, and the create-first
          // action (log a food; saving it from the timeline is how this list
          // fills).
          <Empty
            icon="bookmark"
            title="Nothing saved yet"
            message="After you correct a scan, save it. Relogging it later costs nothing — no scan, no network request, and none of the questions you already answered."
            action={{ label: 'Log food', onPress: () => router.push('/food-search' as never) }}
          />
        ) : (
          meals.map((m) => (
            <View key={m.id} style={[styles.row, { backgroundColor: theme.bgSunken }]}>
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>{m.name}</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  Logged {m.use_count} {m.use_count === 1 ? 'time' : 'times'}
                </Text>
              </View>
              <Button label="Log again" selected onPress={() => void logAgain(m)} />
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, borderRadius: radius.lg, marginBottom: space.sm,
  },
})
