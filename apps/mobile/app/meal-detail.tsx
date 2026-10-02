import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { undoOperation } from '@nutai/db-adapter'
import { db, deleteMeal } from '../src/data/repo'
import { isValidLocalDate } from '../src/data/date-utils'
import {
  duplicateLoggedItem,
  getLoggedMeal,
  removeLoggedItem,
  updateLoggedMeal,
  type LoggedMealDetail,
} from '../src/data/logged-meals'
import { useTheme } from '../src/theme/ThemeProvider'
import { Field } from '../src/components/Field'
import { Icon } from '../src/components/Icon'
import { PressableFX } from '../src/components/PressableFX'
import { MenuSheet } from '../src/components/Sheet'
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
          const preview =
            item.kcalPer100g === null
              ? 'Calories not reported'
              : validGrams !== null
              ? `${Math.round((item.kcalPer100g * validGrams) / 100)} kcal`
              : '— kcal'
          const editing = editingItemId === item.id

          return (
            <View key={item.id} style={[styles.card, { borderColor: theme.border }]}>
              <View style={styles.itemRow}>
                <PressableFX
                  accessibilityRole="button"
                  accessibilityLabel={`Item ${item.name}, ${item.gramsText} grams, ${preview}`}
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
                  <Text style={[type.caption, { color: theme.textMuted }]}>Use “Save changes” to persist edits, or the ⋯ menu for quick actions.</Text>
                </View>
              ) : null}
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


const styles = StyleSheet.create({
  primaryBtn: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
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
