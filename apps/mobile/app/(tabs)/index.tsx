import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../../src/components/Icon'
import { CountUp, ProgressRing } from '../../src/components/ProgressRing'
import { PressableFX } from '../../src/components/PressableFX'
import { DayTimeline } from '../../src/components/DayTimeline'
import { Skeleton, SkeletonRow } from '../../src/components/Skeleton'
import {
  adaptiveTargetView,
  dayStripFlags,
  dayStripOffsets,
  slotGuide,
} from '../../src/data/home-instrument'
import {
  currentGoal,
  dayTotals,
  db,
  localDate,
  runAdaptive,
  slotKcalForDay,
  type AdaptiveOutcome,
  type CurrentGoal,
  type DayTotals,
} from '../../src/data/repo'
import { subscribeFoodMutations } from '../../src/data/food-mutations'
import { selectionAsync } from '../../src/utils/haptics'
import { useMotionScale, useTheme } from '../../src/theme/ThemeProvider'
import { useTabBarBottomInset } from '../../src/theme/layout'
import { dayColumnWidthFor } from '../../src/theme/responsive-grid'
import { radius, space, type } from '../../src/theme/tokens'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Table 9.1's one sanctioned loop cadence (the skeleton shimmer's 1.2s). */
const TODAY_PULSE_MS = 1200

/** §8.2 item 7: downward drag (px) at the top that arms the web pull. */
const PULL_THRESHOLD = 72

/**
 * Duplicate-press guard window for the hero disclosure (see toggleDetail):
 * a single tap on Samsung/OneUI can arrive as two onPress events, and presses
 * inside this window count as one.
 */
const HERO_TOGGLE_GUARD_MS = 300

/**
 * Home — an instrument, not a dashboard (UI/UX report §8.2, Wave 3).
 *
 * Three rules this screen will not break, all of them about not moralising:
 *
 *   A day with nothing logged reads "no entries logged" in a neutral colour.
 *   Never "missed", never red — red is reserved for safety warnings.
 *
 *   Over target is STATED, not scolded. The ring draws a second overflow arc
 *   rather than clamping at 100% and lying about it. The slot guide follows
 *   the same rule: a slot past its quarter says "over", never in warning tone.
 *
 *   Pending scans contribute ZERO calories and show as a count. A number that
 *   silently grows later is worse than one that is visibly incomplete.
 *
 * The instrument pass (§8.2): the hero ring counts up on focus and presses
 * open a per-me-slot breakdown (an EXPLICIT even-split guide — the app stores
 * no per-slot budget); every live number is set in tabular figures
 * (type.monoData) so updates land without digit jitter; the three macro cards
 * are compact stat rows with inline mini-rings; the adaptive-target card runs
 * an explicit state machine (fixed / locked / stable / adjusting) with calm
 * copy; the strip gains a today-pulse dot and future-dimmed days.
 */
