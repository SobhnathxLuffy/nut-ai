import { Tabs, router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Animated, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../../src/components/Icon'
import { PressableFX, useReducedMotion } from '../../src/components/PressableFX'
import { useTheme } from '../../src/theme/ThemeProvider'
import {
  MIN_TAP_TARGET,
  elevationStyle,
  motion,
  radius,
  space,
  type,
} from '../../src/theme/tokens'
import { ActiveWorkoutCard } from '../../src/components/ActiveWorkout'
// UI/UX report Table 9.2: "Tab change → Selection". The haptics wrapper is a
// no-op on web and respects the settings toggle everywhere else.
import { selectionAsync } from '../../src/utils/haptics'

/**
 * Five tabs, the global FAB, and its bottom sheet.
 *
 * Product rationale (groups decision, always-usable FAB, IAP posture) lives in
 * docs/product/fab-actions.md — P3-U14: not in code.
 *
 * UI/UX report Ch. 7 / Table 7.1 (Wave 2):
 *   - Tab bar: 12pt labels (type.caption, the AA-fixed floor), the active tab
 *     marked by an accent-tinted pill that MORPHS between tabs over 240ms
 *     (motion.base) — one Animated value interpolating the pill's frame, not a
 *     flat background swap — plus the Table 9.2 selection haptic on switch.
 *   - FAB: on ALL five tabs (was food-only), opening a true bottom sheet
 *     (spring translateY, radius.sheet 20, tap-outside + swipe-down dismiss)
 *     instead of the fullscreen tile grid. The scan action is the sheet's
 *     primary row. Sheet open/close fires NO haptic — Table 9.2: "motion
 *     carries it; avoid noise".
 *
 * P3-U14: every action in the sheet has a DISTINCT icon; no two rows may
 * share one. Table 6.1 mappings: scan (hero), dumbbell, bookmark, bookOpen
 * (recipes), search (food database), sparkles (AI assistant).
 */

const TABS: ReadonlyArray<{ name: string; label: string; icon: IconName }> = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'food', label: 'Food', icon: 'bowl' },
  { name: 'train', label: 'Train', icon: 'dumbbell' },
  { name: 'progress', label: 'Progress', icon: 'chart' },
  { name: 'profile', label: 'You', icon: 'person' },
]

interface Action {
  label: string
  icon: IconName
  route: string
  /** The promoted primary row (Table 7.1: "scan promoted"). */
  hero?: boolean
  hint?: string
}

/** Routes are EXACTLY the old action grid's — this rebuild changes the vessel, not the destinations. */
const ACTIONS: Action[] = [
  { label: 'Scan food', icon: 'scan', route: '/camera', hero: true, hint: 'Point your camera at any meal' },
  { label: 'Log exercise', icon: 'dumbbell', route: '/log-exercise' },
  { label: 'Saved foods', icon: 'bookmark', route: '/saved-foods' },
  { label: 'Recipes', icon: 'bookOpen', route: '/recipes' },
  { label: 'Food database', icon: 'search', route: '/food-search' },
  { label: 'AI Assistant', icon: 'sparkles', route: '/assistant' },
]

