import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory kv-store double: the draft rides the SAME Storage abstraction as
// the done key (expo-sqlite/kv-store), which the node suite cannot load.
const store = vi.hoisted(() => {
  const map = new Map<string, string>()
  return {
    map,
    default: {
      setItem: vi.fn((k: string, v: string) => {
        map.set(k, v)
        return Promise.resolve()
      }),
      getItem: vi.fn((k: string) => Promise.resolve(map.get(k) ?? null)),
      removeItem: vi.fn((k: string) => {
        map.delete(k)
        return Promise.resolve()
      }),
    },
  }
})
vi.mock('expo-sqlite/kv-store', () => store)

import { clearDraft, loadDraft, ONBOARDING_DRAFT_KEY, saveDraft } from './draft'
import { FLOW } from './flow'
import type { OnboardingAnswers } from './store'

/**
 * The draft is the one genuinely new persistence piece of the stepwise
 * rebuild (owner mandate 2026-10): a mid-flow snapshot of answers + step that
 * lets a killed app resume where the user left off. It is TRANSIENT and
 * DERIVABLE — never exported in backups — so it lives under its own versioned
 * kv key and every read validates before the store trusts it.
 */

const answers: OnboardingAnswers = {
  sex: 'female',
  workoutsPerWeek: '3-5',
  birthYear: null,
  birthMonth: null,
  birthDay: null,
  heightCm: 168,
  weightKg: 80,
  units: 'metric',
  heightUnit: 'ftin',
  worksWithProfessional: false,
  goal: null,
  desiredWeightKg: null,
  blocker: null,
  dietStyle: null,
  accomplish: null,
  rolloverCalories: null,
  healthConnected: false,
  provider: 'none',
  providerModel: null,
}

beforeEach(() => {
  store.map.clear()
  vi.clearAllMocks()
})

describe('draft save / load round-trip', () => {
  it('preserves answers, step and savedAt verbatim', async () => {
    await saveDraft({ answers, step: 'height', savedAt: 1_700_000_000_000 })
    const loaded = await loadDraft()
    expect(loaded).toEqual({ answers, step: 'height', savedAt: 1_700_000_000_000 })
    expect(store.default.setItem).toHaveBeenCalledWith(ONBOARDING_DRAFT_KEY, expect.any(String))
  })

  it('returns null when no draft exists', async () => {
    expect(await loadDraft()).toBeNull()
  })

  it('clearDraft removes the snapshot', async () => {
    await saveDraft({ answers, step: 'sex', savedAt: 1 })
    await clearDraft()
    expect(await loadDraft()).toBeNull()
    expect(store.default.removeItem).toHaveBeenCalledWith(ONBOARDING_DRAFT_KEY)
  })
})

describe('draft validation — malformed data is rejected, never thrown', () => {
  it('rejects unparsable JSON (a truncated write)', async () => {
    store.map.set(ONBOARDING_DRAFT_KEY, '{"answers": {')
    expect(await loadDraft()).toBeNull()
  })

  it('rejects non-object JSON', async () => {
    store.map.set(ONBOARDING_DRAFT_KEY, '42')
    expect(await loadDraft()).toBeNull()
  })

  it('rejects an unknown step id (the host would have nowhere to jump)', async () => {
    store.map.set(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({ answers, step: 'projection', savedAt: 1 }),
    )
    expect(await loadDraft()).toBeNull()
  })

  it('rejects a missing savedAt', async () => {
    store.map.set(ONBOARDING_DRAFT_KEY, JSON.stringify({ answers, step: FLOW[0] }))
    expect(await loadDraft()).toBeNull()
  })

  it('repairs corrupt FIELDS to their empty defaults instead of losing the draft', async () => {
    const corrupt = {
      ...answers,
      sex: 42, // wrong type -> null
      units: 'stones', // not a unit -> 'metric'
      heightUnit: 'inches', // not a height unit -> 'cm'
      weightKg: 'heavy', // wrong type -> null
      provider: 'magic', // not a provider -> undefined (provider step re-gates)
      healthConnected: 'yes', // must be boolean -> false
      goal: 'lose', // DERIVED — a draft can never be trusted to carry it
    }
    store.map.set(ONBOARDING_DRAFT_KEY, JSON.stringify({ answers: corrupt, step: 'sex', savedAt: 1 }))
    const loaded = await loadDraft()
    expect(loaded).not.toBeNull()
    expect(loaded?.answers.sex).toBeNull()
    expect(loaded?.answers.units).toBe('metric')
    expect(loaded?.answers.heightUnit).toBe('cm')
    expect(loaded?.answers.weightKg).toBeNull()
    expect(loaded?.answers.provider).toBeUndefined()
    expect(loaded?.answers.healthConnected).toBe(false)
    expect(loaded?.answers.goal).toBeNull()
    // Untouched fields survive the repair.
    expect(loaded?.answers.heightCm).toBe(168)
  })
})
