import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLOW, nextRoute, stepIndex, TOTAL_STEPS } from './flow'
import type { OnboardingAnswers } from './store'

/**
 * Owner QA 2026-10 — onboarding collapsed to a SINGLE PAGE.
 *
 * "Why is the onboarding giving three things in one page so many times? Don't
 * do that — give everything one single page."
 *
 * This file pins the CONTRACT of that collapse, not the pixels:
 *
 *   1. The flow is exactly TWO pages: the single form (index) and the plan
 *      reveal (plan, which persists and exits). No interstitials.
 *   2. The progress rail is continuous: the form is 1/2, the reveal 2/2.
 *   3. DATA INTEGRITY — the non-negotiable: the single page captures EXACTLY
 *      the same answer fields the twelve-step flow captured. The harvest now
 *      walks BOTH the route files and the shared onboarding components, since
 *      the question controls live in src/components/onboarding/.
 *   4. The dead routes are actually dead — nothing in app/, src/ or e2e/
 *      deep-links to a screen that no longer exists.
 */

const here = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(here, '../..')
const ONBOARDING_DIR = join(APP_ROOT, 'app/onboarding')
const COMPONENTS_DIR = join(APP_ROOT, 'src/components/onboarding')

/** The single form + the reveal + the uncounted alternate entry. */
const EXPECTED_FILES = ['_layout.tsx', 'index.tsx', 'plan.tsx', 'restore.tsx'].sort()

/** Screens absorbed into the single page, plus the older merge casualties. */
const DEAD_ROUTES = [
  // absorbed by the single-page collapse (owner QA 2026-10):
  'activity', 'diet', 'accomplish', 'body', 'desired-weight', 'provider',
  'health', 'projection', 'rollover', 'notifications',
  // absorbed by the original 22→12 merge:
  'sex', 'workouts', 'birth', 'height', 'weight', 'professional',
  'blocker', 'apikey', 'trend', 'potential', 'thanks', 'generate',
] as const

/**
 * Every OnboardingAnswers field a SCREEN must still capture after the merge.
 * `goal` is deliberately absent: it is DERIVED (inferredGoal) — no screen may
 * ask it, before or after the merge.
 */
const EXPECTED_FIELDS: ReadonlySet<keyof OnboardingAnswers> = new Set([
  'sex',
  'workoutsPerWeek',
  'worksWithProfessional',
  'dietStyle',
  'blocker',
  'accomplish',
  'birthYear',
  'birthMonth',
  'birthDay',
  'heightCm',
  'weightKg',
  'units',
  'desiredWeightKg',
  'provider',
  'providerModel',
  'healthConnected',
  'rolloverCalories',
] satisfies ReadonlyArray<keyof OnboardingAnswers>)

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, out)
      continue
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full)
  }
  return out
}

/**
 * Fields the onboarding surfaces write, harvested from their own source —
 * route files AND the shared section components (the single page moved the
 * controls into src/components/onboarding/OnboardingSections.tsx).
 */
function capturedFields(): Set<string> {
  const files = [...walk(ONBOARDING_DIR), ...walk(COMPONENTS_DIR)]
  const fields = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    // Three capture forms:
    //   setAnswer('field', …)                 — imperative screens/sections
    //   field: 'field'                        — questionGroup/yesNoGroup specs
    //   field="field"                         — OptionScreen JSX prop
    for (const m of source.matchAll(/setAnswer\(\s*'([A-Za-z]+)'/g)) fields.add(m[1]!)
    for (const m of source.matchAll(/field:\s*'([A-Za-z]+)'/g)) fields.add(m[1]!)
    for (const m of source.matchAll(/field="([A-Za-z]+)"/g)) fields.add(m[1]!)
  }
  return fields
}

describe('owner QA 2026-10: the flow is ONE page + the reveal', () => {
  it('FLOW is exactly the form and the reveal', () => {
    expect([...FLOW]).toEqual(['index', 'plan'])
    expect(TOTAL_STEPS).toBe(2)
  })

  it('the onboarding directory is exactly the form + plan + restore + layout', () => {
    expect(readdirSync(ONBOARDING_DIR).sort()).toEqual(EXPECTED_FILES)
  })

  it('the rail runs 1..2 — the form is 1/2, the reveal finishes at 2/2', () => {
    expect(stepIndex('index')).toBe(1)
    expect(stepIndex('plan')).toBe(2)
    for (const step of FLOW) expect(stepIndex(step)).toBeGreaterThan(0)
  })

  it('every next hop is the next FLOW entry — the rail can never jump or reset', () => {
    for (let i = 0; i < FLOW.length - 1; i++) {
      expect(nextRoute(FLOW[i]!)).toBe(`/onboarding/${FLOW[i + 1]}`)
    }
    // The terminal step's fallback is the plan itself (it never routes on).
    expect(nextRoute('plan')).toBe('/onboarding/plan')
  })

  it('the single page renders every section — no question was dropped from the page', () => {
    const form = readFileSync(join(ONBOARDING_DIR, 'index.tsx'), 'utf8')
    for (const section of [
      'AboutYouSection',
      'DietSection',
      'AccomplishSection',
      'BodySection',
      'DesiredWeightSection',
      'ProviderSection',
      'PreferencesSection',
      'HealthSection',
    ]) {
      expect(form, `${section} on the single page`).toContain(section)
    }
    // The one Continue opens the plan reveal — no per-section navigation.
    expect(form).toContain("'/onboarding/plan'")
  })
})

describe('data integrity — the collapse drops zero fields', () => {
  it('the single page captures EXACTLY the fields the plan generation consumes', () => {
    const captured = capturedFields()
    expect([...captured].sort()).toEqual([...EXPECTED_FIELDS].sort())
  })

  it('no screen asks the goal — it is derived from the two weights', () => {
    // inferredGoal() reads weightKg/desiredWeightKg; a screen writing `goal`
    // would reintroduce the contradiction the flow deliberately removed.
    expect(capturedFields().has('goal')).toBe(false)
  })

  it('the dead routes are referenced nowhere in app/, src/ or e2e/', () => {
    const trees = ['app', 'src', 'e2e'].map((t) => join(APP_ROOT, t))
    const offenders: string[] = []
    for (const route of DEAD_ROUTES) {
      for (const tree of trees) {
        for (const file of walk(tree)) {
          const source = readFileSync(file, 'utf8')
          if (source.includes(`/onboarding/${route}`)) {
            offenders.push(`${route} referenced in ${file}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the deleted chart components went with their screens', () => {
    const charts = readFileSync(join(here, '../components/onboarding/Charts.tsx'), 'utf8')
    // ProjectionChart survives the collapse — it renders inline on the single
    // page (DesiredWeightSection) instead of owning a screen.
    expect(charts).toContain('export function ProjectionChart')
    expect(charts).not.toContain('TrendComparisonChart')
    expect(charts).not.toContain('TransitionChart')
    // ProgressChart survives — the plan reveal still uses it.
    expect(charts).toContain('export function ProgressChart')
  })
})
