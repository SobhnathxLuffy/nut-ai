import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { Icon, type IconName } from '../src/components/Icon'
import { CountUp, ProgressRing } from '../src/components/ProgressRing'
import { ItemRow } from '../src/components/ItemRow'
import { Empty } from '../src/components/Empty'
import { Screen, useAction } from '../src/components/Screen'
import { Skeleton, SkeletonRow } from '../src/components/Skeleton'
import { DayStatusControl } from '../src/components/DayStatusControl'
import { showToast } from '../src/components/toast-store'
import { dayTitle, loadDayDetail, parseDayParam, type DayDetailData } from '../src/data/day-detail'
import { db, localDate, undoRecordedOperation } from '../src/data/repo'
import { changeDayStatus } from '../src/data/checkin'
import { subscribeFoodMutations } from '../src/data/food-mutations'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'

/**
 * Day detail (AGENTS.md §0.2 item O4) — the dedicated day view the 56-day
 * strip's day press opens. Route: /day-detail?date=YYYY-MM-DD.
 *
 * The screen is a COMPOSITION of what Home already renders for the selected
 * date — no new nutrition arithmetic anywhere:
 *   - day totals + goal come from the same repo reads Home calls
 *     (dayTotals / currentGoal, via loadDayDetail);
 *   - the hero ring + "Calories left/over" + "of N kcal target" block mirrors
 *     Home's hero card (§8.2), including the honest overflow arc instead of a
 *     clamp-at-100% lie;
 *   - the macro stat rows mirror Home's MacroStatRow (§8.2 — one row per
 *     macro, mini-ring in the macro's identity colour, "left/over of Ng");
 *   - meal rows are ItemRow primitives navigating to meal-detail exactly the
 *     way DayTimeline's meal rows do;
 *   - the day status control is the same component DayTimeline renders.
 *
 * A day with no meals renders the Empty primitive with the create-first next
 * step; a bad ?date= param renders an honest Empty instead of silently
 * substituting a different day.
 */
