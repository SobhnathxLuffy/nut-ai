import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The component module imports react-native; vitest's node environment cannot
// parse RN's Flow sources. The mock is hoisted above every import, so the real
// package never loads — the pure decision logic (constants + shimmerEnabled)
// is exercised directly from the REAL module.
vi.mock('react-native', () => ({
  Animated: { Value: class {}, loop: vi.fn(), timing: vi.fn(), View: () => null, event: vi.fn() },
  Platform: { OS: 'web' },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  View: () => null,
  Text: () => null,
  useColorScheme: () => 'light',
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => false,
    addEventListener: () => ({ remove: () => {} }),
  },
}))

import {
  SKELETON_SWEEP_MS,
  SKELETON_SWEEP_WIDTH_RATIO,
  shimmerEnabled,
} from './Skeleton'
import { lightTheme } from '../theme/tokens'

/**
 * UI/UX report §9.2 / Table 9.1 (Wave 1c) — the Skeleton primitive's contract.
 *
 * The vitest environment is plain Node with no React renderer available (the
 * same constraint Toast.test.ts documents), so the render contract is proven
 * two ways: the pure decision logic is called directly, and the component +
 * call-site sources are swept for the structural rules. The runtime visual
 * check (shimmer actually sweeping) is the headless-browser verification in
 * the Wave 1c report.
 */

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(join(here, rel), 'utf8')

describe('Table 9.1 shimmer spec — one slow 1.2s sweep, 20% band', () => {
  it('the loop is 1200ms (report Table 9.1: "1.2s loop")', () => {
    expect(SKELETON_SWEEP_MS).toBe(1200)
  })

  it('the sweep band is 20% of the block width', () => {
    expect(SKELETON_SWEEP_WIDTH_RATIO).toBe(0.2)
  })

  it('shimmerEnabled is a pure function of the motion scale', () => {
    expect(shimmerEnabled(1)).toBe(true)
    expect(shimmerEnabled(0.5)).toBe(true)
    expect(shimmerEnabled(0)).toBe(false)
  })
})

describe('reduce-motion — no Animated.loop is ever started (report §9.2)', () => {
  const source = read('Skeleton.tsx')

  it('the loop construction sits behind the shimmer guard', () => {
    // The guard must appear BEFORE the only Animated.loop in the file: under
    // reduce-motion the effect returns early, so no loop (and no driver) is
    // ever constructed or started.
    const guard = source.indexOf('if (!shimmer) return')
    const loop = source.indexOf('Animated.loop')
    expect(guard).toBeGreaterThan(-1)
    expect(loop).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(loop)
    expect(source.match(/Animated\.loop/g)?.length).toBe(1)
  })

  it('the reduce-motion block is a static 8% ink fill from the theme token', () => {
    // lightTheme.skeletonBase = #0B0B0F14 → 0x14/255 ≈ 7.8% ink.
    expect(source).toContain('theme.skeletonBase')
    expect(lightTheme.skeletonBase).toBe('#0B0B0F14')
  })

  it('over-10s honesty + §8.4: the analyzing state keeps the spinner AND stage copy, and builds the skeleton ingredient list', () => {
    // §9.2: "The 45-second scan and streaming paths keep spinners plus textual
    // progress because they exceed the skeleton window." That half SURVIVES —
    // the spinner (ActivityIndicator) and the honest stage copy stay.
    const result = read('../../app/result.tsx')
    expect(result).toContain('ActivityIndicator')
    // UI/UX report §8.4 (Wave 3): "a skeleton ingredient list builds while the
    // model works" — the exception documented in Skeleton.tsx's header: the
    // list is CONTENT-SHAPED and rides the real pipeline stage
    // (analyzingSkeletonRowCount — 2/4/6 rows), never a fake timer.
    expect(result).toContain("from '../src/components/Skeleton'")
    expect(result).toMatch(/<AnalyzingSkeletonRows stage=\{stage\} \/>/)
    expect(result).toContain('analyzingSkeletonRowCount(stage)')
  })
})

describe('frame-only skeletons are forbidden — the 1–10s windows deploy content-shaped blocks (report §9.2, Table 10.1)', () => {
  // NN/g: a skeleton that renders chrome with no content placeholders is
  // explicitly not recommended. Each target screen must therefore USE the
  // primitive (content-shaped blocks), and the retired text placeholders must
  // be gone. A screen that renders the primitive at all cannot be frame-only
  // by construction — Skeleton draws content blocks only.
  const screens: Array<[string, string]> = [
    ['Home', '../../app/(tabs)/index.tsx'],
    ['Food/search', '../../app/food-search.tsx'],
    ['Progress', '../../app/(tabs)/progress.tsx'],
    ['Assistant', '../../app/assistant.tsx'],
    ['DayTimeline (Home + Food tab)', './DayTimeline.tsx'],
  ]

  it.each(screens)('%s renders the Skeleton primitive in its loading state', (_name, rel) => {
    const source = read(rel)
    expect(source, `${rel} must import the Skeleton primitive`).toContain('Skeleton')
    expect(source, `${rel} must render at least one composition`).toMatch(/<(Skeleton|SkeletonLine|SkeletonRow|SkeletonCard)\b/)
  })

  it('the retired text placeholders are gone', () => {
    expect(read('./DayTimeline.tsx')).not.toContain('Loading your day')
    expect(read('../../app/(tabs)/progress.tsx')).not.toContain('ActivityIndicator')
  })

  it('Home no longer rolls a private SkeletonBlock — one primitive, not per-screen copies', () => {
    expect(read('../../app/(tabs)/index.tsx')).not.toContain('SkeletonBlock')
  })
})

describe('empty-list screens get the Empty primitive with an icon (report Ch. 6.3, Table 10.1)', () => {
  it.each([
    ['Saved foods', '../../app/saved-foods.tsx'],
    ['Recipes', '../../app/recipes.tsx'],
    ['Routines', '../../app/routines.tsx'],
    ['Programs', '../../app/programs.tsx'],
    ['Assistant first open', '../../app/assistant.tsx'],
  ])('%s renders the Empty primitive', (_name, rel) => {
    const source = read(rel)
    expect(source, `${rel} must import the Empty primitive`).toContain('components/Empty')
    expect(source).toMatch(/<Empty\b/)
  })
})
