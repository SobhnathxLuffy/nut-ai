import { describe, expect, it } from 'vitest'
import {
  buildResetSnapshot,
  buildSnapshot,
  isStale,
  WIDGET_DEEP_LINKS,
  WIDGET_SNAPSHOT_VERSION,
  WIDGET_STALE_AFTER_MS,
  type WidgetSnapshotJson,
} from './widget-snapshot'
import { DEEP_LINK_ROUTES, DEEP_LINK_SCHEME, resolveDeepLink } from '../navigation/deep-links'
import type { DayTotals } from './repo'

/**
 * T3-c (Android home-screen widget) — the snapshot serializer contract.
 *
 * This is the EXACT v1 JSON the native NutaiWidgets module renders (see the
 * fixed contract in src/widgets/publish.ts). Two honesty rules are locked
 * here because the widget renders without the app to explain itself:
 *
 *   §5.2 unknown ≠ zero — no goal row → kcalTarget/kcalRemaining are NULL
 *   (the native side shows the set-a-target state), never 0.
 *
 *   Pending scans are already zero-kcal in DayTotals (repo.ts dayTotals) —
 *   the v1 schema is frozen and has no pendingCount key, so the count is
 *   deliberately NOT carried into the JSON (documented in widget-snapshot.ts).
 */

const NOW = 1_754_300_000_000

/** The EXACT v1 key list, in contract order (the native module parses this). */
const V1_KEYS = [
  'v',
  'revision',
  'generatedAt',
  'date',
  'stale',
  'kcalEaten',
  'kcalRemaining',
  'kcalOver',
  'kcalTarget',
  'proteinG',
  'proteinTargetG',
  'todayStatus',
  'nextWorkoutName',
  'nextWorkoutTime',
  'nextWorkoutKind',
] as const

function totals(overrides: Partial<DayTotals> = {}): DayTotals {
  return {
    kcal: 1520.4,
    protein_g: 88.6,
    fat_g: 40,
    carbs_g: 150,
    mealCount: 3,
    distinctSlots: 2,
    pendingCount: 0,
    ...overrides,
  }
}

type SnapshotOverrides = Partial<Parameters<typeof buildSnapshot>[0]>

function snapshot(overrides: SnapshotOverrides = {}): WidgetSnapshotJson {
  return buildSnapshot({
    date: '2025-08-04',
    totals: totals(),
    target: { kcal: 2400, proteinG: 150 },
    nextWorkout: { name: 'Push Day', time: null, kind: 'scheduled' },
    todayStatus: 'partial',
    now: NOW,
    ...overrides,
  })
}

