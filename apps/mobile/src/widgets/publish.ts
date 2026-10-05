/**
 * The JS half of the Android home-screen widget (T3-c): gathering + publishing
 * the snapshot JSON to the native `NutaiWidgets` module.
 *
 * Contract with the native side (T3-c-native): ONE method,
 * `NutaiWidgets.publish(json: string)`, receiving the schema-v1 JSON built by
 * ../data/widget-snapshot.ts (see its header for every field's source). The
 * native module is looked up through `requireNativeModule` (expo-modules-core,
 * transitive dep, verified resolvable) inside try/catch — the same guarded-shim
 * approach as src/ui/alert-web.ts — so WEB, Expo Go, and any build from before
 * `expo prebuild` picked the native module up are all expected, SILENT no-ops.
 * The widget is cosmetic: the app must never crash for it.
 *
 * Failure policy: a missing native module stays silent (expected platform
 * state). A REAL failure — a DB read error, a native publish throwing — is a
 * silent no-op plus ONE console.warn per process (never a throw, never spam).
 *
 * Debounce: every mutation source routes through `scheduleWidgetPublish`, a
 * ~2s TRAILING debounce — a burst of writes (a logged meal, several set
 * saves, an undo) coalesces into exactly one publish ~2s after the last
 * event. `publishWidgetSnapshot` itself is immediate and undebounced; only
 * the event seams use the scheduler.
 */

import { requireNativeModule } from 'expo-modules-core'
import { AppState } from 'react-native'
import {
  activeWorkout,
  listPrograms,
  listRoutines,
  onWorkoutsChanged,
  programDayStatus,
  type Program,
  type Routine,
  type Workout,
} from '@nutai/training'
import { ProgramInput, type ProgramInput as ProgramInputType } from '@nutai/core-schema'
import { buildResetSnapshot, buildSnapshot, type WidgetNextWorkoutInput } from '../data/widget-snapshot'
import { currentGoal, db, dayTotals, getDayStatus } from '../data/repo'
import { localDate } from '../data/date-utils'
import { subscribeFoodMutations } from '../data/food-mutations'

/** Native seam — the exact object the NutaiWidgets expo module exposes. */
interface NutaiWidgetsNativeModule {
  publish(json: string): void
}

let warnedOnce = false

function warnOnce(error: unknown): void {
  if (warnedOnce) return
  warnedOnce = true
  console.warn(
    '[widget] snapshot publish failed (the widget stays stale; the app is unaffected):',
    error instanceof Error ? error.message : error,
  )
}

function nativePublish(json: string): void {
  let nativeModule: NutaiWidgetsNativeModule
  try {
    nativeModule = requireNativeModule<NutaiWidgetsNativeModule>('NutaiWidgets')
  } catch {
    // Web, Expo Go, or a build without the module (prebuild not yet run).
    // Expected platform state — not a failure, never a warning.
    return
  }
  try {
    nativeModule.publish(json)
  } catch (error) {
    warnOnce(error) // the module exists but the publish failed — tell someone once
  }
}

/**
 * Today's training story, mirroring exactly how (tabs)/train.tsx derives its
 * cards: an unfinished (active) workout wins; otherwise the first program
 * whose schedule lands a session on `date` (listPrograms is name-ordered, so
 * "first" matches Train's first rendered card). Corrupt program rows are
 * skipped with the same guard train.tsx uses; a routine deleted after the
 * program was saved degrades to the same 'Routine' fallback Train prints.
 * Rest days / not-started / finished blocks → null: the widget stays silent
 * rather than inventing a workout. Programs schedule whole DAYS — the data
 * model has no session time-of-day — so `time` is null in v1, never fabricated.
 */
function nextScheduledWorkout(
  date: string,
  active: Workout | null,
  routines: Routine[],
  programs: Program[],
): WidgetNextWorkoutInput | null {
  if (active) return { name: active.name, time: null, kind: 'active' }
  for (const program of programs) {
    let plan: ProgramInputType | null = null
    try {
      plan = ProgramInput.parse(JSON.parse(program.definition_json))
    } catch {
      // Corrupt row — train.tsx renders an "unreadable" card; the widget skips.
    }
    if (!plan) continue
    const status = programDayStatus(plan, date)
    if (status.kind === 'scheduled') {
      return {
        name: routines.find((r) => r.id === status.routineId)?.name ?? 'Routine',
        time: null,
        kind: 'scheduled',
      }
    }
  }
  return null
}