export default function DayDetailScreen() {
  const theme = useTheme()
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>()
  const rawDate = Array.isArray(dateParam) ? dateParam[0] : dateParam
  // The title must not flip mid-visit if the session crosses midnight.
  const today = useMemo(() => localDate(Date.now()), [])
  const date = parseDayParam(rawDate, today)
  const title = date ? dayTitle(date, today) : 'Day not found'

  const [data, setData] = useState<DayDetailData | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    if (!date) return
    const detail = await loadDayDetail(date)
    setData(detail)
    setLoaded(true)
  }, [date])

  const action = useAction(refresh)
  const perform = (fn: () => Promise<unknown>) => {
    void action.run(fn)
  }

  // DayTimeline's load contract: focus re-reads the day, and any food write
  // (log, undo, delete on another screen) re-reads it live.
  useFocusEffect(
    useCallback(
      () => {
        void refresh().catch((e) =>
          showToast({ message: `Could not load day: ${String(e)}`, tone: 'error' }),
        )
      },
      [refresh],
    ),
  )
  useEffect(() => subscribeFoodMutations(() => void refresh()), [refresh])

  // A bad or impossible date: an honest dead end with a way back, never a
  // silent substitution of another day (the P3-U1 meal-detail lesson).
  if (!date) {
    return (
      <Screen title={title} back backLabel="Back to home">
        <Empty
          icon="calendar"
          title="That date isn't a real day"
          message="A day link looks like /day-detail?date=2024-09-27 — check the one you followed."
          action={{ label: 'Go back', onPress: () => router.back() }}
        />
      </Screen>
    )
  }

  const totals = data?.totals
  const goal = data?.goal ?? null
  const hasGoal = goal != null
  const remaining = hasGoal ? goal.targetKcal - (totals?.kcal ?? 0) : 0
  const over = remaining < 0
  const pct = hasGoal && goal.targetKcal > 0 ? (totals?.kcal ?? 0) / goal.targetKcal : 0

  return (
    <Screen title={title} back backLabel="Back to home">
      {!loaded || !totals ? (
        // The content-shaped placeholders Home's cold-start pass uses (§9.2):
        // ring-shaped hero block, three macro stat rows, timeline rows.
        <>
          <View style={[styles.heroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: space.sm }}>
                <Skeleton width={120} height={40} />
                <Skeleton width={110} height={16} />
              </View>
              <Skeleton width={128} height={128} radius={radius.pill} />
            </View>
          </View>
          <View style={{ gap: space.sm }}>
            <Skeleton width="100%" height={48} radius={radius.xl} />
            <Skeleton width="100%" height={48} radius={radius.xl} />
            <Skeleton width="100%" height={48} radius={radius.xl} />
          </View>
          <View style={{ gap: space.lg }}>
            <SkeletonRow lines={2} />
            <SkeletonRow lines={2} />
          </View>
        </>
      ) : (
        <>
          {/* The day's hero card — Home's hero mirrored for one date: the
              calories-left number, the target line, and the ONE ring with the
              honest overflow arc (§8.2: over target is STATED, never clamped). */}
          <View style={[styles.heroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
            <View style={styles.heroTop}>
              <View style={{ flex: 1, gap: space.xs }}>
                {hasGoal ? (
                  <>
                    <CountUp value={Math.abs(Math.round(remaining))} style={[styles.hero, { color: theme.text }]} />
                    <Text style={[type.body, { color: theme.textMuted }]}>
                      {over ? 'Calories over' : 'Calories left'}
                    </Text>
                    <Text style={[type.caption, { color: theme.textMuted }]}>
                      of <Text style={type.monoData}>{Math.round(goal.targetKcal).toLocaleString()}</Text> kcal target
                    </Text>
                  </>
                ) : (
                  <>
                    <CountUp value={Math.round(totals.kcal)} style={[styles.hero, { color: theme.text }]} />
                    <Text style={[type.body, { color: theme.textMuted }]}>kcal logged</Text>
                    <Text style={[type.caption, { color: theme.textMuted }]}>
                      No target set yet — the ring fills once one is.
                    </Text>
                  </>
                )}
              </View>
              <ProgressRing value={pct} overflow={over ? pct - 1 : 0} size={128} stroke={12}>
                <CountUp
                  value={Math.round(totals.kcal)}
                  format={(n) => Math.round(n).toLocaleString()}
                  style={{ color: theme.text, fontSize: type.heading.fontSize }}
                />
                <Text style={[type.caption, { color: theme.textMuted }]}>eaten</Text>
              </ProgressRing>
            </View>
            {totals.pendingCount > 0 ? (
              <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md }]}>
                {totals.pendingCount} {totals.pendingCount === 1 ? 'entry is' : 'entries are'} still being analysed and count as zero for now.
              </Text>
            ) : null}
          </View>

          {/* The three macro stat rows — Home's §8.2 pattern mirrored: one
              row per macro, inline mini-ring in the macro's identity colour,
              "left of Ng" / "over Ng" in tabular figures. */}
          <View style={[styles.macroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
            <MacroStatRow label="Protein" icon="protein" eaten={totals.protein_g} target={goal?.protein_g ?? 0} color={theme.protein} />
            <View style={[styles.macroDivider, { backgroundColor: theme.border }]} />
            <MacroStatRow label="Carbs" icon="carbs" eaten={totals.carbs_g} target={goal?.carbs_g ?? 0} color={theme.carbs} />
            <View style={[styles.macroDivider, { backgroundColor: theme.border }]} />
            <MacroStatRow label="Fat" icon="fat" eaten={totals.fat_g} target={goal?.fat_g ?? 0} color={theme.fat} />
          </View>

          {/* Meals — ItemRow rows navigating to meal-detail exactly the way
              DayTimeline's meal rows do (same route, same param shape). */}
          <Text style={[type.label, { color: theme.textMuted, marginTop: space.sm }]}>Meals</Text>
          {data.meals.length === 0 ? (
            <Empty
              icon="bowl"
              title="No meals logged"
              message="Nothing was logged on this day yet. Log food to see it here."
              action={{
                label: 'Log food',
                onPress: () => router.push({ pathname: '/food-search', params: { date } } as never),
              }}
            />
          ) : (
            <View style={{ gap: space.sm }}>
              {data.meals.map((row) => (
                <ItemRow
                  key={row.id}
                  icon="bowl"
                  label={row.label}
                  value={`${timeLabel(row.at)} · ${row.detail}`}
                  accessibilityLabel={`${row.label}: ${row.detail}`}
                  onPress={() => router.push({ pathname: '/meal-detail', params: { id: row.id } } as never)}
                  trailing={
                    <Text style={[type.monoData, { color: theme.textMuted }]}>
                      {row.kcal == null ? '— kcal' : `${Math.round(row.kcal)} kcal`}
                    </Text>
                  }
                />
              ))}
            </View>
          )}

          {/* The day's status control — the same component, reads and write
              path DayTimeline renders for the selected date. */}
          <DayStatusControl
            date={date}
            isToday={date === today}
            status={data.status}
            history={data.history}
            disabled={action.busy}
            onStatusChange={async (s) => {
              await perform(async () => {
                await changeDayStatus(await db(), {
                  localDate: date,
                  completion: s,
                  provenance: 'day_detail',
                  now: Date.now(),
                })
              })
            }}
            onUndoStatus={async () => {
              await perform(async () => {
                const target = data.history[0]
                const r = target ? await undoRecordedOperation(target.uuid) : { success: false as const }
                if (!r.success) throw new Error(r.error ?? 'Nothing to undo')
              })
            }}
          />
          {action.feedback}
        </>
      )}
    </Screen>
  )
}

/** The timeline row's time format, mirrored from DayTimeline's meal rows. */
function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Home's §8.2 macro stat row, mirrored (the Home copy is private to the tab).
 * Display surface, not tappable — sized to the card's own rhythm.
 */
function MacroStatRow({
  label,
  icon,
  eaten,
  target,
  color,
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
      <ProgressRing value={pct} size={36} stroke={4} color={color}>
        <Icon name={icon} size={14} color={color} />
      </ProgressRing>
      <Text style={[type.body, { color: theme.text }]}>{label}</Text>
      <View style={styles.macroStatNums}>
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
  heroCard: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xl,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  hero: {
    // The calories-left hero, Home's display moment mirrored (Table 3.1) —
    // display caps at 1.2× so 56×1.2 = 67.2 needs the 68px headroom here.
    ...type.display,
    lineHeight: 68,
  },
  macroCard: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.sm,
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
})