export default function Home() {
  // Android release QA 2026-10: the scroll bottom pad is DERIVED from the
  // real floating tab-bar + FAB + navigation-bar overlay, not a magic 150 —
  // timeline rows no longer slide underneath the bar/FAB on the Samsung
  // gesture-nav layout.
  const tabBarInset = useTabBarBottomInset()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const motionScale = useMotionScale()

  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [totals, setTotals] = useState<DayTotals | null>(null)
  const [adaptive, setAdaptive] = useState<AdaptiveOutcome | null>(null)
  const [offset, setOffset] = useState(0)
  const [streak, setStreak] = useState(0)
  /** kcal logged per meal slot for the selected day (slotKcalForDay). */
  const [slotKcal, setSlotKcal] = useState<Record<string, number> | null>(null)
  // UI/UX report §8.2 / Table 9.1 (Wave 1c): pull-to-refresh re-runs the same
  // day-totals + goal + slot read this screen already performs (loadData) —
  // the native RefreshControl is the "expected sync gesture"; no new data flow.
  const [refreshing, setRefreshing] = useState(false)
  // §8.2 / Table 9.1 "Ring / count-up: 600ms ease-out on focus" — every
  // arrival on Home (focus, day pick, refresh-triggered reload) replays the
  // hero numbers sweeping in from zero. The tick remounts the ring + CountUps.
  const [focusTick, setFocusTick] = useState(0)
  // §8.2 press-for-detail: the hero card expands into the per-slot breakdown.
  const [expanded, setExpanded] = useState(false)
  const [contentH, setContentH] = useState(0)
  const detailH = useRef(new Animated.Value(0)).current

  const selected = useMemo(() => Date.now() + offset * 86_400_000, [offset])

  const loadData = useCallback(async () => {
    // The adaptive loop runs BEFORE reading the goal, so a target it just
    // changed is the one rendered. Its own gates decide whether it may act.
    const outcome = await runAdaptive(Date.now())
    const h = await db()
    const [g, t, days, slots] = await Promise.all([
      currentGoal(),
      dayTotals(localDate(selected)),
      // P2-34 (QA Wave 4): this scan used to run with NO limit on every Home
      // focus — a linearly-growing query on the hottest screen. The DayStrip
      // renders 56 days and the streak never counts more than it renders;
      // 120 covers both plus a wide margin, forever.
      h.all<{ local_date: string }>(
        'SELECT DISTINCT local_date FROM meals WHERE deleted_at IS NULL ORDER BY local_date DESC LIMIT 120',
      ),
      // §8.2: the per-slot read for the press-for-detail expansion — the SAME
      // arithmetic and WHERE clause as dayTotals, only GROUP BY differs, so
      // the slot rows always add up to exactly the number the ring shows.
      slotKcalForDay(localDate(selected)),
    ])
    setAdaptive(outcome)
    setGoal(g)
    setTotals(t)
    setStreak(countStreak(days.map((d) => d.local_date)))
    setSlotKcal(slots)
  }, [selected])

  useFocusEffect(
    useCallback(() => {
      setFocusTick((tick) => tick + 1)
      let alive = true
      void (async () => {
        if (!alive) return
        await loadData()
      })()
      return () => {
        alive = false
      }
    }, [loadData]),
  )

  useEffect(() => subscribeFoodMutations(() => { void loadData() }), [loadData])

  // §8.2 press-for-detail: a spring opens/closes the measured height of the
  // slot breakdown (Table 9.1 — springs for anything position-based). Reduce
  // motion (motionScale 0) collapses to the instant state.
  //
  // Android release QA 2026-10 (owner item #5): closing used to visibly bounce
  // open-close-open on the Samsung device. Friction 9 at tension 84 is
  // under-damped (ζ≈0.7) and this effect RESTARTS the spring from the current
  // position on every dep change, so a mid-flight reversal (duplicate toggle —
  // guarded in toggleDetail) or a contentH identity change (guarded in the
  // onLayout below) re-entered the spring displaced and oscillated. Friction 13
  // at tension 84 is critical damping and overshootClamping hard-stops at the
  // target, so a restarted spring converges without bouncing. Card-scoped — no
  // global animation change.
  useEffect(() => {
    const target = expanded && contentH > 0 ? contentH : 0
    if (motionScale === 0 || contentH === 0) {
      detailH.setValue(contentH > 0 ? target : 0)
      return
    }
    Animated.spring(detailH, { toValue: target, friction: 13, tension: 84, overshootClamping: true, useNativeDriver: false }).start()
  }, [expanded, contentH, motionScale, detailH])

  // Duplicate-press guard: a single tap on Samsung/OneUI can deliver two
  // onPress events; the second one used to reverse the close mid-spring — the
  // open-close-open bounce (owner item #5). Re-presses inside the window are
  // swallowed whole (no haptic, no state write). Cost, deliberately accepted:
  // a genuine open→close→open flick now needs ≥300ms between presses — slower
  // than ghost delivery (~50-100ms) and about the fastest anyone re-taps a
  // disclosure on purpose, so real intent survives; only same-gesture ghosts
  // are dropped.
  const lastHeroToggleAt = useRef(0)
  const toggleDetail = useCallback(() => {
    const now = Date.now()
    if (now - lastHeroToggleAt.current < HERO_TOGGLE_GUARD_MS) return
    lastHeroToggleAt.current = now
    // Table 9.2: a disclosure toggle lands the selection tick — feedback for a
    // state change, not a reward (that stays reserved for logging).
    selectionAsync()
    setExpanded((e) => !e)
  }, [])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    void loadData().finally(() => setRefreshing(false))
  }, [loadData])

  // -----------------------------------------------------------------
  // §8.2 item 7 — pull-to-refresh, implemented honestly for the web.
  //
  // react-native-web's RefreshControl is an EMPTY VIEW STUB (verified in
  // node_modules/react-native-web/dist/exports/RefreshControl/index.js — it
  // renders <View/> and drops onRefresh/refreshing on the floor), so the
  // Wave-1c wiring could only ever work on native. Native keeps the real
  // RefreshControl; the web build gets a genuine touch pull: drag down from
  // the top, a pill follows the finger (damped past the threshold), release
  // past the threshold re-syncs the day and the pill springs away — the
  // report's "satisfying snap". Mouse users keep the focus-triggered reload;
  // a mouse cannot pull, and faking a desktop PTR affordance would be the
  // dishonest version. Reduce motion: no follow, no springs — the pull still
  // works, landing as instant states.
  // -----------------------------------------------------------------
  const pullY = useRef(new Animated.Value(0)).current
  const pullStartY = useRef<number | null>(null)
  const atTop = useRef(true)
  const [pullArmed, setPullArmed] = useState(false)

  const snapPullTo = useCallback(
    (to: number) => {
      if (motionScale === 0) {
        pullY.setValue(to)
        return
      }
      Animated.spring(pullY, { toValue: to, friction: 7, tension: 120, useNativeDriver: false }).start()
    },
    [motionScale, pullY],
  )

  // The pill settles at its armed spot while the sync runs, then springs
  // away when it completes — unless a NEW gesture already owns the pill.
  useEffect(() => {
    if (Platform.OS !== 'web') return
    if (refreshing) {
      if (motionScale === 0) pullY.setValue(PULL_THRESHOLD)
      else Animated.spring(pullY, { toValue: PULL_THRESHOLD, friction: 7, tension: 120, useNativeDriver: false }).start()
    } else if (pullStartY.current == null) {
      snapPullTo(0)
    }
  }, [refreshing, motionScale, pullY, snapPullTo])

  const onScrollAtTop = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    atTop.current = e.nativeEvent.contentOffset.y <= 0
  }, [])

  const onTouchStartPull = useCallback((e: GestureResponderEvent) => {
    if (Platform.OS !== 'web') return
    const y = e.nativeEvent.touches[0]?.pageY
    pullStartY.current = atTop.current && typeof y === 'number' ? y : null
  }, [])

  const onTouchMovePull = useCallback((e: GestureResponderEvent) => {
    if (Platform.OS !== 'web' || pullStartY.current == null) return
    const y = e.nativeEvent.touches[0]?.pageY
    if (typeof y !== 'number') return
    const dy = y - pullStartY.current
    if (dy <= 0) {
      pullY.setValue(0)
      setPullArmed(false)
      return
    }
    if (motionScale === 0) {
      // Reduce motion: the pill states armed-or-hidden instead of following.
      pullY.setValue(dy >= PULL_THRESHOLD ? PULL_THRESHOLD : 0)
    } else {
      // Elastic damping past the threshold — the pull feels like a spring.
      pullY.setValue(dy <= PULL_THRESHOLD ? dy : PULL_THRESHOLD + (dy - PULL_THRESHOLD) * 0.25)
    }
    setPullArmed(dy >= PULL_THRESHOLD)
  }, [motionScale, pullY])

  const onTouchEndPull = useCallback((e: GestureResponderEvent) => {
    if (Platform.OS !== 'web' || pullStartY.current == null) return
    const y = e.nativeEvent.changedTouches[0]?.pageY
    const dy = typeof y === 'number' ? y - pullStartY.current : 0
    pullStartY.current = null
    if (dy >= PULL_THRESHOLD) {
      setPullArmed(false)
      onRefresh()
    } else {
      setPullArmed(false)
      snapPullTo(0)
    }
  }, [onRefresh, snapPullTo])

  const pullProps = Platform.OS === 'web'
    ? {
        onScroll: onScrollAtTop,
        onTouchStart: onTouchStartPull,
        onTouchMove: onTouchMovePull,
        onTouchEnd: onTouchEndPull,
        onTouchCancel: onTouchEndPull,
      }
    : undefined

  if (!goal || !totals) {
    // P2-36 (QA Wave 4): boot no longer gates first paint behind migrate +
    // seed + three queries. The shell renders immediately — real header, real
    // DayStrip (it needs no DB) — with quiet placeholder blocks where the
    // numbers will land, so cold start reads as structure, not a blank wait.
    // UI/UX report §8.2 / §9.2 (Wave 1c): the placeholders are the shared
    // Skeleton primitive — a timeline-shaped skeleton (ring placeholder,
    // macro stat rows, timeline rows) that mimics the layout it becomes.
    return (
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: tabBarInset }}
        showsVerticalScrollIndicator={false}
        {...pullProps}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textMuted} colors={[theme.textMuted]} />
        }
      >
        <PullIndicator y={pullY} armed={pullArmed} refreshing={refreshing} />
        <View style={styles.header}>
          <Text style={[styles.wordmark, { color: theme.text }]}>Nut AI</Text>
          <View style={[styles.streakPill, { backgroundColor: theme.bgSunken }]}>
            <Icon name="flame" size={16} color={theme.textFaint} />
            <Text style={[type.monoData, { color: theme.textFaint }]}>–</Text>
          </View>
        </View>

        <DayStrip selected={offset} onSelect={setOffset} />

        <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
          <View style={[styles.heroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: space.sm }}>
                <Skeleton width={120} height={40} />
                <Skeleton width={110} height={16} />
              </View>
              {/* The ring placeholder — a circle the same size as the hero ring. */}
              <Skeleton width={128} height={128} radius={radius.pill} />
            </View>
          </View>

          {/* The macro stat rows the loaded screen renders — three row-shaped
              blocks the same height as one stat row. */}
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <Skeleton width="100%" height={48} radius={radius.xl} />
            <Skeleton width="100%" height={48} radius={radius.xl} />
            <Skeleton width="100%" height={48} radius={radius.xl} />
          </View>
        </View>

        <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
          <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: 'transparent', gap: space.sm }]}>
            <Skeleton width={140} height={18} />
            <Skeleton width="100%" height={16} />
            <Skeleton width="80%" height={16} />
          </View>
        </View>

        <View style={{ paddingHorizontal: space.lg, marginTop: space.xl, gap: space.md }}>
          {/* Wave 1a: Home's private 24px header override joins the unified
              type.title (28/32) — one header voice (report §3.3). */}
          <Text style={[type.title, { color: theme.text }]}>Daily timeline</Text>
          {/* Timeline rows — the same avatar+line shape the loaded rows use. */}
          <View style={{ gap: space.lg }}>
            <SkeletonRow lines={2} />
            <SkeletonRow lines={2} />
          </View>
        </View>
      </ScrollView>
    )
  }

  const remaining = goal.targetKcal - totals.kcal
  const over = remaining < 0
  const pct = goal.targetKcal > 0 ? totals.kcal / goal.targetKcal : 0
  // §8.2 press-for-detail: the per-slot breakdown. The guide is an EXPLICIT
  // even split of the day's target — the app stores no per-slot budget, and
  // the footnote in the expansion says so in plain words.
  const slotRows = slotGuide(goal.targetKcal, slotKcal ?? {})
  const unslottedKcal = Math.round(slotKcal?.unslotted ?? 0)
  // The adaptive-target state machine (§8.2): fixed / locked / stable /
  // adjusting, derived only from data the goal row actually carries.
  const targetView = adaptiveTargetView(
    {
      adaptive: goal.adaptive,
      checkinAcceptedAt: goal.checkinAcceptedAt ?? null,
      surfaced: adaptive?.surfaced === true,
      now: Date.now(),
    },
    { reason: adaptive?.reason, explanation: adaptive?.explanation, newKcal: adaptive?.newKcal },
  )
  const chevronSpin = detailH.interpolate({
    inputRange: [0, Math.max(contentH, 1)],
    outputRange: ['0deg', '90deg'],
  })

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: tabBarInset }}
      showsVerticalScrollIndicator={false}
      {...pullProps}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textMuted} colors={[theme.textMuted]} />
      }
    >
      <PullIndicator y={pullY} armed={pullArmed} refreshing={refreshing} />
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.wordmark, { color: theme.text }]}>Nut AI</Text>
        <View style={[styles.streakPill, { backgroundColor: theme.bgSunken }]}>
          <Icon name="flame" size={16} color={theme.text} />
          {/* §8.2 tabular figures: the streak is a live number — monoData. */}
          <Text style={[type.monoData, { color: theme.text }]}>{streak}</Text>
        </View>
      </View>

      {/* Day strip */}
      <DayStrip selected={offset} onSelect={setOffset} />

      {/* Calories + macros — single view, no fake carousel */}
      <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
        <PressableFX
          onPress={toggleDetail}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? 'Hide remaining calories by meal' : 'Show remaining calories by meal'
          }
          aria-expanded={expanded}
          style={[styles.heroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
        >
          <View style={styles.heroTop}>
            <View style={{ flex: 1, gap: space.xs }}>
              {/* UI/UX report Table 5.1 / Table 12.2 (Wave 2): the hero number
                  joins the ONE ring's count-up twin — 600ms ease-out on focus
                  (Table 9.1), tabular figures from monoData (§4.2). The tick
                  key replays it on every focus (§8.2 count-up on focus). */}
              <CountUp
                key={`hero-${focusTick}`}
                value={Math.abs(Math.round(remaining))}
                style={[styles.hero, { color: theme.text }]}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <Text style={[type.body, { color: theme.textMuted }]}>
                  {over ? 'Calories over' : 'Calories left'}
                </Text>
                {/* The disclosure affordance — spins open with the spring. */}
                <Animated.View style={{ transform: [{ rotate: chevronSpin }] }}>
                  <Icon name="chevron" size={14} color={theme.textFaint} />
                </Animated.View>
              </View>
              <Text style={[type.caption, { color: theme.textMuted }]}>
                of <Text style={type.monoData}>{Math.round(goal.targetKcal).toLocaleString()}</Text> kcal target
              </Text>
            </View>
            {/* Table 12.2 (Wave 2): the hand-rolled Ring joins the ONE
                ProgressRing — stroke + track + the honest overflow arc.
                §8.2 Apple-Fitness ring language: the center carries the day's
                eaten kcal, counting up in tabular figures. */}
            <ProgressRing
              key={`ring-${focusTick}`}
              value={pct}
              overflow={over ? pct - 1 : 0}
              size={128}
              stroke={12}
            >
              <CountUp
                key={`eaten-${focusTick}`}
                value={Math.round(totals.kcal)}
                format={(n) => Math.round(n).toLocaleString()}
                style={{ color: theme.text, fontSize: type.heading.fontSize }}
              />
              <Text style={[type.caption, { color: theme.textMuted }]}>eaten</Text>
            </ProgressRing>
          </View>

          {/* §8.2 press-for-detail — remaining calories by meal slot. The
              wrapper's height springs to the measured content; clipped when
              collapsed. Screen readers get the rows only when expanded. */}
          <Animated.View
            style={[styles.detailClip, { height: detailH }]}
            accessibilityElementsHidden={!expanded}
            importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
          >
            <View
              style={styles.detailInner}
              onLayout={(e) => {
                // Whole-px + equality-bail: re-measure passes during the height
                // animation deliver fractional floats that differ by noise
                // (214.00001 vs 214); every identity change re-ran the spring
                // effect, restarting it mid-flight. Rounding makes the value
                // stable across passes; the bail keeps same-value passes from
                // touching state at all.
                const h = Math.round(e.nativeEvent.layout.height)
                if (h > 0 && h !== contentH) setContentH(h)
              }}
            >
              <View style={[styles.detailDivider, { backgroundColor: theme.border }]} />
              <Text style={[type.caption, { color: theme.textFaint }]}>Remaining by meal</Text>
              {slotRows.map((r) => (
                <View key={r.slot} style={styles.slotRow}>
                  <Text style={[type.label, { color: theme.text }]}>{r.label}</Text>
                  {r.loggedKcal > 0 ? (
                    <Text style={[type.monoData, { color: theme.textMuted, marginLeft: 'auto' }]}>
                      {r.loggedKcal.toLocaleString()}
                    </Text>
                  ) : (
                    <Text style={[type.caption, { color: theme.textFaint, marginLeft: 'auto' }]}>
                      not logged
                    </Text>
                  )}
                  <Text style={[styles.slotGuideNum, { color: theme.text }]}>
                    {r.over
                      ? `${Math.abs(r.guideLeftKcal).toLocaleString()} over`
                      : `${r.guideLeftKcal.toLocaleString()} left`}
                  </Text>
                </View>
              ))}
              {unslottedKcal > 0 ? (
                <Text style={[type.caption, { color: theme.textFaint }]}>
                  {unslottedKcal.toLocaleString()} kcal logged without a slot
                </Text>
              ) : null}
              <Text style={[type.caption, { color: theme.textFaint }]}>
                A quarter of your day per meal — a guide, not a budget.
              </Text>
            </View>
          </Animated.View>
        </PressableFX>

        {/* §8.2: the three macro CARDS become compact stat rows with inline
            mini-rings — one card, one line per macro, macro identity colours
            from the theme's token group. */}
        <View style={[styles.macroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
          <MacroStatRow label="Protein" icon="protein" eaten={totals.protein_g} target={goal.protein_g} color={theme.protein} />
          <View style={[styles.macroDivider, { backgroundColor: theme.border }]} />
          <MacroStatRow label="Carbs" icon="carbs" eaten={totals.carbs_g} target={goal.carbs_g} color={theme.carbs} />
          <View style={[styles.macroDivider, { backgroundColor: theme.border }]} />
          <MacroStatRow label="Fat" icon="fat" eaten={totals.fat_g} target={goal.fat_g} color={theme.fat} />
        </View>
      </View>

      {/* Adaptive target status — always legible, never a silent change. §8.2
          turns the free-form caption into an explicit state machine with calm
          MacroFactor-style copy: fixed by hand, locked after a check-in, or
          steady while it learns. */}
      <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
        <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: 'transparent' }]}>
          <View style={styles.spread}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="target" size={18} color={theme.text} />
              <Text style={[type.bodyStrong, { color: theme.text }]}>Your target</Text>
            </View>
            <Text style={[type.monoData, { color: theme.text }]}>
              {Math.round(goal.targetKcal).toLocaleString()} kcal
            </Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
            {targetView.detail}
          </Text>
          <PressableFX
            onPress={() => router.push('/log-weight' as never)}
            accessibilityRole="button"
            accessibilityLabel="Log today's weight"
            style={styles.weightLink}
          >
            <Icon name="scale" size={16} color={theme.protein} />
            <Text style={[type.label, { color: theme.proteinText }]}>Log today's weight</Text>
          </PressableFX>
        </View>
      </View>

      {/* Daily Timeline */}
      <View style={{ paddingHorizontal: space.lg, marginTop: space.xl, gap: space.md }}>
        <Text style={[type.title, { color: theme.text }]}>Daily timeline</Text>
        <DayTimeline selectedDate={localDate(selected)} hideDateControls hideTotals />
      </View>
    </ScrollView>
  )
}

