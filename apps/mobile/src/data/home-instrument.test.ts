import { describe, expect, it } from 'vitest'
import {
  CHECKIN_LOCK_MS,
  SLOT_GUIDE_SHARE,
  SLOT_LABELS,
  SLOT_ORDER,
  adaptiveTargetView,
  dayStripFlags,
  dayStripOffsets,
  parseCheckinAcceptedAt,
  shortDate,
  slotGuide,
} from './home-instrument'

/**
 * UI/UX report §8.2 (Wave 3) — the Home instrument's pure derivations.
 *
 * These functions run under bare Node (the file has ZERO React Native
 * imports), so the state machine, the slot-guide arithmetic and the strip
 * flags get real unit tests; the screen wiring is pinned separately by the
 * wave3-home source sweep.
 */

const NOW = 1_754_300_000_000

describe('slotGuide — remaining by meal slot (press-for-detail)', () => {
  it('derives each slot from an even quarter of the day target', () => {
    const rows = slotGuide(2_000, {})
    expect(rows).toHaveLength(4)
    expect(SLOT_ORDER).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
    for (const r of rows) {
      expect(r.loggedKcal).toBe(0)
      expect(r.guideLeftKcal).toBe(500) // 2000 × 0.25
      expect(r.over).toBe(false)
    }
    expect(SLOT_GUIDE_SHARE).toBe(0.25)
  })

  it('subtracts what was actually logged in each slot', () => {
    const rows = slotGuide(1_600, { breakfast: 300, dinner: 470.4 })
    const bySlot = Object.fromEntries(rows.map((r) => [r.slot, r]))
    expect(bySlot.breakfast.guideLeftKcal).toBe(100) // 400 − 300
    expect(bySlot.breakfast.loggedKcal).toBe(300)
    expect(bySlot.dinner.guideLeftKcal).toBe(-70) // 400 − 470.4 → rounded
    expect(bySlot.dinner.over).toBe(true)
    expect(bySlot.lunch.guideLeftKcal).toBe(400)
  })

  it('flags a slot over its guide without scolding — the number says "over"', () => {
    const rows = slotGuide(1_000, { snack: 900 })
    const snack = rows.find((r) => r.slot === 'snack')!
    expect(snack.over).toBe(true)
    expect(snack.guideLeftKcal).toBe(-650)
  })

  it('ignores keys the guide does not know (unslotted stays the caller’s problem)', () => {
    const rows = slotGuide(1_000, { unslotted: 500, weird: 100 })
    for (const r of rows) {
      expect(r.loggedKcal).toBe(0)
      expect(r.guideLeftKcal).toBe(250)
    }
  })

  it('labels are human words, never snake_case keys', () => {
    const rows = slotGuide(1, {})
    expect(rows.map((r) => r.label)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks'])
    expect(SLOT_LABELS.breakfast).toBe('Breakfast')
  })

  it('negative logged values are clamped — a slot cannot log below zero', () => {
    const rows = slotGuide(1_000, { breakfast: -50 })
    expect(rows[0]!.loggedKcal).toBe(0)
    expect(rows[0]!.guideLeftKcal).toBe(250)
  })

  it('rounds to whole kcal — the guide never renders false precision', () => {
    const rows = slotGuide(1_000, { breakfast: 100.4 })
    expect(rows[0]!.loggedKcal).toBe(100)
    expect(rows[0]!.guideLeftKcal).toBe(150)
  })
})

describe('adaptiveTargetView — the card state machine (§8.2)', () => {
  it('fixed: a hand-set target says so calmly and stops', () => {
    const view = adaptiveTargetView({ adaptive: false, checkinAcceptedAt: null, surfaced: false, now: NOW })
    expect(view.state).toBe('fixed')
    expect(view.detail).toBe('You set this by hand, so it stays exactly where you put it.')
    expect(view.detail).not.toMatch(/warn|careful|error/i)
  })

  it('locked: a check-in inside the 7-day window holds the target, with dates', () => {
    const accepted = NOW - 2 * 86_400_000
    const view = adaptiveTargetView({ adaptive: true, checkinAcceptedAt: accepted, surfaced: false, now: NOW })
    expect(view.state).toBe('locked')
    expect(view.detail).toContain(shortDate(accepted))
    expect(view.detail).toContain(shortDate(accepted + CHECKIN_LOCK_MS))
    expect(view.detail).toMatch(/It holds until/)
  })

  it('locked is EXCLUSIVE to the current row’s evidence — a hand override on top of a check-in is fixed', () => {
    // adaptive=0 rows are written by overrideTargets — even if an earlier
    // adaptive row exists, the card must describe the target IN FORCE.
    const view = adaptiveTargetView({
      adaptive: false,
      checkinAcceptedAt: NOW - 86_400_000,
      surfaced: false,
      now: NOW,
    })
    expect(view.state).toBe('fixed')
  })

  it('stable returns once the cooldown window has passed', () => {
    const accepted = NOW - CHECKIN_LOCK_MS - 1
    const view = adaptiveTargetView({ adaptive: true, checkinAcceptedAt: accepted, surfaced: false, now: NOW })
    expect(view.state).toBe('stable')
  })

  it('the boundary is exactly 7 days: at the edge it is still locked', () => {
    const accepted = NOW - (CHECKIN_LOCK_MS - 1)
    const view = adaptiveTargetView({ adaptive: true, checkinAcceptedAt: accepted, surfaced: false, now: NOW })
    expect(view.state).toBe('locked')
  })

  it('stable: adaptive target with no check-in reads calm, never like a warning', () => {
    const view = adaptiveTargetView({ adaptive: true, checkinAcceptedAt: null, surfaced: false, now: NOW })
    expect(view.state).toBe('stable')
    expect(view.detail).toMatch(/changes only when you accept a check-in/)
  })

  it('stable prefers the estimator’s own reason when it ships one', () => {
    const view = adaptiveTargetView(
      { adaptive: true, checkinAcceptedAt: null, surfaced: false, now: NOW },
      { reason: 'Review weekly check-in suggestions in Progress. Targets change only after you accept.' },
    )
    expect(view.state).toBe('stable')
    expect(view.detail).toBe('Review weekly check-in suggestions in Progress. Targets change only after you accept.')
  })

  it('adjusting: a surfaced change states the new target and its explanation', () => {
    const view = adaptiveTargetView(
      { adaptive: true, checkinAcceptedAt: null, surfaced: true, now: NOW },
      { newKcal: 2_350, explanation: 'Trend up 0.3 kg over 3 weeks.' },
    )
    expect(view.state).toBe('adjusting')
    expect(view.detail).toBe('Adjusted to 2350 kcal. Trend up 0.3 kg over 3 weeks.')
  })

  it('adjusting without an explanation still reads complete', () => {
    const view = adaptiveTargetView(
      { adaptive: true, checkinAcceptedAt: null, surfaced: true, now: NOW },
      {},
    )
    expect(view.state).toBe('adjusting')
    expect(view.detail).toBe('Adjusted to 0 kcal, from your own trend and intake.')
  })

  it('no state copy leans on the safety/warning colour vocabulary', () => {
    const states = [
      adaptiveTargetView({ adaptive: false, checkinAcceptedAt: null, surfaced: false, now: NOW }),
      adaptiveTargetView({ adaptive: true, checkinAcceptedAt: NOW - 86_400_000, surfaced: false, now: NOW }),
      adaptiveTargetView({ adaptive: true, checkinAcceptedAt: null, surfaced: false, now: NOW }),
      adaptiveTargetView({ adaptive: true, checkinAcceptedAt: null, surfaced: true, now: NOW }, { newKcal: 10 }),
    ]
    for (const s of states) {
      expect(s.detail).not.toMatch(/warn|danger|careful|missed|fail/i)
    }
  })
})

describe('dayStripFlags — today-pulse and future-dim (§8.2)', () => {
  it('today is exactly offset 0', () => {
    expect(dayStripFlags(0)).toEqual({ today: true, future: false })
  })

  it('every day after today is future — dimmed and disabled', () => {
    for (const off of [1, 2, 6, 55]) {
      expect(dayStripFlags(off)).toEqual({ today: false, future: true })
    }
  })

  it('history is neither today nor future', () => {
    for (const off of [-1, -7, -49]) {
      expect(dayStripFlags(off)).toEqual({ today: false, future: false })
    }
  })
})

describe('dayStripOffsets — the 56-day window', () => {
  it('renders 56 entries ending inside the current week, today included', () => {
    const days = dayStripOffsets(new Date('2026-08-19T10:00:00')) // a Wednesday
    expect(days).toHaveLength(56)
    expect(days).toContain(0)
    // 8 Monday-first weeks: the window starts on a Monday at most 49 back.
    expect(days[0]).toBeLessThanOrEqual(-49)
    expect(days[0]).toBeGreaterThan(-56)
    // The current week renders WHOLE — up to 6 future days exist and are
    // future-dimmed (Wednesday: today + Thu/Fri/Sat/Sun = 4 days ahead).
    expect(days[days.length - 1]).toBe(4)
  })

  it('on a Sunday the window ends exactly at today — no future days', () => {
    const days = dayStripOffsets(new Date('2026-08-23T10:00:00')) // a Sunday
    expect(days[days.length - 1]).toBe(0)
    expect(days.every((o) => o <= 0)).toBe(true)
  })
})

describe('parseCheckinAcceptedAt — evidence reading is fail-closed', () => {
  it('reads accepted_at from a check-in evidence blob', () => {
    expect(parseCheckinAcceptedAt(JSON.stringify({ local_date: '2026-08-19', accepted_at: NOW, metrics: {} }))).toBe(NOW)
  })

  it('null for absent, empty, malformed, or non-numeric evidence', () => {
    expect(parseCheckinAcceptedAt(null)).toBeNull()
    expect(parseCheckinAcceptedAt(undefined)).toBeNull()
    expect(parseCheckinAcceptedAt('')).toBeNull()
    expect(parseCheckinAcceptedAt('not json')).toBeNull()
    expect(parseCheckinAcceptedAt('{}')).toBeNull()
    expect(parseCheckinAcceptedAt(JSON.stringify({ accepted_at: 'yesterday' }))).toBeNull()
  })
})

describe('shortDate — deterministic, locale-free', () => {
  it('renders month word + day', () => {
    expect(shortDate(new Date('2026-08-05T12:00:00').getTime())).toBe('Aug 5')
    expect(shortDate(new Date('2026-01-31T12:00:00').getTime())).toBe('Jan 31')
  })
})
