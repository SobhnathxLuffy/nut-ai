/**
 * The onboarding flow, as data.
 *
 * Keeping the order in one place is what makes the progress bar honest: every
 * screen derives its own position from this array rather than hardcoding a
 * number, so inserting or removing a screen can never leave the bar lying.
 *
 * Wave 3 (UI/UX report Ch. 8.1): the flow is TWELVE steps, down from twenty
 * plus interstitials. The merge map, screen by screen:
 *
 *   index        welcome — the live scan demo (step 1; renders no rail, it is
 *                the landing, but it counts — the rail on the next screen
 *                starts at 2/12, never a per-screen reset)
 *   activity     sex + workouts + professional (three grouped card questions;
 *                'professional' folded here because its field IS consumed by
 *                the plan reveal and persistOnboarding)
 *   diet         diet + blocker (two grouped card questions)
 *   accomplish   kept as-is
 *   body         birth + height + weight (the combined picker screen; the
 *                ruler/wheel pickers and their selection haptics kept verbatim)
 *   desired-weight kept as-is
 *   provider     provider + API key on one screen (CredentialForm inline)
 *   health       Apple Health permission (kept as-is)
 *   projection   trend + potential FUSED into one chart moment
 *   rollover     kept as-is
 *   notifications kept as-is
 *   plan         the reveal — the hero moment and the final step
 *
 * CUT entirely: thanks, generate (pure motivational interstitials), trend,
 * potential (fused into 'projection'), and the single-question screens the
 * merges absorbed. `restore` remains an alternate entry from the landing page
 * and is deliberately not a step.
 */
export const FLOW = [
  'index',
  'activity',
  'diet',
  'accomplish',
  'body',
  // No 'goal' screen. Direction is DERIVED from current vs desired weight — see
  // inferredGoal(). Asking after both numbers are known can only produce
  // agreement or a contradiction the app then has to resolve silently.
  'desired-weight',
  // 'projection' sits after the weights so its curve can follow the real
  // direction. The reference draws a decline unconditionally, which is wrong
  // for a bulk.
  'provider',
  'health',
  'projection',
  'rollover',
  'notifications',
  'plan',
] as const

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
