import { describe, expect, it } from 'vitest'
import { ProgramInput, type ProgramInput as ProgramInputType } from '@nutai/core-schema'
import {
  dailyReminderIdentifier,
  dailyTrigger,
  dateTrigger,
  intervalTrigger,
  localEpoch,
  nextWorkoutSessions,
  parseHHMM,
  planIdsMatch,
  reminderIdentifier,
  staleIds,
  workoutReminderIdentifier,
  WORKOUT_REMINDER_HORIZON,
} from './schedule'

/**
 * Task 3-b — the pure scheduling maths behind the local notification system.
 *
 * Everything here is node-pure (no expo-notifications, no React Native): the
 * expo boundary (scheduler.ts) receives triggers and identifier sets these
 * helpers build, so the dedupe/derivation logic is locked in plain-Node
 * vitest while the native side stays mocked (repo pattern: haptics).
 */

describe('parseHHMM', () => {
  it('accepts valid 24h wall-clock strings', () => {
    expect(parseHHMM('08:00')).toEqual({ hour: 8, minute: 0 })
    expect(parseHHMM('00:00')).toEqual({ hour: 0, minute: 0 })
    expect(parseHHMM('23:59')).toEqual({ hour: 23, minute: 59 })
  })

  it('rejects malformed or out-of-range values with null', () => {
    expect(parseHHMM('')).toBeNull()
    expect(parseHHMM('8am')).toBeNull()
    expect(parseHHMM('24:00')).toBeNull()
    expect(parseHHMM('07:60')).toBeNull()
    expect(parseHHMM('-1:30')).toBeNull()
    expect(parseHHMM('7:5')).toBeNull()
    expect(parseHHMM('07:30 ')).toBeNull()
  })
})

