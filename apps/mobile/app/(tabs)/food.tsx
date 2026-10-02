import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Screen, Button, Card, Label, useAction } from '../../src/components/Screen'
import { ChipRow } from '../../src/components/ChipRow'
import { Icon, type IconName } from '../../src/components/Icon'
import { PressableFX } from '../../src/components/PressableFX'
import { MenuSheet, type MenuSection } from '../../src/components/Sheet'
import { SkeletonRow } from '../../src/components/Skeleton'
import { showToast } from '../../src/components/toast-store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../../src/theme/tokens'
import { db, localDate, undoLastOperation } from '../../src/data/repo'
import { subscribeFoodMutations } from '../../src/data/food-mutations'
import { listShortcuts, removeShortcut, copyYesterday, type Shortcut } from '../../src/data/shortcuts'
import {
  oneTapCardFromRecentFood,
  oneTapCardFromShortcut,
  oneTapLog,
  recentFoodsWithGrams,
  type OneTapCard,
  type OneTapSource,
} from '../../src/data/one-tap-log'
// UI/UX report Table 9.2 (Wave 1c): "Log meal → Success (notification)" — the
// core reward moment fires with the one-tap log, never instead of the toast.
import { selectionAsync, success as hapticSuccess } from '../../src/utils/haptics'

type ShortcutMode = 'Recent' | 'Frequent' | 'Favorites' | 'Usual' | 'Saved'

const SHORTCUT_MODES: ShortcutMode[] = ['Recent', 'Frequent', 'Favorites', 'Usual', 'Saved']

/**
 * Food tab — THE WRITE SURFACE (UI/UX report §7.1 / Ch. 8.3, Wave 3).
 *
 * Home reads the day; Food writes it. The read-surface component's second
 * mount here is gone entirely (the duplication §7.1 exists to kill): every
 * timeline affordance stays reachable through write-surface actions —
 *   Log food            → the large primary entry
 *   Repeat meal         → the one-tap logging cards
 *   Copy yesterday      → a quick action with its Undo toast
 *   Save/Remove shortcut→ the cards' long-press menu + Home's timeline
 *   Delete meal         → meal-detail (tap any meal on Home)
 * A repeat log is a SINGLE TAP through the repo's one repeat path
 * (`repeatSnapshots` — immutable snapshots, provenance, Undo), with the slot
 * re-derived from the tap time exactly like a fresh log.
 */