/**
 * §8.2 item 7 — the web pull-to-refresh indicator. Rides the top of the
 * scroll content: hidden above the fold at rest, follows the finger during
 * the pull, settles at the armed spot while the day re-syncs, then springs
 * away (the "satisfying snap"). Decorative by design — pointer-events none,
 * hidden from the a11y tree — the data refresh itself is announced by the
 * numbers changing; native platforms use the real RefreshControl instead.
 */
function PullIndicator({
  y, armed, refreshing,
}: {
  y: Animated.Value
  armed: boolean
  refreshing: boolean
}) {
  const theme = useTheme()
  if (Platform.OS !== 'web') return null
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.pullWrap, { transform: [{ translateY: y }] }]}
    >
      <View style={[styles.pullPill, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
        <Icon name={refreshing ? 'check' : 'arrowDown'} size={14} color={theme.textMuted} />
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {refreshing ? 'Syncing your day…' : armed ? 'Release to sync' : 'Pull to sync'}
        </Text>
      </View>
    </Animated.View>
  )
}

function DayStrip({ selected, onSelect }: { selected: number; onSelect: (o: number) => void }) {
  const theme = useTheme()
  const motionScale = useMotionScale()
  // Android release QA 2026-10: day columns used `flex: 1` (basis 0) AND a
  // fixed width in the MAIN axis of a horizontal ScrollView — Yoga resolves
  // main-axis flexBasis over width, so column measurement was edge-dependent
  // and the strip clipped left/right on device. Columns now take an exact
  // computed width (~7 visible days) with no flex competition.
  const { width: windowWidth } = useWindowDimensions()
  const dayWidth = dayColumnWidthFor(windowWidth)
  // The strip is anchored to the moment Home mounted — it must not re-derive
  // its weeks mid-session and slide the calendar under the user's finger.
  const now = useMemo(() => new Date(), [])
  // Monday-first 56-day window, from the pure derivation (pinned by tests).
  const days = useMemo(() => dayStripOffsets(now), [now])
  const scrollViewRef = useRef<ScrollView>(null)

  // §8.2 today-pulse: the live "you are here" marker — a small dot under
  // today's date breathing at the report's one sanctioned loop cadence.
  // Reduce motion renders the dot solid; selection stays a separate state.
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (motionScale === 0) {
      pulse.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: TODAY_PULSE_MS, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: TODAY_PULSE_MS, useNativeDriver: false }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [motionScale, pulse])

  return (
    <ScrollView
      ref={scrollViewRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: false })}
      style={{ marginTop: space.lg }}
      contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.xs }}
    >
      {days.map((off) => {
        const d = new Date(now.getTime() + off * 86_400_000)
        const flags = dayStripFlags(off)
        const isSel = off === selected
        return (
          <Pressable
            key={off}
            disabled={flags.future}
            // O4 (day-detail): a strip press still selects the day here AND
            // opens the dedicated day-detail view for that date — the exact
            // date the chip shows (strip-anchored `now`, same arithmetic).
            // Selection mechanics below are untouched.
            onPress={() => {
              onSelect(off)
              router.push({
                pathname: '/day-detail',
                params: { date: localDate(now.getTime() + off * 86_400_000) },
              } as never)
            }}
            accessibilityRole="button"
            accessibilityLabel={flags.today ? `Today, ${DAY_LABELS[d.getDay()]} ${d.getDate()}` : undefined}
            accessibilityState={{ selected: isSel, disabled: flags.future }}
            style={[styles.dayCol, { width: dayWidth }, isSel && { backgroundColor: theme.bgElevated }]}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={[type.caption, { color: flags.future ? theme.textFaint : theme.textMuted }]}
            >
              {DAY_LABELS[d.getDay()]}
            </Text>
            <View
              style={[
                styles.dayCircle,
                {
                  borderColor: isSel ? theme.text : theme.border,
                  borderStyle: off < 0 ? 'dashed' : 'solid',
                  // §8.2 future-dimmed: days after today read at reduced
                  // opacity and never accept a tap — you cannot log tomorrow.
                  opacity: flags.future ? 0.4 : 1,
                },
              ]}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={[type.bodyStrong, { color: flags.future ? theme.textFaint : theme.text }]}
              >
                {d.getDate()}
              </Text>
            </View>
            {/* The pulse slot renders on every day so the row height never
                jumps; only today carries the dot. */}
            <View style={styles.todaySlot}>
              {flags.today ? (
                <Animated.View style={[styles.todayDot, { backgroundColor: theme.text, opacity: pulse }]} />
              ) : null}
            </View>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

/** Consecutive logged days ending today, or yesterday if today is still open. */
function countStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const set = new Set(dates)
  const day = 86_400_000
  let n = 0
  let cursor = Date.now()
  // A day still in progress must not break a streak that is otherwise intact.
  if (!set.has(isoLocal(cursor))) cursor -= day
  while (set.has(isoLocal(cursor))) {
    n++
    cursor -= day
  }
  return n
}

/** Local date ISO string from a unix timestamp. */
function isoLocal(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * §8.2: one macro = one compact stat row — inline mini-ring in the macro's
 * identity colour, label, and the "left" number in tabular figures. Rows are
 * display surface (not tappable), sized to the card's own rhythm.
 */
function MacroStatRow({
  label, icon, eaten, target, color,
}: {
  label: string
  icon: IconName
  eaten: number
  target: number
  color: string
}) {
  const theme = useTheme()
  const hasTarget = target > 0
  const left = target - eaten
  const pct = hasTarget ? Math.min(1, eaten / target) : 0

  return (
    <View style={styles.macroStatRow}>
      {/* Wave 2: the per-macro ring is the same ONE primitive with the
          macro identity colour — one geometry, one animation contract. */}
      <ProgressRing value={pct} size={36} stroke={4} color={color}>
        <Icon name={icon} size={14} color={color} />
      </ProgressRing>
      <Text style={[type.body, { color: theme.text }]}>{label}</Text>
      <View style={styles.macroStatNums}>
        {/* §8.2 tabular figures: macro numbers update live — monoData. */}
        <Text style={[type.monoData, { color: theme.text }]}>
          {hasTarget ? `${Math.abs(Math.round(left))}g` : `${Math.round(eaten)}g`}
        </Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {hasTarget
            ? left >= 0
              ? `left of ${Math.round(target)}g`
              : `over ${Math.round(target)}g`
            : 'logged'}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  wordmark: { ...type.title },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  strip: { flexDirection: 'row', paddingHorizontal: space.lg, marginTop: space.lg },
  // No flex here — width comes from the caller (see DayStrip) so horizontal
  // main-axis measurement is exact instead of basis-0 + grow.
  dayCol: { alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.lg, gap: space.sm },
  dayCircle: {
    width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  todaySlot: { height: 6, alignItems: 'center', justifyContent: 'center' },
  todayDot: { width: 5, height: 5, borderRadius: radius.pill },
  pullWrap: { position: 'absolute', top: -48, left: 0, right: 0, alignItems: 'center' },
  pullPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroCard: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xl,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  detailClip: { overflow: 'hidden' },
  detailInner: { paddingTop: space.md, gap: space.xs },
  detailDivider: { height: StyleSheet.hairlineWidth, marginBottom: space.xs },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  slotGuideNum: { ...type.monoData, minWidth: 96, textAlign: 'right' },
  hero: {
    // Wave 1a: the calories-left hero is THE display moment of the Home
    // screen (report Table 3.1 — "display 56/60 replaces hero one-offs").
    ...type.display,
    // Wave 4b (report §11.1): display caps at 1.2× — 56×1.2 = 67.2 exceeds
    // the token lineHeight 60, so the hero carries 68; the heroCard's flex
    // layout absorbs the +8px.
    lineHeight: 68,
  },
  macroCard: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.sm,
    marginTop: space.md,
  },
  macroStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  macroStatNums: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  macroDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: space.md },
  weightLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.md,
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
    borderRadius: radius.md,
    minHeight: 44,
  },
  card: { padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
})
