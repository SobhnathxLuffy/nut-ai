import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Owner QA 2026-10 source pins for the SINGLE-PAGE onboarding.
 *
 * "Give everything one single page." The 12-step flow collapsed to one form
 * (app/onboarding/index.tsx) whose sections live in
 * src/components/onboarding/OnboardingSections.tsx with the controls extracted
 * VERBATIM from the old steps. app/ routes and RN component modules sit behind
 * expo-router/react-native imports the plain-Node vitest environment cannot
 * load (the established pattern), so their contracts are pinned against
 * source; the runtime side is covered by the Playwright e2e walk.
 */

const here = dirname(fileURLToPath(import.meta.url))
const screen = (name: string): string => readFileSync(join(here, '../../../app/onboarding', name), 'utf8')
const section = (name: string): string => readFileSync(join(here, name), 'utf8')

const FORM = screen('index.tsx')
const SECTIONS = section('OnboardingSections.tsx')

describe('single page — one form, one Continue, no interstitials', () => {
  it('every former step renders as a section on the page', () => {
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
      expect(FORM, `${section} is on the page`).toContain(section)
    }
  })

  it('the one CTA opens the plan reveal; the restore entry survives', () => {
    expect(FORM).toContain("'/onboarding/plan'")
    expect(FORM).toContain('Restore from a backup')
    expect(FORM).toContain('Answer every question to continue')
  })

  it('the old welcome demo loop is gone from the form page', () => {
    expect(FORM).not.toMatch(/PHASE_MS/)
    expect(FORM).not.toContain('Scanning your photo')
  })
})

describe('sections keep the merged question groups and the grouped gate', () => {
  it('about-you folds all three questions (sex, workouts, professional)', () => {
    expect(SECTIONS).toMatch(/field: 'sex'/)
    expect(SECTIONS).toMatch(/field: 'workoutsPerWeek'/)
    expect(SECTIONS).toMatch(/field: 'worksWithProfessional'/)
  })

  it('diet + blocker are one section with two groups', () => {
    expect(SECTIONS).toMatch(/field: 'dietStyle'/)
    expect(SECTIONS).toMatch(/field: 'blocker'/)
  })

  it('the grouped gate demands every answer before Continue unlocks', () => {
    const src = readFileSync(join(here, 'OptionScreen.tsx'), 'utf8')
    expect(src).toContain('Answer every question to continue')
    expect(src).toMatch(/groups\.every\(\(g\) => answers\[g\.field\] != null\)/)
  })

  it('question groups carry radiogroup semantics (a11y + e2e scoping)', () => {
    const src = readFileSync(join(here, 'OptionScreen.tsx'), 'utf8')
    expect(src).toContain('accessibilityRole="radiogroup"')
    expect(src).toContain('accessibilityLabel={g.label}')
  })
})

describe('body section — the combined pickers stay verbatim', () => {
  it('one section carries the birth wheels, the height wheels and the weight ruler', () => {
    expect(SECTIONS).toContain('WheelHighlight')
    expect(SECTIONS).toMatch(/label="Month"/)
    expect(SECTIONS).toMatch(/label="Feet"/)
    expect(SECTIONS).toContain('RulerPicker')
    expect(SECTIONS).toContain('EditableValue')
  })

  it('one unit toggle drives both height and weight (converting, not resetting)', () => {
    expect(SECTIONS).toContain("value: 'imperial', label: 'lb · ft, in'")
    expect(SECTIONS).toContain("value: 'metric', label: 'kg · cm'")
    expect(SECTIONS).toMatch(/setAnswer\('units', u\)/)
  })

  it('every numeric field is written; defaults fill on Continue like the old screens', () => {
    for (const field of ['birthYear', 'birthMonth', 'birthDay', 'heightCm', 'weightKg']) {
      expect(SECTIONS).toMatch(new RegExp(`setAnswer\\('${field}'`))
    }
    expect(FORM).toMatch(/setAnswer\('heightCm', BODY_DEFAULT_CM\)/)
    expect(FORM).toMatch(/setAnswer\('weightKg', BODY_DEFAULT_KG\)/)
  })
})

describe('provider section — the shared CredentialForm stays inline', () => {
  it('the form is embedded, remounting per provider', () => {
    expect(SECTIONS).toContain('CredentialForm')
    expect(SECTIONS).toMatch(/key=\{realProvider\}/)
  })

  it('a verified key reports the model id; no-key means provider none, persisted eagerly', () => {
    expect(SECTIONS).toMatch(/setAnswer\('providerModel', modelId\)/)
    expect(SECTIONS).toMatch(/putSetting\('provider', 'none'\)/)
    expect(SECTIONS).toContain('No key for now')
  })
})

describe('projection — the direction chart now renders inline in the body section', () => {
  it('one chart, following the real goal direction', () => {
    expect(SECTIONS).toContain('ProjectionChart')
    expect(SECTIONS).toMatch(/inferredGoal\(a\) === 'gain'/)
    expect(SECTIONS).not.toContain('TrendComparisonChart')
    expect(SECTIONS).not.toContain('TransitionChart')
  })

  it('the fused chart carries BOTH moments: the comparison and the early milestones', () => {
    const src = readFileSync(join(here, 'Charts.tsx'), 'utf8')
    expect(src).toMatch(/Without a plan/)
    expect(src).toContain('First 30 days')
    // Milestone dots at 3 days, a week, a month — the old potential screen's job.
    expect(src).toMatch(/milestone\(18\)/)
    expect(src).toMatch(/milestone\(32\)/)
    expect(src).toMatch(/milestone\(62\)/)
  })
})

describe('rollover + reminders — one preferences section', () => {
  it('the rollover question is a real group; the cap copy survives', () => {
    expect(SECTIONS).toMatch(/field: 'rolloverCalories'/)
    expect(SECTIONS).toContain('restrict-then-binge')
    expect(SECTIONS).toMatch(/ROLLOVER_CAP_KCAL/)
  })

  it('the reminders copy keeps its honesty (permission requested later, not now)', () => {
    expect(SECTIONS).toContain("A nudge when you'd usually log")
    expect(SECTIONS).toContain('worth sending, not now')
  })
})

describe('plan reveal — the hero moment (Ch 8.1, unchanged by the merge)', () => {
  const src = screen('plan.tsx')

  it('the hero numbers count up in monoData tabular figures via CountUp', () => {
    expect(src).toContain("from '../../src/components/ProgressRing'")
    expect(src).toMatch(/<CountUp\s+value=\{plan\.target\.target\}/)
    expect(src).toMatch(/format=\{\(n\) => `\$\{Math\.round\(n\)\}g`\}/)
    expect(src).toMatch(/\.\.\.type\.monoData, fontSize: type\.display\.fontSize/)
  })

  it('the breakdown expands with a SPRING, gated on reduce-motion', () => {
    expect(src).toMatch(/Animated\.spring\(/)
    expect(src).toContain('useReducedMotion')
    expect(src).toMatch(/if \(reduced\) return/)
  })

  it('a success haptic marks the finish, through the shared haptics map', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/src\/utils\/haptics'/)
    expect(src).toMatch(/void success\(\)/)
  })

  it('persist-before-navigate survives the rebuild (P3 contract)', () => {
    expect(src).toMatch(/persistOnboarding\(a, plan\.target, plan\.macros\)/)
    expect(src).toMatch(/router\.replace\('\/\(tabs\)'/)
  })
})
