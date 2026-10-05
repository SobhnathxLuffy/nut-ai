import Storage from 'expo-sqlite/kv-store'
import { isStep, type Step } from './flow'
import type { OnboardingAnswers } from './store'
import type { HeightUnit } from '../data/height-units'

/**
 * The onboarding DRAFT — the mid-flow snapshot that makes the stepwise flow
 * resumable (owner mandate 2026-10). Every answer/step change persists here,
 * so a killed app (process death, crash, swipe-away) resumes at the saved
 * step with every answer intact instead of restarting interrogation from
 * zero.
 *
 * TRANSIENT AND DERIVABLE, therefore deliberately NOT part of the backup
 * EXPORT_TABLES: a draft is a half-finished onboarding, and backups exchange
 * COMPLETED profiles. The done key guards the resume path — a draft is only
 * ever read when onboarding is not finished.
 */

export const ONBOARDING_DRAFT_KEY = 'onboarding.draft.v1'

export interface OnboardingDraft {
  answers: OnboardingAnswers
  /** The step id (not an index) — FLOW can be reordered without stranding drafts. */
  step: Step
  savedAt: number
}

export async function saveDraft(draft: OnboardingDraft): Promise<void> {
  await Storage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft))
}

export async function clearDraft(): Promise<void> {
  await Storage.removeItem(ONBOARDING_DRAFT_KEY)
}

// ---------------------------------------------------------------------------
// Validation. The draft is JSON read back from the kv store — the one trust
// boundary of this feature. A truncated write rejects to "no draft" (a fresh
// start); individual corrupt FIELDS repair to their empty defaults so one bad
// value cannot throw away every good answer. `goal` is never trusted: it is
// derived (inferredGoal) and no draft may reintroduce it.

type StringUnion<K extends keyof OnboardingAnswers> = Extract<OnboardingAnswers[K], string>

/** Union vocabularies, typed against the store so a union change fails here. */
const UNIONS: Partial<Record<keyof OnboardingAnswers, ReadonlyArray<string>>> = {
  sex: ['male', 'female', 'unspecified'] as ReadonlyArray<StringUnion<'sex'>>,
  workoutsPerWeek: ['0-2', '3-5', '6+'] as ReadonlyArray<StringUnion<'workoutsPerWeek'>>,
  units: ['metric', 'imperial'] as ReadonlyArray<StringUnion<'units'>>,
  heightUnit: ['cm', 'ftin'] as ReadonlyArray<HeightUnit>,
  dietStyle: [
    'balanced', 'whole_food', 'mediterranean', 'flexitarian', 'pescatarian', 'vegetarian', 'vegan',
  ] as ReadonlyArray<StringUnion<'dietStyle'>>,
  blocker: ['consistency', 'eating_habits', 'support', 'busy', 'meal_inspiration'] as ReadonlyArray<StringUnion<'blocker'>>,
  accomplish: ['healthier', 'energy', 'motivated', 'body_image'] as ReadonlyArray<StringUnion<'accomplish'>>,
  provider: ['anthropic', 'openai', 'google', 'none'] as ReadonlyArray<StringUnion<'provider'>>,
}

const NUMERIC_FIELDS = [
  'birthYear', 'birthMonth', 'birthDay', 'heightCm', 'weightKg', 'desiredWeightKg',
] as const

const NULLABLE_BOOLEAN_FIELDS = ['worksWithProfessional', 'rolloverCalories'] as const

function sanitizeAnswers(raw: unknown): OnboardingAnswers {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out = { ...emptyAnswers() }
  for (const [field, allowed] of Object.entries(UNIONS)) {
    const v = src[field]
    if (field === 'provider') {
      // 'none' is a real decision; an unknown provider id means "not chosen".
      if (v === 'none' || (typeof v === 'string' && allowed!.includes(v))) {
        out.provider = v as OnboardingAnswers['provider']
      }
      continue
    }
    if (typeof v === 'string' && allowed!.includes(v)) {
      ;(out as Record<string, unknown>)[field] = v
    }
  }
  for (const field of NUMERIC_FIELDS) {
    const v = src[field]
    if (typeof v === 'number' && Number.isFinite(v)) {
      ;(out as Record<string, unknown>)[field] = v
    }
  }
  for (const field of NULLABLE_BOOLEAN_FIELDS) {
    const v = src[field]
    if (typeof v === 'boolean') {
      ;(out as Record<string, unknown>)[field] = v
    }
  }
  if (typeof src.providerModel === 'string') out.providerModel = src.providerModel
  if (typeof src.healthConnected === 'boolean') out.healthConnected = src.healthConnected
  out.goal = null // DERIVED — never persisted from a draft
  return out
}

/** Local literal (not the store's EMPTY) so the store stays the shape owner. */
function emptyAnswers(): OnboardingAnswers {
  return {
    sex: null,
    workoutsPerWeek: null,
    birthYear: null,
    birthMonth: null,
    birthDay: null,
    heightCm: null,
    weightKg: null,
    units: 'metric',
    heightUnit: 'cm',
    worksWithProfessional: null,
    goal: null,
    desiredWeightKg: null,
    blocker: null,
    dietStyle: null,
    accomplish: null,
    rolloverCalories: null,
    healthConnected: false,
    provider: undefined,
    providerModel: null,
  }
}

/**
 * Load and validate. Returns null when there is no draft, it does not parse,
 * or the step is not one the flow knows — the host then starts (or restarts)
 * at the welcome step. Field-level damage repairs (see sanitizeAnswers).
 */
export async function loadDraft(): Promise<OnboardingDraft | null> {
  let raw: string | null = null
  try {
    raw = await Storage.getItem(ONBOARDING_DRAFT_KEY)
  } catch {
    return null
  }
  if (raw == null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { answers, step, savedAt } = parsed as Record<string, unknown>
  if (!isStep(step)) return null
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null
  return { answers: sanitizeAnswers(answers), step, savedAt }
}
