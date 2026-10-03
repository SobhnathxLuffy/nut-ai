import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Plain-Node vitest (the constraint Toast.test.ts / Empty.test.ts document):
// react-native and react-native-svg cannot load in node, so they are mocked
// above every import; the PURE geometry is exercised from the REAL module and
// the animation contract is source-swept.
vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      setValue = vi.fn()
      addListener = vi.fn(() => 0)
      removeListener = vi.fn()
    },
    timing: vi.fn(),
    parallel: vi.fn(),
    View: () => null,
    Text: () => null,
    Easing: { out: (e: unknown) => e, ease: 'ease' },
  },
  Platform: { OS: 'web' },
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
  Text: () => null,
  View: () => null,
  useColorScheme: () => 'light',
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => false,
    addEventListener: () => ({ remove: () => {} }),
  },
}))
vi.mock('react-native-svg', () => ({
  default: () => null,
  Circle: () => null,
}))
vi.mock('./PressableFX', () => ({
  useReducedMotion: () => false,
  useWebReducedMotion: () => false,
}))
vi.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ ring: '#000', ringTrack: '#eee', uncertain: '#8B7BD8' }),
}))

import { RING_COUNT_MS, ringGeometry } from './ProgressRing'

/**
 * UI/UX report Table 5.1 / Table 12.2 (Wave 2) — the ONE ProgressRing:
 * "Progress — 3 ring implementations → One ProgressRing (stroke + track)",
 * with the Table 9.1 motion: "Ring / count-up: 600ms ease-out on focus."
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'ProgressRing.tsx'), 'utf8')

describe('geometry — one formula for every ring (the audit found three)', () => {
  it('the hero ring: size 128, stroke 12 → r 52', () => {
    expect(ringGeometry(128, 12).r).toBe(52)
    expect(ringGeometry(128, 12).circumference).toBeCloseTo(2 * Math.PI * 52, 5)
  })

  it('the macro ring: size 74, stroke 5 → r 32 (the old MacroCard arithmetic)', () => {
    expect(ringGeometry(74, 5).r).toBe(32)
  })

  it('a full sweep draws exactly the circumference', () => {
    const { circumference } = ringGeometry(128, 12)
    // The dash formula the component renders for value=1.
    expect(`${circumference * 1} ${circumference}`).toBe(`${circumference} ${circumference}`)
  })
})

describe('the Table 9.1 motion contract', () => {
  it('the count-up is 600ms ease-out', () => {
    expect(RING_COUNT_MS).toBe(600)
    expect(source).toMatch(/duration: RING_COUNT_MS/)
    expect(source).toMatch(/Easing\.out\(Easing\.ease\)/)
  })

  it('reduce motion renders the new value instantly — the arc still arrives', () => {
    expect(source).toMatch(/if \(reduced\) \{[\s\S]*?setDisplay\(to\)/)
  })

  it('a value change tweens FROM the current position, never snaps from zero mid-day', () => {
    expect(source).toContain('const start = current.current')
    expect(source).toMatch(/start\.primary \+ \(to\.primary - start\.primary\) \* t/)
  })

  it('the count-up twin sets numbers in monoData tabular figures (report §4.2)', () => {
    expect(source).toMatch(/<Text style=\{\[type\.monoData, style\]\}/)
  })

  it('reanimated is NOT imported and NOT a dependency — RN Animated only (web export safety)', () => {
    // Wave 4f (report Table 12.1 KILL list): the dead `react-native-reanimated`
    // dep was removed — zero source imports ever existed, so removal is safe.
    // This locks both halves: the animation source stays on RN Animated, and
    // the dependency cannot silently return to package.json.
    expect(source).not.toContain('react-native-reanimated')
    expect(source).toContain('useNativeDriver: false')
    const manifest = readFileSync(join(here, '../../package.json'), 'utf8')
    expect(manifest).not.toContain('react-native-reanimated')
  })
})

describe('the honest overflow arc (report Ch. 8.2 Home rule)', () => {
  it('an overflow fraction draws a thinner inner arc in the uncertain colour', () => {
    expect(source).toMatch(/overflow\?: number/)
    expect(source).toMatch(/stroke=\{theme\.uncertain\} strokeWidth=\{stroke \* 0\.6\}/)
    expect(source).toContain('innerR')
  })

  it('values clamp to the ring — a fraction is never drawn past full', () => {
    expect(source).toMatch(/const clamp01 = \(n: number\) => Math\.min\(1, Math\.max\(0, n\)\)/)
  })
})

describe('the Home migration (highest-traffic ring)', () => {
  it('Home renders the primitive for the hero ring, the count-up and the macro rings', () => {
    const home = readFileSync(join(here, '../../app/(tabs)/index.tsx'), 'utf8')
    expect(home).toContain("from '../../src/components/ProgressRing'")
    // Wave 3 (§8.2): the hero ring still carries the honest overflow arc; the
    // markup now splits across lines (focus-tick key + ring-center CountUp).
    expect(home).toMatch(/overflow=\{over \? pct - 1 : 0\}/)
    expect(home).toMatch(/size=\{128\}/)
    expect(home).toMatch(/stroke=\{12\}/)
    expect(home).toMatch(/<CountUp\s+key=\{`hero-\$\{focusTick\}`\}\s+value=\{Math\.abs\(Math\.round\(remaining\)\)\}/)
    // The macro stat rows carry inline 36pt mini-rings (was: 74/5 cards).
    expect(home).toMatch(/<ProgressRing value=\{pct\} size=\{36\} stroke=\{4\} color=\{color\}>/)
  })

  it('the hand-rolled Ring component is gone from Home', () => {
    const home = readFileSync(join(here, '../../app/(tabs)/index.tsx'), 'utf8')
    expect(home).not.toMatch(/function Ring\(/)
  })

  it('the other two audited rings joined too: welcome demo + onboarding rollover', () => {
    const welcome = readFileSync(join(here, '../../app/onboarding/index.tsx'), 'utf8')
    const rollover = readFileSync(join(here, '../../app/onboarding/rollover.tsx'), 'utf8')
    expect(welcome).toMatch(/<ProgressRing value=\{0\.68\} size=\{104\} stroke=\{9\} \/>/)
    expect(welcome).not.toContain("from 'react-native-svg'")
    expect(rollover).toMatch(/<ProgressRing value=\{0\.82\} size=\{size\} stroke=\{7\} \/>/)
    expect(rollover).not.toContain("from 'react-native-svg'")
  })
})
