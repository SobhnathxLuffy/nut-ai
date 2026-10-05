import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import type { ScanResult } from '@nutai/pipeline'

/**
 * T3-c — the widget publisher (src/widgets/publish.ts), tested at its two real
 * seams:
 *
 *   1. the NATIVE module boundary — `requireNativeModule('NutaiWidgets')` is
 *      mocked, so every assertion below is against the exact JSON the native
 *      module would receive (`publish(json: string)`).
 *   2. the REPO layer — the real repo.ts/training functions run against an
 *      in-memory DB (@nutai/db-adapter/node), the same production-path pattern
 *      as repo-invariants.test.ts. No snapshot math is duplicated in these
 *      tests; the numbers asserted come from logMeal/saveProgram writes.
 *
 * The web/native-absence behaviour is locked too: a missing module must be a
 * SILENT no-op (expected on web and before prebuild), while a real failure
 * (DB, native publish) warns exactly once per process and never rejects.
 */

const state = vi.hoisted(() => ({
  database: null as unknown,
  dbFail: false,
  nativeAbsent: false,
  publishThrows: false,
  published: [] as string[],
  appStateListener: null as ((s: string) => void) | null,
}))

vi.mock('expo-modules-core', () => ({
  requireNativeModule: (moduleName: string) => {
    if (moduleName !== 'NutaiWidgets' || state.nativeAbsent) {
      throw new Error(`Cannot find native module '${moduleName}'`)
    }
    return {
      publish: (json: string) => {
        if (state.publishThrows) throw new Error('native publish failed')
        state.published.push(json)
      },
    }
  },
}))

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: (s: string) => void) => {
      state.appStateListener = listener
      return { remove: () => { state.appStateListener = null } }
    },
  },
}))

vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}))

vi.mock('../db/expo-adapter', () => ({
  openUserDb: async () => {
    if (state.dbFail) throw new Error('db unavailable')
    return state.database as DbAdapter
  },
}))

vi.mock('../inference/credentials', () => ({ clearCredential: vi.fn() }))

import { discardWorkout, listExercises, saveProgram, saveRoutine, startWorkout } from '@nutai/training'
import { emitFoodMutation } from '../data/food-mutations'
import { logMeal, logWeight, setDayStatus } from '../data/repo'
import {
  installWidgetPublishers,
  publishResetSnapshot,
  publishWidgetSnapshot,
  scheduleWidgetPublish,
  WIDGET_PUBLISH_DEBOUNCE_MS,
} from './publish'

const NOW = 1_754_300_000_000
// localDate(NOW) in UTC — the repo's localDate is test-stable in the CI TZ
// (same convention as repo-invariants.test.ts).
const TODAY = new Date(NOW).toISOString().slice(0, 10)

let database: DbAdapter