/**
 * Gather everything the widget needs through the SAME readers the screens use
 * (never re-implement the arithmetic) and serialize it to the v1 JSON.
 *
 *   totals       repo dayTotals(date) — the exact read behind Home's ring
 *                (pending scans already contribute zero kcal there).
 *   target       repo currentGoal() — the same goal row Home's hero card
 *                renders (index.tsx loadData). No row → null → the widget
 *                shows its set-a-target state (§5.2: unknown ≠ zero).
 *   todayStatus  repo getDayStatus(date) → completion, 'unknown' when unset.
 *   nextWorkout  the training package's activeWorkout/programDayStatus.
 */
export async function gatherAsyncSnapshot(date?: string): Promise<string> {
  const now = Date.now()
  const day = date ?? localDate(now)
  const handle = await db()
  const [totals, goal, status, active, routines, programs] = await Promise.all([
    dayTotals(day),
    currentGoal(),
    getDayStatus(day),
    activeWorkout(handle),
    listRoutines(handle),
    listPrograms(handle),
  ])
  const target = goal ? { kcal: goal.targetKcal, proteinG: goal.protein_g } : null
  const nextWorkout = nextScheduledWorkout(day, active, routines, programs)
  const todayStatus = status?.completion ?? 'unknown'
  return JSON.stringify(buildSnapshot({ date: day, totals, target, nextWorkout, todayStatus, now }))
}

/**
 * Publish now (undebounced). All failures are silent no-ops — see the module
 * header. `date` pins the snapshot to a specific local day; default is today.
 */
export async function publishWidgetSnapshot(date?: string): Promise<void> {
  let json: string
  try {
    json = await gatherAsyncSnapshot(date)
  } catch (error) {
    warnOnce(error)
    return
  }
  nativePublish(json)
}

/**
 * The post-reset sentinel (repo.ts resetEverything): everything unknown,
 * todayStatus 'reset', stale true — the widget must show a blank/reset state,
 * never the wiped day's numbers (§5.2: unknown ≠ zero). Sync + undebounced.
 */
export function publishResetSnapshot(): void {
  nativePublish(JSON.stringify(buildResetSnapshot(localDate(Date.now()), Date.now())))
}

export const WIDGET_PUBLISH_DEBOUNCE_MS = 2_000

let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * The seam entry point for mutation events: coalesces a burst into ONE
 * trailing publish ~2s after the last event. Safe to call from anywhere,
 * any number of times, before or after `installWidgetPublishers`.
 */
export function scheduleWidgetPublish(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void publishWidgetSnapshot()
  }, WIDGET_PUBLISH_DEBOUNCE_MS)
}

/**
 * Install the event sources. Called ONCE from app/_layout.tsx on mount;
 * returns the unsubscribe function for the effect's cleanup.
 *
 *   - food mutations (repo.ts emitFoodMutation) — meals, custom foods,
 *     recipes, shortcuts, and the undo/redo paths that re-emit them.
 *   - workout writes (training onWorkoutsChanged, the O8 bus) — subscribed
 *     lazily because it needs the shared db handle; a workout write landing
 *     in the first ticks before the handle opens is covered by the self-heal.
 *   - AppState 'active' — the self-heal for paths that emit NO events:
 *     backup restore (raw table writes) and any missed write. One debounced
 *     publish on every foreground.
 */
export function installWidgetPublishers(): () => void {
  const offFood = subscribeFoodMutations(() => scheduleWidgetPublish())

  let offWorkouts: (() => void) | null = null
  void db()
    .then((handle) => {
      offWorkouts = onWorkoutsChanged(handle, () => scheduleWidgetPublish())
    })
    .catch((error) => warnOnce(error))

  const appState = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') scheduleWidgetPublish()
  })

  return () => {
    offFood()
    offWorkouts?.()
    appState.remove()
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }
}
