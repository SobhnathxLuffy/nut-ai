import { describe, expect, it } from 'vitest'
import { CATEGORIES, notificationCategories } from './categories'
import { DEEP_LINK_ROUTES, resolveDeepLink } from '../navigation/deep-links'

/**
 * Task 3-b — the category registry is the single source every other
 * notifications module reads: channel ids, settings keys, deep links,
 * defaults. The registry completeness test keeps the map honest: if a
 * category is added without a channel, a settings key or a resolvable deep
 * link, this fails before any device can find out the hard way.
 */

describe('the notification category registry', () => {
  it('contains exactly the five planned categories', () => {
    expect(CATEGORIES.map((c) => c.id).sort()).toEqual([
      'daily_review',
      'meal_reminder',
      'rest_timer',
      'weigh_in',
      'workout_reminder',
    ])
  })

  it('every category has id, channel id/name/description/importance, settings key, deep link and copy', () => {
    for (const c of notificationCategories()) {
      expect(c.id.length).toBeGreaterThan(0)
      expect(c.channelId).toBe(c.id) // one Android channel per category
      expect(c.channelName.length).toBeGreaterThan(0)
      // T4-c P2-13: the OS channel settings sheet shows a user-readable sentence.
      expect(c.channelDescription.length).toBeGreaterThan(20)
      expect(c.channelDescription.endsWith('.')).toBe(true)
      expect([2, 5, 6]).toContain(c.importance) // AndroidImportance: 2 NONE, 5 DEFAULT, 6 HIGH
      expect(c.settingsKey).toMatch(/^notifications\./)
      expect(c.deepLink.startsWith('nutai://')).toBe(true)
      expect(c.title.length).toBeGreaterThan(0)
      expect(c.body.length).toBeGreaterThan(0)
    }
  })

  it('exactly one category ships ON by default (rest timer) — the others wait for the user', () => {
    const on = CATEGORIES.filter((c) => c.defaultEnabled)
    expect(on.map((c) => c.id)).toEqual(['rest_timer'])
  })

  it('every scheduled-by-time category has a time key + a valid default time; rest timer has none', () => {
    for (const c of CATEGORIES) {
      if (c.id === 'rest_timer') {
        expect(c.timeKey).toBeNull()
        expect(c.defaultTime).toBeNull()
      } else {
        expect(c.timeKey).toMatch(/^notifications\./)
        expect(c.defaultTime).toMatch(/^\d{2}:\d{2}$/)
      }
    }
  })

  it('settings keys are unique and deep links all resolve through the alias map', () => {
    const keys = CATEGORIES.map((c) => c.settingsKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const c of CATEGORIES) {
      expect(resolveDeepLink(c.deepLink)).not.toBeNull()
      expect(DEEP_LINK_ROUTES.some((r) => r.route === resolveDeepLink(c.deepLink))).toBe(true)
    }
  })
})
