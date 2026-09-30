import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { IngredientRow } from '@nutai/core-schema'
import { db } from '../src/data/repo'
import { logManualMealWithItems, type ManualFoodSelection } from '../src/data/manual-food'
import { localDate, slotFor } from '../src/data/date-utils'
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

export default function SavedFoods() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [meals, setMeals] = useState<SavedMeal[]>([])
  const [loggingId, setLoggingId] = useState<number | null>(null)
  const [loggedIds, setLoggedIds] = useState<number[]>([])
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

  /** One-tap relog: writes the stored corrected array to today, zero network. */
  const logAgain = useCallback(async (meal: SavedMeal) => {
    if (loggingId !== null) return
    setLoggingId(meal.id)
    setError(null)
    try {
      const rows = parseSavedItems(meal.items_json)
      const h = await db()
      await logManualMealWithItems(h, rows.map(toSelection), Date.now(), {
        localDate: localDate(Date.now()),
        mealSlot: slotFor(Date.now()),
      })
      await h.run(
        'UPDATE saved_meals SET use_count = use_count + 1, last_used_at = ? WHERE id = ?',
        [Date.now(), meal.id],
      )
      setMeals(prev => prev.map(x => (x.id === meal.id ? { ...x, use_count: x.use_count + 1 } : x)))
      setLoggedIds(prev => (prev.includes(meal.id) ? prev : [...prev, meal.id]))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not log this food — tap to try again.')
    } finally {
      setLoggingId(null)
    }
  }, [loggingId])

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
          <View style={[styles.empty, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>Nothing saved yet</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              After you correct a scan, save it. Relogging it later costs nothing — no scan, no
              network request, and none of the questions you already answered.
            </Text>
          </View>
        ) : (
          meals.map((m) => {
            const logged = loggedIds.includes(m.id)
            const busy = loggingId === m.id
            return (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={`Log again: ${m.name}`}
                accessibilityState={{ disabled: busy || logged, busy }}
                disabled={busy}
                onPress={() => void logAgain(m)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.bgSunken, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodyStrong, { color: theme.text }]}>{m.name}</Text>
                  <Text style={[type.caption, { color: theme.textMuted }]}>
                    Logged {m.use_count} {m.use_count === 1 ? 'time' : 'times'}
                  </Text>
                </View>
                <Text style={[type.label, { color: logged ? theme.affirm : theme.protein }]}>
                  {busy ? 'Logging…' : logged ? 'Logged today' : 'Log again'}
                </Text>
              </Pressable>
            )
          })
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
  empty: { padding: space.lg, borderRadius: radius.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, borderRadius: radius.lg, marginBottom: space.sm,
  },
})