describe('reminder identifiers — dedupe keys', () => {
  it('derives deterministic ids: single-slot categories share one id, scheduled ones embed their time', () => {
    expect(reminderIdentifier('rest_timer')).toBe('rest_timer.current')
    expect(reminderIdentifier('rest_timer')).toBe(reminderIdentifier('rest_timer'))
    expect(workoutReminderIdentifier('2026-10-05', { hour: 8, minute: 0 })).toBe('workout_reminder.2026-10-05.0800')
    expect(dailyReminderIdentifier('meal_reminder', { hour: 12, minute: 30 })).toBe('meal_reminder.1230')
  })

  it('changing the reminder time changes the id — the stale trigger is cancelled, never duplicated', () => {
    const before = workoutReminderIdentifier('2026-10-05', { hour: 8, minute: 0 })
    const after = workoutReminderIdentifier('2026-10-05', { hour: 9, minute: 15 })
    expect(before).not.toBe(after)
    expect(staleIds([before, 'unrelated.x'], [after], ['workout_reminder.'])).toEqual([before])
  })

  it('every id starts with its category id so prefix cancellation works', () => {
    expect(reminderIdentifier('rest_timer').startsWith('rest_timer.')).toBe(true)
    expect(workoutReminderIdentifier('2026-10-05', { hour: 8, minute: 0 }).startsWith('workout_reminder.')).toBe(true)
    expect(dailyReminderIdentifier('weigh_in', { hour: 7, minute: 30 }).startsWith('weigh_in.')).toBe(true)
  })

  it('staleIds returns only ids we own that are no longer wanted', () => {
    const existing = [
      'workout_reminder.2026-10-05',
      'workout_reminder.2026-10-07',
      'meal_reminder.current',
      'unrelated.widget',
    ]
    expect(staleIds(existing, ['workout_reminder.2026-10-07', 'meal_reminder.current'], ['workout_reminder.', 'meal_reminder.', 'rest_timer.']))
      .toEqual(['workout_reminder.2026-10-05'])
  })

  it('planIdsMatch compares as sets regardless of order or duplicates', () => {
    expect(planIdsMatch(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(planIdsMatch(['a', 'a', 'b'], ['b', 'a'])).toBe(true)
    expect(planIdsMatch(['a'], ['a', 'b'])).toBe(false)
    expect(planIdsMatch([], [])).toBe(true)
  })
})

describe('trigger builders', () => {
  it('daily trigger carries wall-clock hour/minute and the category channel', () => {
    expect(dailyTrigger('meal_reminder', 12, 30)).toEqual({
      type: 'daily',
      hour: 12,
      minute: 30,
      channelId: 'meal_reminder',
    })
  })

  it('interval trigger never repeats and carries the channel', () => {
    expect(intervalTrigger('rest_timer', 90)).toEqual({
      type: 'timeInterval',
      seconds: 90,
      repeats: false,
      channelId: 'rest_timer',
    })
  })

  it('date trigger fires once at the given epoch with the channel', () => {
    expect(dateTrigger('workout_reminder', 1759700000000)).toEqual({
      type: 'date',
      date: 1759700000000,
      channelId: 'workout_reminder',
    })
  })
})

describe('localEpoch — device-local wall clock to epoch', () => {
  it('converts a local date + HH:MM to the matching local instant', () => {
    // The sandbox TZ is UTC, so 2026-10-05T08:30 local == 08:30Z.
    const epoch = localEpoch('2026-10-05', { hour: 8, minute: 30 })
    const shown = new Date(epoch)
    expect(shown.getFullYear()).toBe(2026)
    expect(shown.getMonth()).toBe(9)
    expect(shown.getDate()).toBe(5)
    expect(shown.getHours()).toBe(8)
    expect(shown.getMinutes()).toBe(30)
  })
})

describe('nextWorkoutSessions — derivation from existing program data', () => {
  const plan = (schedule: { day: number; routine_id: number }[], start: string, weeks: number): ProgramInputType =>
    ProgramInput.parse({ name: 'Block A', start_date: start, weeks, schedule })

  // 2026-10-05 is a Monday. Cycle day 0 = start date.
  const mondayProgram = plan([{ day: 0, routine_id: 11 }, { day: 3, routine_id: 12 }], '2026-09-28', 8)

  it('returns the next scheduled sessions strictly in the future, capped by the horizon', () => {
    // Thursday 2026-10-08 09:00 — today is a scheduled day (cycle day 3) and
    // the reminder hour (17:30) is still ahead, so today leads the list.
    const now = localEpoch('2026-10-08', { hour: 9, minute: 0 })
    const sessions = nextWorkoutSessions(
      [{ id: 1, name: 'Block A', plan: mondayProgram }],
      '2026-10-08',
      { hour: 17, minute: 30 },
      now,
    )
    expect(sessions.slice(0, 3).map((s) => s.date)).toEqual(['2026-10-08', '2026-10-12', '2026-10-15'])
    expect(sessions.every((s) => s.routineId === 11 || s.routineId === 12)).toBe(true)
  })

  it('includes TODAY when the reminder time has not passed yet', () => {
    const now = localEpoch('2026-10-12', { hour: 7, minute: 0 })
    const sessions = nextWorkoutSessions(
      [{ id: 1, name: 'Block A', plan: mondayProgram }],
      '2026-10-12',
      { hour: 17, minute: 30 },
      now,
    )
    expect(sessions[0]?.date).toBe('2026-10-12')
    expect(sessions[0]?.fireAt).toBe(localEpoch('2026-10-12', { hour: 17, minute: 30 }))
  })

  it('skips TODAY when the reminder time already passed (never fires in the past)', () => {
    const now = localEpoch('2026-10-12', { hour: 18, minute: 0 })
    const sessions = nextWorkoutSessions(
      [{ id: 1, name: 'Block A', plan: mondayProgram }],
      '2026-10-12',
      { hour: 17, minute: 30 },
      now,
    )
    expect(sessions.map((s) => s.date)).not.toContain('2026-10-12')
  })

  it('returns sessions that are BEFORE the program start date (a program starting next week is reminded)', () => {
    const futureProgram = plan([{ day: 0, routine_id: 21 }], '2026-10-19', 4)
    const sessions = nextWorkoutSessions(
      [{ id: 2, name: 'Next block', plan: futureProgram }],
      '2026-10-12',
      { hour: 8, minute: 0 },
      localEpoch('2026-10-12', { hour: 6, minute: 0 }),
    )
    expect(sessions.map((s) => s.date)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'])
    expect(sessions.every((s) => s.routineId === 21)).toBe(true)
  })

  it('never invents sessions: no program or a rest-day-only program yields an empty list', () => {
    expect(nextWorkoutSessions([], '2026-10-12', { hour: 8, minute: 0 }, 0)).toEqual([])
    // rest days only, and the 2-week block already ran out before today —
    // nothing in the window is scheduled, so nothing is reminded.
    const restProgram = plan([{ day: 1, routine_id: 31 }], '2026-09-28', 2)
    expect(
      nextWorkoutSessions([{ id: 3, name: 'R', plan: restProgram }], '2026-10-12', { hour: 8, minute: 0 }, 0),
    ).toEqual([])
  })

  it('merges multiple programs chronologically and dedupes one reminder per date', () => {
    const otherProgram = plan([{ day: 1, routine_id: 41 }], '2026-09-28', 8)
    const sessions = nextWorkoutSessions(
      [
        { id: 1, name: 'Block A', plan: mondayProgram },
        { id: 2, name: 'Block B', plan: otherProgram },
      ],
      '2026-10-12',
      { hour: 8, minute: 0 },
      localEpoch('2026-10-12', { hour: 6, minute: 0 }),
      10,
    )
    // Mon 10-12 (both programs) once, Tue 10-13, Wed 10-14, … merged, deduped by date.
    const dates = sessions.map((s) => s.date)
    expect(new Set(dates).size).toBe(dates.length)
    expect(dates[0]).toBe('2026-10-12')
    expect(dates).toContain('2026-10-13')
  })

  it('caps the returned sessions at the default horizon', () => {
    const dailyProgram = plan(
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, routine_id: 50 + day })),
      '2026-10-12',
      8,
    )
    const sessions = nextWorkoutSessions(
      [{ id: 1, name: 'Daily', plan: dailyProgram }],
      '2026-10-12',
      { hour: 8, minute: 0 },
      localEpoch('2026-10-12', { hour: 6, minute: 0 }),
    )
    expect(sessions).toHaveLength(WORKOUT_REMINDER_HORIZON)
  })
})
