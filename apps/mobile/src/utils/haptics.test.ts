import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Haptics from 'expo-haptics'
import { putSetting, setting } from '../data/repo'

/**
 * UI/UX report §9.1 / Table 9.2 (Wave 1c) — the haptics wrapper's contract.
 *
 * Every event fires exactly ONE expo-haptics pattern, the settings toggle
 * (`haptics_enabled`, default on) disables all of them, and a throwing
 * engine can never fail the action that earned the haptic.
 */

vi.mock('expo-haptics', () => ({
  selectionAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}))

vi.mock('../data/repo', () => ({
  setting: vi.fn(async () => 'on'),
  putSetting: vi.fn(async () => {}),
}))

import {
  __hapticsCacheForTests,
  __resetHapticsForTests,
  HAPTICS_SETTING_KEY,
  error,
  lightImpact,
  selectionAsync,
  setHapticsEnabled,
  success,
  warning,
} from './haptics'

const notification = vi.mocked(Haptics.notificationAsync)
const impact = vi.mocked(Haptics.impactAsync)
const selection = vi.mocked(Haptics.selectionAsync)
const settingMock = vi.mocked(setting)
const putSettingMock = vi.mocked(putSetting)

beforeEach(() => {
  vi.clearAllMocks()
  settingMock.mockResolvedValue('on')
  __resetHapticsForTests()
})

afterEach(() => {
  __resetHapticsForTests()
})

describe('Table 9.2 — each event fires its own pattern', () => {
  it('log success → notificationAsync(Success)', async () => {
    await success()
    expect(notification).toHaveBeenCalledTimes(1)
    expect(notification).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success)
    expect(impact).not.toHaveBeenCalled()
  })

  it('complete a set / shutter → impactAsync(Light)', async () => {
    await lightImpact()
    expect(impact).toHaveBeenCalledTimes(1)
    expect(impact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light)
  })

  it('destructive confirm → notificationAsync(Warning)', async () => {
    await warning()
    expect(notification).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Warning)
  })

  it('action failed → notificationAsync(Error)', async () => {
    await error()
    expect(notification).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error)
  })

  it('value change → selectionAsync()', async () => {
    await selectionAsync()
    expect(selection).toHaveBeenCalledTimes(1)
  })
})

describe('the settings guard — haptics_enabled, default on, read once', () => {
  it('the toggle is read once and cached across calls', async () => {
    await success()
    await lightImpact()
    await warning()
    expect(settingMock).toHaveBeenCalledTimes(1)
    expect(settingMock).toHaveBeenCalledWith(HAPTICS_SETTING_KEY, 'on')
  })

  it("'off' disables every pattern", async () => {
    settingMock.mockResolvedValue('off')
    await success()
    await lightImpact()
    await warning()
    await error()
    await selectionAsync()
    expect(notification).not.toHaveBeenCalled()
    expect(impact).not.toHaveBeenCalled()
    expect(selection).not.toHaveBeenCalled()
    expect(__hapticsCacheForTests()).toBe(false)
  })

  it('an unreadable setting falls back to the documented default (on)', async () => {
    settingMock.mockRejectedValue(new Error('db locked'))
    await success()
    expect(notification).toHaveBeenCalledTimes(1)
  })

  it('setHapticsEnabled persists the value and updates the cache', async () => {
    await success() // caches the initial 'on' read
    await setHapticsEnabled(false)
    expect(putSettingMock).toHaveBeenCalledWith(HAPTICS_SETTING_KEY, 'off')
    expect(__hapticsCacheForTests()).toBe(false)
    await success()
    expect(notification).toHaveBeenCalledTimes(1) // the warm-up call, no new one
  })
})

describe('a failing engine never fails the action', () => {
  it('a throwing haptic call resolves silently', async () => {
    notification.mockRejectedValueOnce(new Error('no haptic engine'))
    await expect(success()).resolves.toBeUndefined()
    // The next call still works — one failure poisons nothing.
    await expect(success()).resolves.toBeUndefined()
    expect(notification).toHaveBeenCalledTimes(2)
  })
})
