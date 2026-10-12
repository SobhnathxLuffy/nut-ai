import { beforeEach, describe, expect, it, vi } from 'vitest'

// Same mock pattern as tutorial.test.ts: the kv singleton is node-hostile.
vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}))

import Storage from 'expo-sqlite/kv-store'
import {
  THEME_PREFERENCE_KEY,
  parseThemePreference,
  readThemePreference,
  resolveColorScheme,
  writeThemePreference,
} from './preference'

describe('parseThemePreference', () => {
  it('accepts the two explicit overrides', () => {
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('dark')).toBe('dark')
  })

  it('system (and anything corrupt/missing) fails open to the old follow-the-OS behaviour', () => {
    expect(parseThemePreference('system')).toBe('system')
    expect(parseThemePreference(null)).toBe('system')
    expect(parseThemePreference(undefined)).toBe('system')
    expect(parseThemePreference('')).toBe('system')
    expect(parseThemePreference('LIGHT')).toBe('system')
    expect(parseThemePreference('{"a":1}')).toBe('system')
  })
})

describe('resolveColorScheme', () => {
  it('an explicit preference wins over the OS', () => {
    expect(resolveColorScheme('light', 'dark')).toBe('light')
    expect(resolveColorScheme('dark', 'light')).toBe('dark')
    expect(resolveColorScheme('light', null)).toBe('light')
    expect(resolveColorScheme('dark', null)).toBe('dark')
  })

  it('system follows the OS, with the non-dark contract of useColorScheme', () => {
    expect(resolveColorScheme('system', 'dark')).toBe('dark')
    expect(resolveColorScheme('system', 'light')).toBe('light')
    expect(resolveColorScheme('system', null)).toBe('light')
  })
})

describe('kv round trip', () => {
  beforeEach(() => {
    vi.mocked(Storage.getItem).mockReset()
    vi.mocked(Storage.setItem).mockReset()
  })

  it('reads through the ONE kv-store key', async () => {
    vi.mocked(Storage.getItem).mockResolvedValue('dark')
    await expect(readThemePreference()).resolves.toBe('dark')
    expect(Storage.getItem).toHaveBeenCalledWith(THEME_PREFERENCE_KEY)
  })

  it('writes the raw preference string', async () => {
    await writeThemePreference('light')
    expect(Storage.setItem).toHaveBeenCalledWith(THEME_PREFERENCE_KEY, 'light')
  })

  it('a corrupt stored value reads as system', async () => {
    vi.mocked(Storage.getItem).mockResolvedValue('banana')
    await expect(readThemePreference()).resolves.toBe('system')
  })
})
