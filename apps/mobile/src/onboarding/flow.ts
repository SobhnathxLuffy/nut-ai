/**
 * The onboarding flow, as data — the STEP MACHINE for the stepwise rebuild
 * (owner mandate 2026-10: one focused question group per step; the single-page
 * collapse went too far the other way).
 *
 * Onboarding is ONE route (app/onboarding/index.tsx) hosting these steps as
 * internal state — they are NOT routes, so hardware Back and the header
 * chevron step between them without navigation, and every field reference
 * stays inside app/onboarding/ + src/components/onboarding/ (the field-harvest
 * contract). Step order:
 *
 *   1 welcome       units (weight + height, independent) + restore entry
 *   2 sex           3 activity (workouts + professional)   4 diet + blocker
 *   5 accomplish    6 birthday      7 height    8 weight   9 goal weight
 *  10 provider+key  11 preferences (rollover + reminders)  12 health (final)
 *
 * The plan reveal (/onboarding/plan) is NOT a step: it is the hero moment
 * after the last question, reached from step 12's "See my plan" CTA. It still
 * persists through persistOnboarding exactly as before.
 *
 * `restore` remains an alternate entry from the welcome step and is
 * deliberately not a step.
 */
export const FLOW = [
  'welcome',
  'sex',
  'activity',
  'diet',
  'accomplish',
  'birth',
  'height',
  'weight',
  'goal-weight',
  'provider',
  'preferences',
  'health',
] as const

export type Step = (typeof FLOW)[number]

export const TOTAL_STEPS = FLOW.length

/** 1-based position for the "Step N of M" chrome label. */
export function stepIndex(step: Step): number {
  return FLOW.indexOf(step) + 1
}

export function isStep(value: unknown): value is Step {
  return typeof value === 'string' && (FLOW as readonly string[]).includes(value)
}
