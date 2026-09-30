/**
 * P3-D7: the ONE numeric clamp. Three inline `Math.min(max, Math.max(min, x))`
 * copies in the onboarding steppers were one refactor away from diverging on
 * edge semantics (NaN, min > max). Funnel them through here.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
