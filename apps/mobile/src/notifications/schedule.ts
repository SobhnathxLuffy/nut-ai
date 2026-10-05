import type { ProgramInput } from '@nutai/core-schema'

/**
 * Pure scheduling maths for the local notification system (Task 3-b).
 *
 * NO expo-notifications, NO React Native — this file is importable under bare
 * Node so the dedupe logic, trigger shapes and workout-session derivation are
 * locked by plain vitest (schedule.test.ts). The expo boundary that consumes
 * these values lives in scheduler.ts.
 *
 * TIMEZONE + DST, stated once and honestly:
 * - All wall-clock values ('HH:MM', local dates) are interpreted in the
 *   DEVICE's current timezone via the JS Date constructor — on Android,
 *   expo-notifications' own `daily`/`date` triggers do exactly the same
 *   (DailyTrigger.nextTriggerDate uses Calendar.getInstance() = device zone;
 *   the `timezone` field of calendar triggers is iOS-only, and iOS is not
 *   shipped for notifications yet).
 * - DST caveat: wall-clock reminders follow the clock, not the sun — a 08:00
 *   reminder stays 08:00 across a DST shift (an hour earlier/later UTC). On
 *   spring-forward days a wall-clock time that does not exist resolves to the
 *   next real instant (JS Date semantics: 02:30 → 03:30). The in-app rest
 *   chip is the precise timer; scheduled notifications use inexact alarms on
 *   Android 12+ without SCHEDULE_EXACT_ALARM (not requested — keeps the
 *   manifest minimal and F-Droid clean), so delivery may drift by a minute.
 */

/** One notification id per category slot — rescheduling the same id never duplicates. */
export const WORKOUT_REMINDER_ID_PREFIX = 'workout_reminder.'

/** How many upcoming program sessions stay scheduled ahead (Android alarm budget is ~500; 7 keeps weeks of cover with a tiny footprint). */
export const WORKOUT_REMINDER_HORIZON = 7

/**
 * 'HH:MM' 24h wall-clock parser. Strict: two digits, a colon, two digits,
 * 00–23 / 00–59. Returns null for anything else so corrupt settings rows fall
 * back to defaults instead of throwing.
 */
