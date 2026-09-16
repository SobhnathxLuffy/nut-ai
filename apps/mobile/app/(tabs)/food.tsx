import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Screen, Button, Card, Label, Row, useAction } from '../../src/components/Screen'
import { DayTimeline } from '../../src/components/DayTimeline'
import { subscribeFoodMutations } from '../../src/data/food-mutations'
import { db, localDate } from '../../src/data/repo'
import {
  listShortcuts,
  recentFoods,
  repeatSnapshots,
  mealSnapshot,
  removeShortcut,
  type Shortcut,
  type RecentFood,
  type MealSnapshot,
} from '../../src/data/shortcuts'

type ShortcutMode = 'Recent' | 'Frequent' | 'Favorites' | 'Usual' | 'Saved'

const SHORTCUT_MODES: ShortcutMode[] = ['Recent', 'Frequent', 'Favorites', 'Usual', 'Saved']

/**
 * Food tab — shortcuts, repeat logging, and the daily food timeline.
 */
export default function Food() {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([])
  const [recent, setRecent] = useState<RecentFood[]>([])
  const [mode, setMode] = useState<ShortcutMode>('Recent')

  const refresh = useCallback(async () => {
    const h = await db()
    setShortcuts(await listShortcuts(h))
    setRecent(await recentFoods(h, Date.now()))
  }, [])

  const action = useAction(refresh)

  useFocusEffect(
    useCallback(() => {
      void action.run(refresh)
    }, [refresh]),
  )
  useEffect(() => subscribeFoodMutations(() => { void refresh() }), [refresh])

  return (
    <Screen title="Food">
      {/* Quick action buttons */}
      <Row>
        <Button label="Search everything" onPress={() => router.push({ pathname: '/food-search', params: { date: localDate(Date.now()) } } as never)} />
        <Button label="Scan food" onPress={() => router.push('/camera')} />
        <Button label="Recipes" onPress={() => router.push({ pathname: '/recipes', params: { date: localDate(Date.now()) } } as never)} />
        <Button label="Custom food" onPress={() => router.push({ pathname: '/custom-food', params: { date: localDate(Date.now()) } } as never)} />
      </Row>

      {/* Shortcut mode selector */}
      <Row>
        {SHORTCUT_MODES.map((v) => (
          <Button
            key={v}
            label={v}
            selected={mode === v}
            onPress={() => setMode(v)}
          />
        ))}
      </Row>

      {action.feedback}

      {/* Shortcut content based on selected mode */}
      {mode === 'Recent' || mode === 'Frequent' ? (
        <RecentFoodList
          foods={mode === 'Frequent'
            ? [...recent].sort((a, b) => b.frequency - a.frequency)
            : recent}
          action={action}
        />
      ) : (
        <ShortcutList
          shortcuts={shortcuts.filter((s) =>
            s.kind === (mode === 'Favorites' ? 'favorite' : mode === 'Usual' ? 'usual' : 'saved'),
          )}
          action={action}
        />
      )}

      <DayTimeline food />
    </Screen>
  )
}

/** List of recently/frequently logged foods with repeat action. */
function RecentFoodList({
  foods,
  action,
}: {
  foods: RecentFood[]
  action: ReturnType<typeof useAction>
}) {
  return (
    <>
      {foods.slice(0, 8).map((r) => (
        <Card key={`${r.id}:${r.name}`}>
          <Label>{r.name} · {r.frequency} logs</Label>
          <Button
            label="Repeat today"
            onPress={() => {
              void action.run(async () => {
                const h = await db()
                const snap = await mealSnapshot(h, r.id)
                await repeatSnapshots(h, [snap], localDate(Date.now()))
              })
            }}
          />
        </Card>
      ))}
    </>
  )
}

/** List of saved/favorite/usual shortcuts with log and remove actions. */
function ShortcutList({
  shortcuts,
  action,
}: {
  shortcuts: Shortcut[]
  action: ReturnType<typeof useAction>
}) {
  return (
    <>
      {shortcuts.map((s) => (
        <Card key={s.id}>
          <Label>{s.name}</Label>
          <Row>
            <Button
              label="Log today"
              onPress={() => {
                void action.run(async () => {
                  const h = await db()
                  const snap = JSON.parse(s.snapshot_json) as MealSnapshot
                  await repeatSnapshots(h, [snap], localDate(Date.now()))
                })
              }}
            />
            <Button
              label="Remove shortcut"
              onPress={() => {
                void action.run(async () => removeShortcut(await db(), s.id))
              }}
            />
          </Row>
        </Card>
      ))}
    </>
  )
}
