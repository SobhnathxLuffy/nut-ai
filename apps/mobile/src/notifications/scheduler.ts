import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { ProgramInput } from '@nutai/core-schema'
import { listPrograms, listRoutines, type Program, type Routine } from '@nutai/training'
import { db } from '../data/repo'
import { localDate } from '../data/date-utils'
import { CATEGORIES, categoryById, type NotificationCategory, type NotificationCategoryId } from './categories'
import {
  dailyReminderIdentifier,
  dailyTrigger,
  dateTrigger,
  intervalTrigger,
  nextWorkoutSessions,
  parseHHMM,
  planIdsMatch,
  reminderIdentifier,
  staleIds,
  workoutReminderIdentifier,
  type DateReminderTrigger,
  type DailyReminderTrigger,
  type IntervalReminderTrigger,
} from './schedule'
import { readNotificationSettings } from './settings'
import { ensureNotificationPermission } from './permissions'

/**
 * The expo-notifications boundary + sync orchestrators (Task 3-b).
 *
 * Everything here is best-effort by contract: a scheduling failure must never
 * fail the action that triggered it (a set logged, a workout finished), so
 * every public sync swallows and reports nothing — the notification state is
 * re-derived on the next sync (app init, foreground, settings change, workout
 * write) from the settings table, which IS the durable source.
 *
 * DEDUPE (locked in schedule.test.ts): every notification gets a deterministic
 * identifier — `workout_reminder.<date>.<hhmm>`, `meal_reminder.<hhmm>`, … —
 * so re-running a sync with an unchanged plan is a native no-op (the id-set
 * guard), a changed plan cancels exactly the stale ids (prefix-scoped), and
 * nothing ever duplicates. The rest timer is a single cancel-and-replace slot.
 *
 * NOT persisted app-side on purpose: expo-notifications keeps its own native
 * schedule store; this module only ever re-derives from settings. After a
 * backup restore, a wipe, or an app reinstall on the same data, the next sync
 * rebuilds the identical plan.
 */

type ReminderTrigger = DailyReminderTrigger | IntervalReminderTrigger | DateReminderTrigger

interface PlannedNotification {
  id: string
  trigger: ReminderTrigger
  title: string
  body: string
  /** nutai:// deep link carried in the notification's data payload. */
  url: string
}

/** Categories that schedule themselves daily at a wall-clock time. */
const DAILY_CATEGORIES: readonly NotificationCategoryId[] = ['meal_reminder', 'weigh_in', 'daily_review']

/** Maps the pure literal-tag triggers onto expo-notifications' enum-typed inputs (same runtime values, one place). */
function toExpoTrigger(t: ReminderTrigger): Notifications.NotificationTriggerInput {
  switch (t.type) {
    case 'daily':
      return { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: t.hour, minute: t.minute, channelId: t.channelId }
    case 'timeInterval':
      return { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: t.seconds, repeats: false, channelId: t.channelId }
    case 'date':
      return { type: Notifications.SchedulableTriggerInputTypes.DATE, date: t.date, channelId: t.channelId }
  }
}

/** Creates the per-category Android channels (create-or-update, idempotent). Cheap; called before any schedule. */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return
  for (const c of CATEGORIES) {
    try {
      // The description is the one-sentence explainer Android shows under the
      // channel name in the OS settings sheet (T4-c P2-13).
      await Notifications.setNotificationChannelAsync(c.channelId, {
        name: c.channelName,
        description: c.channelDescription,
        importance: c.importance,
      })
    } catch {
      // Channel creation can fail on locked-down devices; scheduling will
      // still land in the app's default channel. Never worth crashing a flow.
    }
  }
}

/**
 * Applies one category's desired plan against what is actually scheduled:
 * cancels the category's stale ids, skips everything when the id set already
 * matches (so per-set workout writes cost one native read, not a reschedule).
 */
async function applyCategoryPlan(category: NotificationCategory, desired: readonly PlannedNotification[]): Promise<void> {
  if (Platform.OS === 'web') return
  const existing = await Notifications.getAllScheduledNotificationsAsync()
  const existingIds = existing.map((r) => r.identifier)
  const categoryPrefix = `${category.id}.`
  const ownedExisting = existingIds.filter((id) => id.startsWith(categoryPrefix))

  for (const id of staleIds(ownedExisting, desired.map((d) => d.id), [categoryPrefix])) {
    await Notifications.cancelScheduledNotificationAsync(id)
  }
  if (planIdsMatch(ownedExisting, desired.map((d) => d.id))) return

  await ensureChannels()
  for (const plan of desired) {
    await Notifications.scheduleNotificationAsync({
      identifier: plan.id,
      content: { title: plan.title, body: plan.body, data: { url: plan.url } },
      trigger: toExpoTrigger(plan.trigger),
    })
  }
}