export default function TabLayout() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: theme.bg },
          // P2-11: inactive tab screens stayed fully rendered on web and leaked
          // their entire text into the accessibility tree / text dumps (welcome
          // screen behind the onboarding gate, Home behind Food). Freezing
          // unmounts the hidden subtree while keeping each tab's state.
          freezeOnBlur: true,
        }}
        tabBar={({ state, navigation }) => (
          <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
            <TabBarPill state={state.index} onNavigate={(name, focused) => {
              // Table 9.2: the selection haptic lands on a CHANGE, never on a
              // re-tap of the already-active tab.
              if (!focused) void selectionAsync()
              navigation.navigate(name)
            }} />
            {/* Table 7.1: the FAB is the global create action — all tabs, not
                just Food. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add"
              onPress={() => setSheetOpen(true)}
              style={[styles.fab, { backgroundColor: theme.text }]}
            >
              <Icon name="plus" size={26} color={theme.bg} weight={2.2} />
            </Pressable>
          </View>
        )}
      >
        {TABS.map((t) => (
          <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
        ))}
      </Tabs>
      <ActiveWorkoutCard />

      <FabSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onAction={(route) => {
          setSheetOpen(false)
          router.push(route as never)
        }}
      />
    </>
  )
}

/**
 * The pill tab bar (report Ch. 7 / Table 7.1). The accent pill is one
 * Animated.View whose LEFT and WIDTH interpolate between the measured tab
 * frames — the 240ms morph — and whose fill is the §4.3 selected tint (the
 * app's accent stand-in until Wave 4 lands a real accent slot). Reduce motion
 * snaps the pill instantly; labels stay at the 12.5px caption floor.
 */
function TabBarPill({
  state,
  onNavigate,
}: {
  state: number
  onNavigate: (name: string, focused: boolean) => void
}) {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const [frames, setFrames] = useState<Array<{ x: number; width: number } | null>>(() =>
    TABS.map(() => null),
  )
  const pillIndex = useRef(new Animated.Value(state)).current

  useEffect(() => {
    if (reduced) {
      pillIndex.setValue(state)
      return
    }
    Animated.timing(pillIndex, {
      toValue: state,
      // Table 7.1: "accent pill morph 240ms" — motion.base.
      duration: motion.base,
      useNativeDriver: false,
    }).start()
  }, [state, reduced, pillIndex])

  const measured = frames.every((f) => f != null)
  const input = TABS.map((_, i) => i)
  const pillLeft = measured
    ? pillIndex.interpolate({ inputRange: input, outputRange: frames.map((f) => f!.x) })
    : null
  const pillWidth = measured
    ? pillIndex.interpolate({ inputRange: input, outputRange: frames.map((f) => f!.width) })
    : null

  return (
    <View style={[styles.pill, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
      <View style={styles.pillInner}>
        {measured && pillLeft != null && pillWidth != null ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              height: '100%',
              borderRadius: radius.pill,
              // Wave 4 (report §3.2): the pill fill re-points to the accent
              // tint slot — the same 12% ink/white dialect the stateLayer
              // selected wash resolved to. Zero visual change.
              backgroundColor: theme.accentTint,
              left: pillLeft,
              width: pillWidth,
            }}
          />
        ) : null}
        {TABS.map((tab, index) => {
          const focused = index === state
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              onPress={() => onNavigate(tab.name, focused)}
              onLayout={(event) => {
                const { x, width } = event.nativeEvent.layout
                setFrames((prev) => {
                  if (prev[index]?.x === x && prev[index]?.width === width) return prev
                  const next = [...prev]
                  next[index] = { x, width }
                  return next
                })
              }}
              style={[styles.tab, !measured && focused && { backgroundColor: theme.bgSunken }]}
              hitSlop={space.sm}
            >
              <Icon name={tab.icon} size={21} color={focused ? theme.text : theme.textFaint} />
              <Text style={[type.caption, { color: focused ? theme.text : theme.textFaint, marginTop: 1 }]}>
                {tab.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** Sheet fully off-screen start/exit offset (well past the tallest content). */
const SHEET_HIDDEN = 480
/** Drag travel that commits a swipe-down dismiss. */
const SHEET_DISMISS_DY = 96
/** Travel that makes a gesture a DRAG, not a tap (row press suppression). */
const SHEET_DRAG_SLOP = 8

/**
 * The FAB's bottom sheet (report Table 7.1 / Table 9.1 "FAB sheet: spring,
 * translateY, sheet radius 20"). Hand-rolled on RN primitives — Modal +
 * Animated spring, no new dependency, and NO haptic on open/close (Table 9.2:
 * "Sheet open/close → None. Motion carries it; avoid noise").
 *
 * Dismiss paths: tap-outside, swipe-down (PanResponder following the finger,
 * snap-back spring when released short) and the hardware back button.
 * Reduce motion: fade instead of travel, instant states.
 *
 * Drag-vs-tap: a swipe that starts on a row must never ALSO fire that row's
 * press when the finger lifts. Native cancels the click via PanResponder's
 * onClickCapture, but react-native-web's View silently DROPS `onClickCapture`
 * (its forwardedProps allow-list has onClick, not the capture twin — verified
 * against the shipped RN-web source), so a mouse drag released over a row
 * click-throughs to its route. The suppression flag below is the portable
 * belt-and-braces: any gesture that travelled past the slop swallows exactly
 * the one click the platform synthesises on release, then clears.
 */
function FabSheet({ open, onClose, onAction }: { open: boolean; onClose: () => void; onAction: (route: string) => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  // `rendered` keeps the Modal mounted through the EXIT animation.
  const [rendered, setRendered] = useState(false)
  const wasOpen = useRef(false)
  const sheetY = useRef(new Animated.Value(SHEET_HIDDEN)).current
  const backdrop = useRef(new Animated.Value(0)).current
  // True while the just-finished gesture was a drag (see the doc block).
  const suppressRowPress = useRef(false)

  useEffect(() => {
    // Guarded on the open EDGE (not `rendered`) so mounting the sheet for the
    // exit animation does not restart the entrance.
    if (open === wasOpen.current) return
    wasOpen.current = open
    if (open) {
      setRendered(true)
      suppressRowPress.current = false
      if (reduced) {
        sheetY.setValue(0)
        backdrop.setValue(1)
        return
      }
      sheetY.setValue(SHEET_HIDDEN)
      Animated.parallel([
        // Table 9.1: the sheet RISES on a spring — the spatial origin of the
        // create actions. JS driver (web-safe; reanimated stays off the bundle).
        Animated.spring(sheetY, { toValue: 0, friction: 8, tension: 60, useNativeDriver: false }),
        Animated.timing(backdrop, { toValue: 1, duration: motion.fast, useNativeDriver: false }),
      ]).start()
      return
    }
    if (!rendered) return
    if (reduced) {
      setRendered(false)
      return
    }
    Animated.parallel([
      Animated.timing(sheetY, { toValue: SHEET_HIDDEN, duration: motion.base, useNativeDriver: false }),
      Animated.timing(backdrop, { toValue: 0, duration: motion.fast, useNativeDriver: false }),
    ]).start(({ finished }) => {
      if (finished) setRendered(false)
    })
  }, [open, reduced, rendered, sheetY, backdrop])

  // Swallows the single click the browser synthesises right after a drag's
  // mouseup/touchend. The clear is a macrotask behind the release so the click
  // (dispatched synchronously with the pointer-up, before timers) always sees
  // the flag, while a follow-up REAL tap never does.
  const clearDragSuppress = () => {
    setTimeout(() => {
      suppressRowPress.current = false
    }, 0)
  }

  const runAction = (route: string) => {
    if (suppressRowPress.current) {
      suppressRowPress.current = false
      return
    }
    onAction(route)
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 10,
      onPanResponderMove: (_event, gesture) => {
        if (Math.abs(gesture.dy) > SHEET_DRAG_SLOP) suppressRowPress.current = true
        sheetY.setValue(Math.max(0, gesture.dy))
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > SHEET_DISMISS_DY || gesture.vy > 0.8) {
          onClose()
        } else if (!reduced) {
          Animated.spring(sheetY, { toValue: 0, friction: 8, tension: 60, useNativeDriver: false }).start()
        } else {
          sheetY.setValue(0)
        }
        clearDragSuppress()
      },
      onPanResponderTerminate: () => {
        if (!reduced) {
          Animated.spring(sheetY, { toValue: 0, friction: 8, tension: 60, useNativeDriver: false }).start()
        } else {
          sheetY.setValue(0)
        }
        clearDragSuppress()
      },
    }),
  ).current

  if (!rendered) return null

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: backdrop }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close action sheet"
            onPress={onClose}
            style={[StyleSheet.absoluteFill, styles.backdrop]}
          />
        </Animated.View>
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.bgElevated,
              paddingBottom: Math.max(insets.bottom, space.lg),
              transform: [{ translateY: sheetY }],
              opacity: reduced ? backdrop : 1,
            },
            elevationStyle('high', theme.isDark),
          ]}
        >
          {/* The grab handle — the swipe-down affordance. */}
          <View style={[styles.grab, { backgroundColor: theme.border }]} />
          {ACTIONS.map((action) => (
            <SheetAction key={action.label} action={action} onPress={() => runAction(action.route)} />
          ))}
        </Animated.View>
      </View>
    </Modal>
  )
}

function SheetAction({ action, onPress }: { action: Action; onPress: () => void }) {
  const theme = useTheme()
  if (action.hero) {
    return (
      // Table 7.1: "the scan action visually promoted as the sheet's primary
      // row" — the ink surface, the 26pt hero glyph (Table 6.1).
      <PressableFX
        accessibilityRole="button"
        accessibilityLabel={action.label}
        onPress={onPress}
        style={[styles.heroRow, { backgroundColor: theme.text }]}
      >
        <Icon name={action.icon} size={26} color={theme.bg} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.bodyStrong, { color: theme.bg }]}>{action.label}</Text>
          {action.hint ? (
            <Text style={[type.caption, { color: theme.bg, opacity: 0.75 }]}>{action.hint}</Text>
          ) : null}
        </View>
        <Icon name="chevron" size={18} color={theme.bg} />
      </PressableFX>
    )
  }
  return (
    <PressableFX
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={onPress}
      style={[styles.row, { borderColor: theme.border }]}
    >
      <Icon name={action.icon} size={20} color={theme.text} />
      <Text style={[type.body, { color: theme.text, flex: 1 }]}>{action.label}</Text>
      <Icon name="chevron" size={18} color={theme.textFaint} />
    </PressableFX>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  pill: {
    flex: 1,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xs,
  },
  pillInner: {
    flexDirection: 'row',
    minHeight: MIN_TAP_TARGET,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    borderRadius: radius.pill,
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: space.xs,
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
  grab: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    marginVertical: space.sm,
  },
  heroRow: {
    minHeight: 64,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    // Hairline outline — the borderColor the rows pass in is otherwise a
    // no-op (no width); the outline keeps the six rows scannable on the
    // elevated sheet.
    borderWidth: StyleSheet.hairlineWidth,
  },
})