export function parseHHMM(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/** Deterministic id for a single-slot (cancel-and-replace) reminder — the rest timer. */
export function reminderIdentifier(categoryId: string): string {
  return `${categoryId}.current`
}

/** Compact no-colon form of a parsed time, for embedding in identifiers. */
function timeToken(time: { hour: number; minute: number }): string {
  return `${String(time.hour).padStart(2, '0')}${String(time.minute).padStart(2, '0')}`
}

/**
 * Deterministic id for the workout reminder of one local date AT one fire
 * time — the time is PART of the id, so a settings-time change produces new
 * ids: the old trigger is cancelled as stale and the new one scheduled, and
 * an unchanged plan keeps identical ids (the no-op guard skips the reschedule).
 */
export function workoutReminderIdentifier(localDate: string, time: { hour: number; minute: number }): string {
  return `${WORKOUT_REMINDER_ID_PREFIX}${localDate}.${timeToken(time)}`
}

/** Same embed-the-time rule for the daily wall-clock categories (meal / weigh-in / daily review). */
export function dailyReminderIdentifier(categoryId: string, time: { hour: number; minute: number }): string {
  return `${categoryId}.${timeToken(time)}`
}

/**
 * Ids we own (by prefix) that are NOT in the desired plan — the ones a
 * reschedule must cancel (a program edited/deleted, a horizon that moved on).
 */
export function staleIds(existing: readonly string[], desired: readonly string[], ownedPrefixes: readonly string[]): string[] {
  const wanted = new Set(desired)
  return existing.filter((id) => ownedPrefixes.some((p) => id.startsWith(p)) && !wanted.has(id))
}

/** Set-equality of two id plans — the cheap no-op guard so per-set workout writes don't churn the scheduler. */
export function planIdsMatch(existing: readonly string[], desired: readonly string[]): boolean {
  const a = new Set(existing)
  const b = new Set(desired)
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

// --- Trigger builders (shapes match expo-notifications' public trigger inputs) ---

export interface DailyReminderTrigger {
  type: 'daily'
  hour: number
  minute: number
  channelId: string
}

export interface IntervalReminderTrigger {
  type: 'timeInterval'
  seconds: number
  repeats: false
  channelId: string
}

export interface DateReminderTrigger {
  type: 'date'
  date: number
  channelId: string
}

/** Repeats daily at device-local wall-clock hour:minute (OS rolls it forward; DST follows the clock). */
export function dailyTrigger(categoryId: string, hour: number, minute: number): DailyReminderTrigger {
  return { type: 'daily', hour, minute, channelId: categoryId }
}

/** Fires once, `seconds` from now — the rest-timer completion signal. */
export function intervalTrigger(categoryId: string, seconds: number): IntervalReminderTrigger {
  return { type: 'timeInterval', seconds, repeats: false, channelId: categoryId }
}

/** Fires once at the given epoch — one workout-reminder per scheduled session date. */
export function dateTrigger(categoryId: string, epoch: number): DateReminderTrigger {
  return { type: 'date', date: epoch, channelId: categoryId }
}

/** Device-local epoch for a local date ('YYYY-MM-DD') at the given wall-clock time. */
export function localEpoch(localDate: string, time: { hour: number; minute: number }): number {
  const [y, m, d] = localDate.split('-').map(Number)
  // Same rule as packages/training weekdayOfLocalDate: build from parts, never
  // `new Date(bareString)` (whose UTC reading shifts days behind UTC− zones).
  return new Date(y!, m! - 1, d!, time.hour, time.minute, 0, 0).getTime()
}

// --- Workout-reminder derivation from EXISTING program data ---

export interface ProgramForReminders {
  id: number
  name: string
  plan: ProgramInput
}

export interface NextWorkoutSession {
  /** Local date of the session ('YYYY-MM-DD'). */
  date: string
  routineId: number
  programId: number
  programName: string
  /** Device-local epoch of the reminder fire time (session date at the configured HH:MM). */
  fireAt: number
}

/**
 * The next scheduled sessions across ALL programs, one reminder per date,
 * strictly in the future, capped at WORKOUT_REMINDER_HORIZON (or `limit`).
 *
 * Honest limits, on purpose:
 * - Sessions come ONLY from program schedules (scheduledRoutine semantics:
 *   cycle day = (date − start_date) % 7, within weeks*7 of the start). If no
 *   program covers a day there is NO reminder — empty workouts are never
 *   invented.
 * - Dates before the program start are scanned too, so a program starting
 *   next Monday gets its Monday reminder.
 * - Rolling forward happens when the app is open (init + onWorkoutsChanged +
 *   foreground re-sync): the horizon is a week+, so reminders keep firing
 *   between visits. No background task is used.
 */
export function nextWorkoutSessions(
  programs: readonly ProgramForReminders[],
  today: string,
  reminderTime: { hour: number; minute: number },
  now: number,
  limit: number = WORKOUT_REMINDER_HORIZON,
): NextWorkoutSession[] {
  const byDate = new Map<string, NextWorkoutSession>()
  for (const program of programs) {
    const startMs = Date.parse(program.plan.start_date)
    if (Number.isNaN(startMs)) continue
    // Scan from today to the furthest date any program can still schedule.
    const endMs = Math.max(startMs + program.plan.weeks * 7 * 86400000 - 1, startMs)
    const todayMs = Date.parse(today)
    if (Number.isNaN(todayMs)) continue
    for (let day = todayMs; day <= endMs; day += 86400000) {
      const date = dayToLocalDate(day)
      const fireAt = localEpoch(date, reminderTime)
      if (fireAt <= now) continue // today already past the reminder hour
      const existing = byDate.get(date)
      if (existing) continue // one reminder per date; first program wins
      // Same cycle-day math as packages/training scheduledRoutine.
      const daysFromStart = Math.round((day - startMs) / 86400000)
      if (daysFromStart < 0 || daysFromStart >= program.plan.weeks * 7) continue
      const scheduled = program.plan.schedule.find((s) => s.day === daysFromStart % 7)
      if (!scheduled) continue
      byDate.set(date, {
        date,
        routineId: scheduled.routine_id,
        programId: program.id,
        programName: program.name,
        fireAt,
      })
    }
  }
  return [...byDate.values()].sort((a, b) => a.fireAt - b.fireAt).slice(0, limit)
}

/** Epoch-ms of a UTC noon → 'YYYY-MM-DD' in UTC — day arithmetic that never lands on the wrong side of a DST boundary. */
function dayToLocalDate(epochMs: number): string {
  const d = new Date(epochMs)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${mm}-${dd}`
}