describe('widget snapshot serializer (schema v1)', () => {
  it('serializes EXACTLY the v1 keys, in contract order', () => {
    expect(Object.keys(snapshot())).toEqual(V1_KEYS)
    expect(Object.keys(buildResetSnapshot('2025-08-04', NOW))).toEqual(V1_KEYS)
  })

  it('happy path — the day Home renders, transported as JSON', () => {
    const s = snapshot()
    expect(s.v).toBe(WIDGET_SNAPSHOT_VERSION)
    expect(s.v).toBe(1)
    expect(s.date).toBe('2025-08-04')
    expect(s.generatedAt).toBe(NOW)
    expect(s.stale).toBe(false)
    // Raw sums are floats; the widget shows what Home shows: rounded.
    expect(s.kcalEaten).toBe(1520) // 1520.4
    expect(s.proteinG).toBe(89) // 88.6
    // remaining = target - eaten on the RAW numbers, then rounded (879.6 → 880)
    expect(s.kcalRemaining).toBe(880)
    expect(s.kcalOver).toBe(false)
    expect(s.kcalTarget).toBe(2400)
    expect(s.proteinTargetG).toBe(150)
    expect(s.todayStatus).toBe('partial')
    expect(s.nextWorkoutName).toBe('Push Day')
    expect(s.nextWorkoutTime).toBeNull()
    expect(s.nextWorkoutKind).toBe('scheduled')
  })

  it('round-trips through JSON.stringify without undefined/NaN leakage', () => {
    const s = snapshot()
    const back = JSON.parse(JSON.stringify(s)) as WidgetSnapshotJson
    expect(back).toEqual(s)
  })

  it('no target set → kcalTarget/proteinTargetG/kcalRemaining are NULL, NOT zeros (AGENTS §5.2)', () => {
    const s = snapshot({ target: null })
    expect(s.kcalTarget).toBeNull()
    expect(s.proteinTargetG).toBeNull()
    expect(s.kcalRemaining).toBeNull()
    // "not over a target that does not exist" — a boolean, never null.
    expect(s.kcalOver).toBe(false)
    // Eaten is still KNOWN — only the target is missing.
    expect(s.kcalEaten).toBe(1520)
    expect(s.proteinG).toBe(89)
  })

  it('no totals (post-reset) → eaten/protein are NULL too', () => {
    const s = snapshot({ totals: null })
    expect(s.kcalEaten).toBeNull()
    expect(s.proteinG).toBeNull()
    expect(s.kcalRemaining).toBeNull()
  })

  it('over target mirrors Home: over decided on the RAW remaining, value carried signed', () => {
    // Home (index.tsx): remaining = targetKcal - kcal; over = remaining < 0;
    // the label shows Math.abs(Math.round(remaining)). The JSON carries the
    // signed rounded value + the over flag; the pre-round sign decides.
    const over = snapshot({ target: { kcal: 1500, proteinG: 100 } })
    expect(over.kcalOver).toBe(true)
    expect(over.kcalRemaining).toBe(-20) // 1500 - 1520.4

    // Boundary: a fraction UNDER the target must not flip over by rounding.
    const justUnder = snapshot({ target: { kcal: 1520.6, proteinG: 150 }, totals: totals({ kcal: 1520.4 }) })
    expect(justUnder.kcalOver).toBe(false)
    expect(justUnder.kcalRemaining).toBe(0) // raw +0.2, rounds to 0 — never -0

    // A fraction OVER stays over (raw sign decides, pre-round)…
    const hairOver = snapshot({ target: { kcal: 1520, proteinG: 150 }, totals: totals({ kcal: 1520.4 }) })
    expect(hairOver.kcalOver).toBe(true)
    expect(hairOver.kcalRemaining).toBe(0) // raw -0.4 rounds to 0 — and never serializes as -0

    // …and a full kcal over carries the negative remaining the widget abs()es.
    const justOver = snapshot({ target: { kcal: 1520, proteinG: 150 }, totals: totals({ kcal: 1521.4 }) })
    expect(justOver.kcalOver).toBe(true)
    expect(justOver.kcalRemaining).toBe(-1) // 1520 - 1521.4 = -1.4 → -1
  })

  it('exactly at target → remaining 0, not over', () => {
    const s = snapshot({ target: { kcal: 1520, proteinG: 150 }, totals: totals({ kcal: 1520 }) })
    expect(s.kcalOver).toBe(false)
    expect(s.kcalRemaining).toBe(0)
  })

  it('pending scans never enter the JSON — zero-kcal honesty lives in DayTotals', () => {
    // dayTotals counts pending scans in pendingCount but adds ZERO kcal. The
    // v1 schema is frozen (exact keys), so pendingCount is carried in the
    // input type but deliberately not serialized — the widget can only show
    // completed totals, and they are already honest.
    const s = snapshot({ totals: totals({ pendingCount: 3, kcal: 100 }) })
    expect(Object.keys(s)).toEqual(V1_KEYS)
    expect(JSON.stringify(s)).not.toContain('pending')
    expect(s.kcalEaten).toBe(100)
  })

  it('nextWorkout absent → the three fields are null, not invented', () => {
    const s = snapshot({ nextWorkout: null })
    expect(s.nextWorkoutName).toBeNull()
    expect(s.nextWorkoutTime).toBeNull()
    expect(s.nextWorkoutKind).toBeNull()
  })

  it('revision is a strictly increasing per-process integer (best-effort ordering only)', () => {
    const a = snapshot()
    const b = snapshot()
    expect(Number.isInteger(a.revision)).toBe(true)
    expect(Number.isInteger(b.revision)).toBe(true)
    expect(b.revision).toBeGreaterThan(a.revision)
  })
})

describe('widget staleness — isStale (26h rule)', () => {
  const H = 3_600_000
  it('STALE_AFTER_MS is 26 hours', () => {
    expect(WIDGET_STALE_AFTER_MS).toBe(26 * H)
  })

  it('fresh at 0s, 25h59m, and exactly 26h (strictly greater than)', () => {
    expect(isStale(NOW, NOW)).toBe(false)
    expect(isStale(NOW, NOW + 25 * H + 59 * 60_000)).toBe(false)
    expect(isStale(NOW, NOW + 26 * H)).toBe(false)
  })

  it('stale one millisecond and one minute past 26h', () => {
    expect(isStale(NOW, NOW + 26 * H + 1)).toBe(true)
    expect(isStale(NOW, NOW + 26 * H + 60_000)).toBe(true) // 26h01m
  })
})

describe('reset sentinel snapshot', () => {
  it('everything unknown, todayStatus "reset", stale — never the pre-reset numbers', () => {
    const r = buildResetSnapshot('2025-08-04', NOW)
    expect(r).toEqual({
      v: 1,
      revision: expect.any(Number),
      generatedAt: NOW,
      date: '2025-08-04',
      stale: true,
      kcalEaten: null,
      kcalRemaining: null,
      kcalOver: false,
      kcalTarget: null,
      proteinG: null,
      proteinTargetG: null,
      todayStatus: 'reset',
      nextWorkoutName: null,
      nextWorkoutTime: null,
      nextWorkoutKind: null,
    })
  })
})

describe('widget deep links — the real map, not a copy', () => {
  it('covers exactly the five widget tap targets', () => {
    expect(Object.keys(WIDGET_DEEP_LINKS).sort()).toEqual(['home', 'log', 'scan', 'train', 'weight'])
  })

  it('every widget link resolves through the REAL deep-links table', () => {
    expect(DEEP_LINK_SCHEME).toBe('nutai')
    for (const [alias, url] of Object.entries(WIDGET_DEEP_LINKS)) {
      expect(url).toBe(`nutai://${alias}`)
      const entry = DEEP_LINK_ROUTES.find((r) => r.path === alias)
      // The alias must still exist in deep-links.ts — if it is renamed or
      // removed there, this fails before the native module ships a dead link.
      expect(entry, `deep-links.ts lost the '${alias}' alias`).toBeDefined()
      expect(resolveDeepLink(url)).toBe(entry!.route)
    }
  })
})
