import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import { listPrograms, listRoutines } from '@nutai/training'
import { ensureNotificationPermission } from './permissions'

/**
 * Task 3-b — the expo-notifications boundary, locked through the DI seam the
 * repo already uses for expo modules (vi.mock, cf. haptics.test.ts).
 *
 * What is proven here, at the module's public interface:
 * - the rest timer is a single cancel-and-replace slot whose trigger is the
 *   persisted rest_until epoch, gated by master switch, category switch,
 *   permission and elapsed-time;
 * - workout reminders derive ONLY from real program rows, dedupe by
 *   deterministic ids (no-op guard), cancel stale ids and never invent
 *   sessions;
 * - the daily categories produce exactly one repeating trigger each, and a
 *   disabled/master-off state cancels instead of scheduling.
 */

vi.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DAILY: 'daily', TIME_INTERVAL: 'timeInterval', DATE: 'date' },
  getAllScheduledNotificationsAsync: vi.fn(async () => []),
  cancelScheduledNotificationAsync: vi.fn(async () => {}),
  scheduleNotificationAsync: vi.fn(async () => 'id'),
  setNotificationChannelAsync: vi.fn(async () => null),
}))

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))

vi.mock('../data/repo', () => ({
  db: vi.fn(async () => ({})),
  setting: vi.fn(async () => ''),
  putSetting: vi.fn(async () => {}),
}))

vi.mock('@nutai/training', () => ({
  listPrograms: vi.fn(async () => []),
  listRoutines: vi.fn(async () => []),
}))

vi.mock('./permissions', () => ({ ensureNotificationPermission: vi.fn(async () => 'granted') }))

import {
  syncDailyReminders,
  syncRestNotification,
  syncWorkoutReminders,
} from './scheduler'
import { putSetting, setting } from '../data/repo'

const scheduleMock = vi.mocked(Notifications.scheduleNotificationAsync)
const cancelMock = vi.mocked(Notifications.cancelScheduledNotificationAsync)
const getAllMock = vi.mocked(Notifications.getAllScheduledNotificationsAsync)
const settingMock = vi.mocked(setting)
const permissionMock = vi.mocked(ensureNotificationPermission)

/** Settings-table stand-in: values map, everything else falls back to '' (→ documented defaults). */
const settingsRows: Record<string, string> = {}
const programRow = (definition: unknown) => [{ id: 1, name: 'Block A', definition_json: JSON.stringify(definition) }]
const mondayProgram = { name: 'Block A', start_date: '2026-09-28', weeks: 8, schedule: [{ day: 0, routine_id: 11 }] }

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(settingsRows)) delete settingsRows[key]
  settingMock.mockImplementation(async (key: string, fallback?: string) => settingsRows[key] ?? fallback)
  getAllMock.mockResolvedValue([])
  permissionMock.mockResolvedValue('granted')
  vi.mocked(listPrograms).mockResolvedValue([])
  vi.mocked(listRoutines).mockResolvedValue([])
  vi.mocked(putSetting).mockResolvedValue(undefined)
})

describe('syncRestNotification — the single cancel-and-replace slot', () => {
  it('cancels on null (skip/finish/discard) and never schedules', async () => {
    await syncRestNotification(null, 7)
    expect(cancelMock).toHaveBeenCalledWith('rest_timer.current')
    expect(scheduleMock).not.toHaveBeenCalled()
  })

  it('schedules one non-repeating interval trigger with the workout deep link', async () => {
    const restUntil = Date.now() + 90_000
    await syncRestNotification(restUntil, 7)
    expect(scheduleMock).toHaveBeenCalledTimes(1)
    const request = scheduleMock.mock.calls[0]![0]
    expect(request.identifier).toBe('rest_timer.current')
    expect(request.content.title).toBe('Rest complete')
    expect(request.content.data).toEqual({ url: 'nutai://workout?id=7' })
    const trigger = request.trigger as { type: string; seconds: number; repeats: boolean; channelId: string }
    expect(trigger.type).toBe('timeInterval')
    expect(trigger.channelId).toBe('rest_timer')
    expect(trigger.repeats).toBe(false)
    expect(trigger.seconds).toBeGreaterThanOrEqual(89)
    expect(trigger.seconds).toBeLessThanOrEqual(90)
  })

  it('is gated by the master switch', async () => {
    settingsRows['notifications.enabled'] = 'off'
    await syncRestNotification(Date.now() + 90_000, 7)
    expect(cancelMock).toHaveBeenCalled()
    expect(scheduleMock).not.toHaveBeenCalled()
  })

  it('is gated by the category switch', async () => {
    settingsRows['notifications.restTimer'] = 'off'
    await syncRestNotification(Date.now() + 90_000, 7)
    expect(scheduleMock).not.toHaveBeenCalled()
  })

  it('never schedules when permission is denied (the chip stays the timer)', async () => {
    permissionMock.mockResolvedValue('denied')
    await syncRestNotification(Date.now() + 90_000, 7)
    expect(scheduleMock).not.toHaveBeenCalled()
  })

  it('never schedules a rest that already elapsed', async () => {
    await syncRestNotification(Date.now() - 5_000, 7)
    expect(scheduleMock).not.toHaveBeenCalled()
  })
})