export default function Food() {
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof recentFoodsWithGrams>>>([])
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([])
  const [mode, setMode] = useState<ShortcutMode>('Recent')
  const [loaded, setLoaded] = useState(false)
  const [menuCard, setMenuCard] = useState<OneTapCard | null>(null)
  const isLoggingRef = useRef(false)

  const refresh = useCallback(async () => {
    const h = await db()
    setRecent(await recentFoodsWithGrams(h, Date.now()))
    setShortcuts(await listShortcuts(h))
    setLoaded(true)
  }, [])

  const action = useAction(refresh)

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )
  useEffect(() => subscribeFoodMutations(() => { void refresh() }), [refresh])

  const cards = cardsForMode(mode, recent, shortcuts)

  /** ONE TAP = one logged meal: repeat path + success haptic + Undo toast. */
  const logCard = (card: OneTapCard) => {
    if (isLoggingRef.current) return
    isLoggingRef.current = true
    void (async () => {
      try {
        await oneTapLog(await db(), card, Date.now())
        void hapticSuccess()
        // §10.1 (Wave 1b): every logging path confirms with the same Undo
        // toast; undoLastOperation emits the food-mutation event that
        // refreshes Home's timeline and this strip.
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
        await refresh()
      } catch (e) {
        showToast({ message: e instanceof Error ? e.message : 'Could not log this meal', tone: 'error' })
      } finally {
        isLoggingRef.current = false
      }
    })()
  }

  const removeCardShortcut = (card: OneTapCard) => {
    const shortcut = shortcuts.find((s) => `shortcut-${s.id}` === card.key)
    if (!shortcut) return
    void action.run(async () => removeShortcut(await db(), shortcut.id))
  }

  const menuSections = (card: OneTapCard): MenuSection[] => [
    {
      caption: card.name,
      items: [
        {
          key: 'log',
          label: 'Log now',
          icon: 'plus' as IconName,
          onPress: () => logCard(card),
        },
        ...(card.mealId != null || card.source === 'favorite' || card.source === 'usual' || card.source === 'saved'
          ? [{
              key: 'open',
              label: 'Open meal',
              icon: 'chevron' as IconName,
              onPress: () => {
                const mealId =
                  card.mealId ??
                  shortcuts.find((s) => `shortcut-${s.id}` === card.key)?.meal_id
                if (mealId != null) router.push({ pathname: '/meal-detail', params: { id: mealId } } as never)
              },
            }]
          : []),
        ...(card.snapshot != null
          ? [{
              key: 'remove',
              label: 'Remove shortcut',
              icon: 'close' as IconName,
              destructive: true,
              onPress: () => removeCardShortcut(card),
            }]
          : []),
      ],
    },
  ]

  return (
    <Screen title="Food">
      {/* §7.1: "a large 'Log food' entry" — the primary write action, full-width. */}
      <Button
        label="Log food"
        icon="search"
        size="lg"
        selected
        onPress={() => router.push({ pathname: '/food-search', params: { date: localDate(Date.now()) } } as never)}
      />
      <Label muted>Search every database — IFCT, USDA, the dish library, your own foods.</Label>

      {/* Quick actions — the icon grid (Ch. 7 / Ch. 8.3). Distinct glyphs per
          Table 6.1; each tile is a 44pt+ target with press feedback. */}
      <Label>Quick actions</Label>
      <View style={styles.grid}>
        {QUICK_ACTIONS.map((qa) => (
          <QuickActionTile key={qa.label} label={qa.label} icon={qa.icon} onPress={qa.onPress} />
        ))}
      </View>

      {/* The shortcut strip — one-tap logging cards (Ch. 8.3): each shows the
          meal, its last gram preset, and a plus; a repeat log is a single tap. */}
      <Label>One-tap logging</Label>
      <ChipRow
        items={SHORTCUT_MODES}
        keyOf={(v) => v}
        label={(v) => v}
        a11yLabel={(v) => `${v} foods`}
        isActive={(v) => mode === v}
        onPress={(v) => {
          if (v === mode) return
          // Table 9.2: chip toggle → selection haptic, only on a change.
          void selectionAsync()
          setMode(v)
        }}
      />

      {action.feedback}

      {!loaded ? (
        <View style={{ gap: space.md }}>
          <SkeletonRow lines={2} />
          <SkeletonRow lines={2} />
          <SkeletonRow lines={2} />
        </View>
      ) : cards.length === 0 ? (
        <Card>
          <Label>{mode === 'Recent' || mode === 'Frequent'
            ? 'Nothing here yet — log a few foods and they will appear.'
            : 'Nothing here yet — save a favorite or usual meal and it will appear.'}</Label>
          <Label muted>Tap the plus on a card once meals exist — one tap logs the meal with its usual grams.</Label>
        </Card>
      ) : (
        cards.map((card) => <OneTapCardRow key={card.key} card={card} onLog={() => logCard(card)} onMenu={() => setMenuCard(card)} />)
      )}

      <MenuSheet
        open={menuCard != null}
        onClose={() => setMenuCard(null)}
        title={menuCard?.name}
        sections={menuCard ? menuSections(menuCard) : []}
      />
    </Screen>
  )
}

