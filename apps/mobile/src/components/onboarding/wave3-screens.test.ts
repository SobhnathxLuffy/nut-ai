import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Wave 3 — UI/UX report Ch 8.1 source pins for the rebuilt onboarding screens.
 *
 * app/ screens sit behind expo-router/react-native imports the plain-Node
 * vitest environment cannot load (the established wave3.test.ts /
 * model-hint.test.ts pattern), so their behaviour contracts are pinned against
 * source. The runtime side is covered by the Playwright e2e walk.
 */

const here = dirname(fileURLToPath(import.meta.url))
const screen = (name: string): string => readFileSync(join(here, '../../../app/onboarding', name), 'utf8')

describe('welcome — the live scan demo replaces the tilted phone mock', () => {
  const src = screen('index.tsx')

  it('plays the scan flow: photo → scanning (skeleton rows) → result, on a loop', () => {
    expect(src).toContain("'photo' | 'scanning' | 'result'")
    expect(src).toMatch(/PHASE_MS/)
    expect(src).toContain('Skeleton')
    expect(src).toContain('Scanning your photo')
  })

  it('the demo result keeps the ONE ProgressRing and the count-up twin', () => {
    expect(src).toMatch(/<ProgressRing value=\{0\.68\} size=\{104\} stroke=\{9\} \/>/)
    expect(src).toContain('<CountUp')
  })

  it('the tilted static phone mock is gone — no rotation anywhere', () => {
    expect(src).not.toMatch(/rotate/)
  })

  it('reduce-motion renders the finished demo directly — no loop, no sweep', () => {
    expect(src).toMatch(/reduced \? 'result' : phase/)
    expect(src).toMatch(/if \(reduced\) return/)
  })

  it('it stays a labelled demo, and the restore + get-started entries survive', () => {
    expect(src).toContain('your photos and your numbers will be yours')
    expect(src).toContain("router.push('/onboarding/activity'")
    expect(src).toContain('Restore from a backup')
  })
})

describe('merged card-group screens (sex + workouts + professional, diet + blocker)', () => {
  it('activity folds all three questions into one GroupedOptionScreen', () => {
    const src = screen('activity.tsx')
    expect(src).toContain('GroupedOptionScreen')
    expect(src).toMatch(/field: 'sex'/)
    expect(src).toMatch(/field: 'workoutsPerWeek'/)
    expect(src).toMatch(/field: 'worksWithProfessional'/)
  })

  it('diet + blocker are one screen with two groups', () => {
    const src = screen('diet.tsx')
    expect(src).toContain('GroupedOptionScreen')
    expect(src).toMatch(/field: 'dietStyle'/)
    expect(src).toMatch(/field: 'blocker'/)
  })

  it('the grouped gate demands every answer before Continue unlocks', () => {
    const src = readFileSync(join(here, 'OptionScreen.tsx'), 'utf8')
    expect(src).toContain('Answer every question to continue')
    expect(src).toMatch(/groups\.every\(\(g\) => answers\[g\.field\] != null\)/)
  })
})

describe('body — the combined picker screen keeps the pickers verbatim', () => {
  const src = screen('body.tsx')

  it('one screen carries the birth wheels, the height wheels and the weight ruler', () => {
    expect(src).toContain('WheelHighlight')
    expect(src).toMatch(/label="Month"/)
    expect(src).toMatch(/label="Feet"/)
    expect(src).toContain('RulerPicker')
    expect(src).toContain('EditableValue')
  })

  it('one unit toggle drives both height and weight (converting, not resetting)', () => {
    expect(src).toContain("value: 'imperial', label: 'lb · ft, in'")
    expect(src).toContain("value: 'metric', label: 'kg · cm'")
    expect(src).toMatch(/setAnswer\('units', u\)/)
  })

  it('every numeric field is written; defaults fill on Continue like the old screens', () => {
    for (const field of ['birthYear', 'birthMonth', 'birthDay', 'heightCm', 'weightKg']) {
      expect(src).toMatch(new RegExp(`setAnswer\\('${field}'`))
    }
  })
})

describe('provider + key merged onto one screen', () => {
  const src = screen('provider.tsx')

  it('the shared CredentialForm is embedded inline, remounting per provider', () => {
    expect(src).toContain('CredentialForm')
    expect(src).toMatch(/key=\{realProvider\}/)
  })

  it('a verified key reports the model id; skip and no-key both mean provider none', () => {
    expect(src).toMatch(/setAnswer\('providerModel', modelId\)/)
    expect(src).toMatch(/putSetting\('provider', 'none'\)/)
    expect(src).toContain('Skip for now')
  })
})

describe('projection — trend + potential fused into one chart moment', () => {
  it('one screen, one chart, following the real goal direction', () => {
    const src = screen('projection.tsx')
    expect(src).toContain('ProjectionChart')
    expect(src).toMatch(/inferredGoal\(a\) === 'gain'/)
    expect(src).not.toContain('TrendComparisonChart')
    expect(src).not.toContain('TransitionChart')
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

describe('plan reveal — the hero moment (Ch 8.1)', () => {
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