/** Cancels every scheduled notification of one category (settings-disable path). */
async function cancelCategory(categoryId: NotificationCategoryId): Promise<void> {
  if (Platform.OS === 'web') return
  const existing = await Notifications.getAllScheduledNotificationsAsync()
  const prefix = `${categoryId}.`
  for (const id of existing.map((r) => r.identifier)) {
    if (id.startsWith(prefix)) await Notifications.cancelScheduledNotificationAsync(id)
  }
}

/**
 * REST TIMER — the in-flow completion signal.
 *
 * Called from the workout screen's three rest handlers and its finish/discard
 * paths. `restUntil` is the persisted workouts.rest_until epoch (null = rest
 * cancelled/over). This is also the CONTEXTUAL PERMISSION MOMENT: the first
 * rest of the first workout is when the user is actually about to want the
 * notification, which is exactly what the onboarding copy promises.
 */
export async function syncRestNotification(restUntil: number | null, workoutId: number): Promise<void> {
  if (Platform.OS === 'web') return
  const category = categoryById('rest_timer')
  try {
    // Cancel-then-schedule: the single slot can never duplicate, and the
    // trigger's `seconds` change on every adjust — no id-set guard here.
    await Notifications.cancelScheduledNotificationAsync(reminderIdentifier(category.id))
    if (restUntil == null) return
    const settings = await readNotificationSettings()
    if (!settings.master || !settings.enabled.rest_timer) return
    const seconds = Math.ceil((restUntil - Date.now()) / 1000)
    if (seconds < 1) return // already elapsed — the in-app chip covers it
    const permission = await ensureNotificationPermission()
    if (permission !== 'granted') return // denied: the chip stays the timer, we never nag
    await Notifications.scheduleNotificationAsync({
      identifier: reminderIdentifier(category.id),
      content: {
        title: category.title,
        body: category.body,
        data: { url: `${category.deepLink}?id=${workoutId}` },
      },
      trigger: toExpoTrigger(intervalTrigger(category.id, seconds)),
    })
  } catch {
    // Never fail the workout write path over a notification.
  }
}

/**
 * WORKOUT REMINDERS — derived from EXISTING program data only. Reads every
 * non-deleted program, keeps the ones that parse, and schedules the next
 * WORKOUT_REMINDER_HORIZON scheduled sessions at the configured time. If no
 * program schedules a session, nothing is reminded — sessions are never
 * invented.
 */
export async function syncWorkoutReminders(): Promise<void> {
  if (Platform.OS === 'web') return
  const category = categoryById('workout_reminder')
  try {
    const settings = await readNotificationSettings()
    if (!settings.master || !settings.enabled.workout_reminder) {
      await cancelCategory(category.id)
      return
    }
    const time = parseHHMM(settings.times.workout_reminder ?? '')
    if (!time) {
      await cancelCategory(category.id)
      return
    }
    const handle = await db()
    const [programRows, routines] = await Promise.all([listPrograms(handle), listRoutines(handle)])
    // Corrupt program rows are skipped honestly (same posture as the Train
    // tab's unreadable card) — one bad row must not mute every reminder.
    const programs = programRows.flatMap((row: Program) => {
      try {
        return [{ id: row.id, name: row.name, plan: ProgramInput.parse(JSON.parse(row.definition_json)) }]
      } catch {
        return []
      }
    })
    const routineNames = new Map<number, string>(routines.map((r: Routine) => [r.id, r.name]))
    const sessions = nextWorkoutSessions(programs, localDate(Date.now()), time, Date.now())
    const desired: PlannedNotification[] = sessions.map((session) => ({
      id: workoutReminderIdentifier(session.date, time),
      trigger: dateTrigger(category.id, session.fireAt),
      title: category.title,
      body: `${session.programName} — ${routineNames.get(session.routineId) ?? 'session'} is on the schedule.`,
      url: category.deepLink,
    }))
    await applyCategoryPlan(category, desired)
  } catch {
    // Best-effort: the plan re-derives on the next trigger.
  }
}

/**
 * The three wall-clock categories (meal / weigh-in / daily review) — one
 * daily repeating notification each, in the device timezone.
 */
export async function syncDailyReminders(): Promise<void> {
  if (Platform.OS === 'web') return
  try {
    const settings = await readNotificationSettings()
    for (const id of DAILY_CATEGORIES) {
      const category = categoryById(id)
      try {
        const time = settings.master && settings.enabled[id] ? parseHHMM(settings.times[id] ?? '') : null
        if (!time) {
          await cancelCategory(category.id)
          continue
        }
        await applyCategoryPlan(category, [
          {
            id: dailyReminderIdentifier(category.id, time),
            trigger: dailyTrigger(category.id, time.hour, time.minute),
            title: category.title,
            body: category.body,
            url: category.deepLink,
          },
        ])
      } catch {
        // One failing category never mutes the others.
      }
    }
  } catch {
    // Settings unreadable — leave the schedule untouched rather than cancel
    // everything on a transient DB error.
  }
}

/** Init/foreground/backup-restore re-sync: everything, guarded per category. */
export async function syncAllReminders(): Promise<void> {
  await syncDailyReminders()
  await syncWorkoutReminders()
}