/** The quick-action tiles — distinct glyphs (Table 6.1), destinations EXACTLY the old grid's plus the timeline's Copy yesterday. */
const QUICK_ACTIONS: ReadonlyArray<{ label: string; icon: IconName; onPress: () => void }> = [
  {
    label: 'Scan food',
    icon: 'scan',
    onPress: () => router.push('/camera'),
  },
  {
    label: 'Indian dishes',
    icon: 'lotus',
    onPress: () => router.push({ pathname: '/indian-dishes', params: { date: localDate(Date.now()) } } as never),
  },
  {
    label: 'Recipes',
    icon: 'bookOpen',
    onPress: () => router.push({ pathname: '/recipes', params: { date: localDate(Date.now()) } } as never),
  },
  {
    label: 'Custom food',
    icon: 'pencil',
    onPress: () => router.push({ pathname: '/custom-food', params: { date: localDate(Date.now()) } } as never),
  },
  {
    label: 'Saved meals',
    icon: 'bookmark',
    onPress: () => router.push({ pathname: '/saved-foods', params: { date: localDate(Date.now()) } } as never),
  },
  {
    label: 'Copy yesterday',
    icon: 'clock',
    onPress: () => {
      void (async () => {
        try {
          await copyYesterday(await db(), localDate(Date.now()))
          // The timeline's optimistic pattern (§10.2): one tap + Undo toast.
          showToast({
            message: "Yesterday's meals were added to today.",
            tone: 'success',
            action: {
              label: 'Undo',
              onPress: () => {
                void undoLastOperation().then((r) => {
                  if (!r.success) showToast({ message: 'Could not undo the copy.', tone: 'error' })
                })
              },
            },
          })
        } catch (e) {
          showToast({ message: e instanceof Error ? e.message : 'Could not copy yesterday', tone: 'error' })
        }
      })()
    },
  },
]

/** Derive the one-tap cards for a strip mode — pure per render, no writes. */
function cardsForMode(
  mode: ShortcutMode,
  recent: Awaited<ReturnType<typeof recentFoodsWithGrams>>,
  shortcuts: Shortcut[],
): OneTapCard[] {
  if (mode === 'Recent' || mode === 'Frequent') {
    const ordered =
      mode === 'Frequent'
        ? [...recent].sort((a, b) => b.frequency - a.frequency || b.last_used_at - a.last_used_at)
        : recent
    return ordered.map((r) => oneTapCardFromRecentFood(r, mode === 'Frequent' ? 'frequent' : 'recent'))
  }
  const kind: OneTapSource = mode === 'Favorites' ? 'favorite' : mode === 'Usual' ? 'usual' : 'saved'
  return shortcuts
    .filter((s) => s.kind === kind)
    .map(oneTapCardFromShortcut)
    .filter((c): c is OneTapCard => c != null)
}

/**
 * One one-tap card: meal name, its last gram preset, and the plus. Whole row
 * is the tap target (min 56pt); long-press opens the row-action menu.
 */
function OneTapCardRow({
  card,
  onLog,
  onMenu,
}: {
  card: OneTapCard
  onLog: () => void
  onMenu: () => void
}) {
  const theme = useTheme()
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={`Log ${card.name}, ${Math.round(card.presetGrams)} grams, one tap`}
      accessibilityHint="Logs the meal immediately with its usual grams. Long-press for more actions."
      onPress={onLog}
      onLongPress={onMenu}
      style={[styles.card, { borderColor: theme.border, backgroundColor: theme.bgElevated }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.bodyStrong, { color: theme.text }]} numberOfLines={1}>{card.name}</Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {/* monoData (§8.2): tabular figures so the presets don't jitter as the strip updates. */}
          <Text style={type.monoData}>{Math.round(card.presetGrams)}</Text> g preset
          {card.frequency != null
            ? ` · ${card.frequency} ${card.frequency === 1 ? 'log' : 'logs'} in 30 days`
            : ` · ${card.source} meal`}
        </Text>
      </View>
      {/* The plus — the one-tap affordance (Table 6.1 "Log a meal → plus-circle"), 44pt target. */}
      <View style={[styles.plus, { borderColor: theme.border, backgroundColor: theme.bgSunken }]}>
        <Icon name="plus" size={20} color={theme.text} weight={2.2} />
      </View>
    </PressableFX>
  )
}

/** One quick-action tile — icon + label, theme-resolved at render time. */
function QuickActionTile({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  const theme = useTheme()
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.tile, { borderColor: theme.border, backgroundColor: theme.bgElevated }]}
    >
      <Icon name={icon} size={24} color={theme.text} />
      <Text style={[type.caption, { color: theme.text, marginTop: space.xs }]}>{label}</Text>
    </PressableFX>
  )
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  tile: {
    width: '31%',
    flexGrow: 1,
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  plus: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
})