function scanResult(name: string, grams: number, kcal: number): ScanResult {
  const ingredient: IngredientRow = {
    id: `ingredient-${name}`,
    displayName: name,
    sourceFoodId: '42',
    grams,
    nutrientSnapshot: {
      kcal, protein_g: 7, fat_g: 3, carbs_g: 18,
      fiber_g: 5, sugar_g: 2, sodium_mg: 250,
    },
    origin: 'vision_model',
    gramPathway: 'fndds_standard_portion',
    bandHalfPct: 0.2,
    isEstimate: false,
    assumptions: [],
  }
  const meal: LoggedMeal = {
    id: `meal-${name}`, loggedAt: new Date(NOW).toISOString(), ingredients: [ingredient],
    portionEatenFraction: 1, engineId: 'test', promptVersion: 'p1', schemaVersion: 's1',
    clampFlags: [],
  }
  return {
    isFood: true, refusalReason: null, meal,
    items: [{ row: ingredient, band: { halfPct: 0.2, tier: 'moderate', reasons: [] }, resolution: 'auto_accept', gramPathway: ingredient.gramPathway }],
    totals: { kcal: kcal * grams / 100, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
    mealBand: { halfPct: 0.2, tier: 'moderate', reasons: [] },
    questions: [], clampFlags: [], zeroHitCount: 0,
  }
}

const SCAN_META = { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500, costUsd: 0.0009 }

beforeAll(async () => {
  database = openMemoryDb()
  await database.exec('PRAGMA foreign_keys = ON;')
  await migrate(database, NOW)
  state.database = database
})

beforeEach(() => {
  // Fresh wire per test — earlier tests' publishes must not leak into counts.
  state.published = []
  state.dbFail = false
  state.nativeAbsent = false
  state.publishThrows = false
  state.appStateListener = null
})

afterAll(async () => {
  await database.close()
})

function lastJson(): Record<string, unknown> {
  expect(state.published.length).toBeGreaterThan(0)
  return JSON.parse(state.published[state.published.length - 1]!) as Record<string, unknown>
}

describe('failure no-ops — the app must never crash for a cosmetic widget', () => {
  it('a DB failure never rejects, publishes nothing, and warns exactly ONCE per process', async () => {
    state.dbFail = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(publishWidgetSnapshot()).resolves.toBeUndefined()
      expect(state.published).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
      // A second failure stays silent — one warning, not a broken log.
      await expect(publishWidgetSnapshot()).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      state.dbFail = false
      warn.mockRestore()
    }
  })

  it('a native publish failure never rejects and later publishes still work', async () => {
    // NOTE: the once-per-PROCESS warn budget was consumed by the DB-failure
    // test above (the flag is module state by design — one warning, ever).
    // This test locks the other half of the contract: no rejection, no
    // publish, no ADDITIONAL warning, and recovery afterwards.
    state.publishThrows = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(publishWidgetSnapshot(TODAY)).resolves.toBeUndefined()
      expect(state.published).toHaveLength(0)
      expect(warn).not.toHaveBeenCalled()
      state.publishThrows = false
      await publishWidgetSnapshot(TODAY)
      expect(state.published).toHaveLength(1)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('a MISSING native module (web, Expo Go, prebuild not yet run) is an expected SILENT no-op', async () => {
    state.nativeAbsent = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(publishWidgetSnapshot()).resolves.toBeUndefined()
      expect(state.published).toHaveLength(0)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('gather — the real repository path (in-memory user.db)', () => {
  it('serializes the day the way Home computes it: totals from dayTotals, targets from currentGoal, status from getDayStatus', async () => {
    // 150 kcal + 7 g protein per 100 g, 200 g portion → 300 kcal / 14 g.
    await logMeal(scanResult('Dal', 200, 150), SCAN_META, null, NOW)
    // Stand the goal up the way onboarding would (home-reads.test.ts precedent):
    await database.run(
      `INSERT INTO goals
         (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
          floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive,
          uuid, created_at, updated_at, revision, deleted_at, sync_state)
       VALUES (?,?,?,?,?,0,?,?,?,?,?,1,'base-goal',?,?,1,null,'local')`,
      [NOW, 'lose', 0.5, 2_400, 2_450, 150, 65, 270, 1_650, 2_400, NOW, NOW],
    )
    await setDayStatus({ localDate: TODAY, completion: 'partial', now: NOW })
    // A weigh-in too — the log-weight seam's write must never break the publish.
    await logWeight(72.5, NOW)

    await publishWidgetSnapshot(TODAY)
    const json = lastJson()
    expect(json.v).toBe(1)
    expect(json.date).toBe(TODAY)
    expect(json.kcalEaten).toBe(300)
    expect(json.kcalTarget).toBe(2400)
    expect(json.kcalRemaining).toBe(2100)
    expect(json.kcalOver).toBe(false)
    expect(json.proteinG).toBe(14)
    expect(json.proteinTargetG).toBe(150)
    expect(json.todayStatus).toBe('partial')
    expect(json.generatedAt).toBeGreaterThan(0)
    expect(json.revision).toBeGreaterThan(0)
    expect(json.stale).toBe(false)
    // No program and no active workout yet.
    expect(json.nextWorkoutName).toBeNull()
    expect(json.nextWorkoutKind).toBeNull()
  })

  it('no goal row → target/remaining NULL (the set-a-target state), eaten still known', async () => {
    await database.run('DELETE FROM goals')
    await publishWidgetSnapshot(TODAY)
    const json = lastJson()
    expect(json.kcalTarget).toBeNull()
    expect(json.proteinTargetG).toBeNull()
    expect(json.kcalRemaining).toBeNull()
    expect(json.kcalOver).toBe(false)
    expect(json.kcalEaten).toBe(300)
  })

  it('a program scheduled today → nextWorkout kind "scheduled" with the routine name, time null (programs have no time-of-day)', async () => {
    const exercise = (await listExercises(database))[0]!
    const routineId = await saveRoutine(database, {
      name: 'Push Day',
      exercises: [{ exercise_id: exercise.id, sets: [{ load_kg: 40, reps: 8 }], rule: { kind: 'double' } }],
    })
    await saveProgram(database, {
      name: 'Base Block',
      start_date: TODAY,
      weeks: 4,
      schedule: [{ day: 0, routine_id: routineId }],
    })
    await publishWidgetSnapshot(TODAY)
    const json = lastJson()
    expect(json.nextWorkoutKind).toBe('scheduled')
    expect(json.nextWorkoutName).toBe('Push Day')
    expect(json.nextWorkoutTime).toBeNull()
  })

  it('an active workout wins over the program (kind "active")', async () => {
    const id = await startWorkout(database, TODAY, 'Evening Session', NOW + 1_000)
    await publishWidgetSnapshot(TODAY)
    const json = lastJson()
    expect(json.nextWorkoutKind).toBe('active')
    expect(json.nextWorkoutName).toBe('Evening Session')
    await discardWorkout(database, id, NOW + 2_000)
  })

  it('no program and no active workout → the widget stays silent (nothing invented)', async () => {
    await database.run('DELETE FROM programs')
    await publishWidgetSnapshot(TODAY)
    const json = lastJson()
    expect(json.nextWorkoutName).toBeNull()
    expect(json.nextWorkoutTime).toBeNull()
    expect(json.nextWorkoutKind).toBeNull()
  })
})

describe('reset sentinel', () => {
  it('publishResetSnapshot emits all-null / todayStatus "reset" / stale true', () => {
    publishResetSnapshot()
    const json = lastJson()
    expect(json).toEqual({
      v: 1,
      revision: expect.any(Number),
      generatedAt: expect.any(Number),
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
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

describe('debounce — a mutation burst coalesces into one trailing publish', () => {
  it(`publishes once, ${WIDGET_PUBLISH_DEBOUNCE_MS}ms after the LAST event of a burst`, async () => {
    vi.useFakeTimers()
    try {
      expect(WIDGET_PUBLISH_DEBOUNCE_MS).toBe(2_000)
      scheduleWidgetPublish()
      scheduleWidgetPublish()
      scheduleWidgetPublish()
      await vi.advanceTimersByTimeAsync(WIDGET_PUBLISH_DEBOUNCE_MS - 1)
      expect(state.published).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(state.published).toHaveLength(1)
      expect(state.appStateListener).toBeNull() // scheduling alone never installs listeners
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('a late event RESETS the trailing window (true trailing debounce)', async () => {
    vi.useFakeTimers()
    try {
      scheduleWidgetPublish()
      await vi.advanceTimersByTimeAsync(1_500)
      scheduleWidgetPublish() // burst continues — clock restarts
      await vi.advanceTimersByTimeAsync(1_500)
      expect(state.published).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(500)
      expect(state.published).toHaveLength(1)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})

describe('installWidgetPublishers — the seam wiring', () => {
  it('a food mutation schedules a publish; AppState "active" self-heals; cleanup stops both', async () => {
    vi.useFakeTimers()
    try {
      const cleanup = installWidgetPublishers()
      emitFoodMutation({ kind: 'meal' })
      await vi.advanceTimersByTimeAsync(WIDGET_PUBLISH_DEBOUNCE_MS)
      expect(state.published).toHaveLength(1)

      // Backup restore / raw undo emit no events — the foreground self-heal.
      state.appStateListener?.('active')
      await vi.advanceTimersByTimeAsync(WIDGET_PUBLISH_DEBOUNCE_MS)
      expect(state.published).toHaveLength(2)
      // Non-active states never publish.
      state.appStateListener?.('background')
      await vi.advanceTimersByTimeAsync(WIDGET_PUBLISH_DEBOUNCE_MS)
      expect(state.published).toHaveLength(2)

      cleanup()
      emitFoodMutation({ kind: 'meal' })
      state.appStateListener?.('active')
      await vi.advanceTimersByTimeAsync(WIDGET_PUBLISH_DEBOUNCE_MS)
      expect(state.published).toHaveLength(2)
      expect(state.appStateListener).toBeNull()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('a workout write through the training repository schedules a publish', async () => {
    vi.useFakeTimers()
    try {
      const cleanup = installWidgetPublishers()
      await vi.advanceTimersByTimeAsync(1) // flush the lazy workout subscription
      const id = await startWorkout(database, TODAY, 'Bus Test', NOW + 3_000)
      await vi.advanceTimersByTimeAsync(WIDGET_PUBLISH_DEBOUNCE_MS)
      expect(state.published).toHaveLength(1)
      cleanup()
      await discardWorkout(database, id, NOW + 4_000)
      await vi.advanceTimersByTimeAsync(WIDGET_PUBLISH_DEBOUNCE_MS)
      expect(state.published).toHaveLength(1)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})