describe('syncWorkoutReminders — derived from real program rows only', () => {
  it('schedules one notification per upcoming session with a deterministic id', async () => {
    settingsRows['notifications.workoutReminders'] = 'on'
    settingsRows['notifications.workoutTime'] = '08:00'
    vi.mocked(listPrograms).mockResolvedValue(programRow(mondayProgram) as never)
    vi.mocked(listRoutines).mockResolvedValue([{ id: 11, name: 'Push day', definition_json: '' }] as never)
    await syncWorkoutReminders()
    expect(scheduleMock).toHaveBeenCalledTimes(7) // the horizon
    const first = scheduleMock.mock.calls[0]![0]
    expect(first.identifier).toMatch(/^workout_reminder\.\d{4}-\d{2}-\d{2}\.0800$/)
    expect(first.content.body).toContain('Block A')
    expect(first.content.body).toContain('Push day')
    expect(first.content.data).toEqual({ url: 'nutai://train' })
    const trigger = first.trigger as { type: string; date: number; channelId: string }
    expect(trigger.type).toBe('date')
    expect(trigger.channelId).toBe('workout_reminder')
  })

  it('is a no-op when the same plan is already scheduled (per-set writes must not churn)', async () => {
    settingsRows['notifications.workoutReminders'] = 'on'
    settingsRows['notifications.workoutTime'] = '08:00'
    vi.mocked(listPrograms).mockResolvedValue(programRow(mondayProgram) as never)
    await syncWorkoutReminders()
    const scheduledIds = scheduleMock.mock.calls.map((c) => c[0].identifier)
    scheduleMock.mockClear()
    getAllMock.mockResolvedValue(scheduledIds.map((identifier) => ({ identifier })) as never)
    await syncWorkoutReminders()
    expect(scheduleMock).not.toHaveBeenCalled()
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('cancels ids that fell out of the plan (program edited/deleted)', async () => {
    settingsRows['notifications.workoutReminders'] = 'on'
    settingsRows['notifications.workoutTime'] = '08:00'
    getAllMock.mockResolvedValue([
      { identifier: 'workout_reminder.2026-01-01.0800' },
      { identifier: 'workout_reminder.2030-01-01.0800' },
    ] as never)
    await syncWorkoutReminders()
    expect(cancelMock).toHaveBeenCalledWith('workout_reminder.2026-01-01.0800')
    expect(cancelMock).toHaveBeenCalledWith('workout_reminder.2030-01-01.0800')
  })

  it('cancels everything when the category or master switch is off', async () => {
    settingsRows['notifications.workoutReminders'] = 'off'
    getAllMock.mockResolvedValue([{ identifier: 'workout_reminder.2026-01-01.0800' }] as never)
    await syncWorkoutReminders()
    expect(cancelMock).toHaveBeenCalledWith('workout_reminder.2026-01-01.0800')
    expect(scheduleMock).not.toHaveBeenCalled()
  })

  it('skips corrupt program rows honestly instead of throwing or inventing sessions', async () => {
    settingsRows['notifications.workoutReminders'] = 'on'
    vi.mocked(listPrograms).mockResolvedValue([
      { id: 2, name: 'Broken', definition_json: '{not json' },
    ] as never)
    await syncWorkoutReminders()
    expect(scheduleMock).not.toHaveBeenCalled()
  })
})

describe('syncDailyReminders — one repeating trigger per enabled category', () => {
  it('schedules meal/weigh-in/daily-review daily triggers at their configured times', async () => {
    settingsRows['notifications.mealReminders'] = 'on'
    settingsRows['notifications.weighIn'] = 'on'
    settingsRows['notifications.dailyReview'] = 'on'
    await syncDailyReminders()
    expect(scheduleMock).toHaveBeenCalledTimes(3)
    const byChannel = scheduleMock.mock.calls.map((c) => c[0])
    const meal = byChannel.find((r) => r.identifier === 'meal_reminder.1230')!
    expect(meal).toBeDefined()
    expect((meal.trigger as { type: string; hour: number; minute: number; channelId: string })).toEqual({
      type: 'daily',
      hour: 12,
      minute: 30,
      channelId: 'meal_reminder',
    })
    expect(byChannel.some((r) => r.identifier === 'weigh_in.0730')).toBe(true)
    expect(byChannel.some((r) => r.identifier === 'daily_review.2030')).toBe(true)
    expect(byChannel.find((r) => r.identifier === 'daily_review.2030')!.content.data).toEqual({ url: 'nutai://checkin' })
  })

  it('cancels the categories that stay disabled', async () => {
    settingsRows['notifications.mealReminders'] = 'on'
    getAllMock.mockResolvedValue([{ identifier: 'daily_review.2030' }, { identifier: 'meal_reminder.1200' }] as never)
    await syncDailyReminders()
    // The old 12:00 meal trigger is stale (default is 12:30) and the disabled
    // daily-review trigger is gone; the enabled one is (re)scheduled.
    expect(cancelMock).toHaveBeenCalledWith('daily_review.2030')
    expect(cancelMock).toHaveBeenCalledWith('meal_reminder.1200')
    expect(scheduleMock).toHaveBeenCalledTimes(1)
    expect(scheduleMock.mock.calls[0]![0].identifier).toBe('meal_reminder.1230')
  })

  it('schedules nothing when the master switch is off', async () => {
    settingsRows['notifications.enabled'] = 'off'
    settingsRows['notifications.mealReminders'] = 'on'
    await syncDailyReminders()
    expect(scheduleMock).not.toHaveBeenCalled()
  })
})
