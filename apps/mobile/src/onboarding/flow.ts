/**
 * The onboarding flow, as data.
 *
 * Owner QA 2026-10: "give everything one single page." The flow collapsed from
 * twelve pushed screens to TWO pages:
 *
 *   index — the SINGLE-PAGE FORM: every question from the old steps 2–11
 *           (about-you, diet, accomplish, body pickers, desired weight,
 *           provider + key, health, projection preview, rollover, reminders
 *           copy) rendered as sections with ONE Continue. The controls are the
 *           same widgets extracted verbatim into
 *           src/components/onboarding/OnboardingSections.tsx.
 *   plan  — the reveal — computes the target from the store, persists through
 *           persistOnboarding (the single writer of user.db + the completion
 *           marker), and replaces to the tabs. Untouched by this merge.
 *
 * `restore` remains an alternate entry from the landing page and is
 * deliberately not a step. The progress rail is honest at 2 steps: the form is
 * 1/2, the reveal is 2/2.
 */
export const FLOW = ['index', 'plan'] as const

export type Step = (typeof FLOW)[number]

export const TOTAL_STEPS = FLOW.length

export function stepIndex(step: Step): number {
  return FLOW.indexOf(step) + 1
}

export function nextRoute(step: Step): string {
  const i = FLOW.indexOf(step)
  const next = FLOW[i + 1]
  return next ? `/onboarding/${next}` : '/onboarding/plan'
}
