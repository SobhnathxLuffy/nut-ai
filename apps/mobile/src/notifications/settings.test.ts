import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { putSetting, setting } from '../data/repo'

/**
 * Task 3-b — the notification settings store lives in the EXISTING settings
 * key-value table (AGENTS §10: no new persisted store, nothing new to
 * migrate or back up — the table is already covered by backup rules). The
 * scheduled-notification state itself is NOT persisted app-side: it lives in
 * expo-notifications' own native store, derived on demand from these keys.
 */

vi.mock('../data/repo', () => ({
  setting: vi.fn(async () => ''),
  putSetting: vi.fn(async () => {}),
}))

import {
  defaultNotificationSettings,
  readNotificationSettings,
  writeCategoryEnabled,
  writeCategoryTime,
  writeMaster,
} from './settings'
import { CATEGORIES } from './categories'

const settingMock = vi.mocked(setting)
const putSettingMock = vi.mocked(putSetting)

beforeEach(() => {
  vi.clearAllMocks()
  // Empty rows → every read falls back to the documented default.
  settingMock.mockResolvedValue('')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('defaults — honest by design', () => {
  it('master switch defaults ON, but every spam-capable reminder defaults OFF', async () => {
    const s = defaultNotificationSettings()
    expect(s.master).toBe(true)
    expect(s.enabled.workout_reminder).toBe(false)
    expect(s.enabled.meal_reminder).toBe(false)
    expect(s.enabled.weigh_in).toBe(false)
    expect(s.enabled.daily_review).toBe(false)
    // The rest-timer completion alert is part of a workout the user already
    // started — an in-flow confirmation, not a nudge. Safe default ON.
    expect(s.enabled.rest_timer).toBe(true)
  })

  it('every category has a default time string when it is time-scheduled; rest timer has none', () => {
    const s = defaultNotificationSettings()
    for (const c of CATEGORIES) {
      if (c.timeKey) expect(s.times[c.id]).toMatch(/^\d{2}:\d{2}$/)
      else expect(s.times[c.id]).toBeUndefined()
    }
  })
})

describe('persistence round-trip', () => {
  it('readNotificationSettings falls back to defaults for absent rows and parses stored values', async () => {
    settingMock.mockImplementation(async (key: string, fallback?: string) => {
      if (key === 'notifications.workoutReminders') return 'on'
      if (key === 'notifications.workoutTime') return '09:15'
      return fallback ?? ''
    })
    const s = await readNotificationSettings()
    expect(s.master).toBe(true)
    expect(s.enabled.workout_reminder).toBe(true)
    expect(s.enabled.meal_reminder).toBe(false)
    expect(s.times.workout_reminder).toBe('09:15')
  })

  it('a corrupt stored toggle or time falls back to the default rather than throwing', async () => {
    settingMock.mockImplementation(async (key: string, fallback?: string) => {
      if (key === 'notifications.mealReminders') return 'maybe'
      if (key === 'notifications.mealTime') return 'garbage'
      return fallback ?? ''
    })
    const s = await readNotificationSettings()
    expect(s.enabled.meal_reminder).toBe(false)
    expect(s.times.meal_reminder).toBe(defaultNotificationSettings().times.meal_reminder)
  })

  it('writeCategoryEnabled writes the registry key with on/off', async () => {
    await writeCategoryEnabled('weigh_in', true)
    expect(putSettingMock).toHaveBeenCalledWith('notifications.weighIn', 'on')
    await writeCategoryEnabled('weigh_in', false)
    expect(putSettingMock).toHaveBeenCalledWith('notifications.weighIn', 'off')
  })

  it('writeCategoryTime validates the HH:MM format before writing', async () => {
    await writeCategoryTime('meal_reminder', '18:30')
    expect(putSettingMock).toHaveBeenCalledWith('notifications.mealTime', '18:30')
    await expect(writeCategoryTime('meal_reminder', '6pm')).rejects.toThrow()
    expect(putSettingMock).toHaveBeenCalledTimes(1)
  })

  it('writeMaster writes notifications.enabled', async () => {
    await writeMaster(false)
    expect(putSettingMock).toHaveBeenCalledWith('notifications.enabled', 'off')
  })
})
