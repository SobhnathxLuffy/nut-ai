import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The component module imports react-native / react-native-svg (through the
// Icon import); vitest's node environment cannot load them. The mocks are
// hoisted above every import so the real packages never load — the same
// constraint Empty.test.ts documents.
vi.mock('react-native', () => ({
  Animated: {
    Value: class {},
    timing: vi.fn(),
    spring: vi.fn(),
    parallel: vi.fn(),
    View: () => null,
    Text: () => null,
  },
  Platform: { OS: 'web' },
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
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
vi.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ isDark: false }),
  useMotionScale: () => 1,
}))

import { PRESS_RELEASE_MS, PRESS_SCALE } from './PressableFX'

/**
 * UI/UX report Table 9.1 (Wave 2) — PressableFX, the app-wide press feedback:
 * "scale 0.97 + dim 6%, 120ms out. Job it does: confirms touch on every
 * Pressable." Plain-Node vitest (no React renderer): the spec constants are
 * imported from the real module, the choreography is source-swept.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'PressableFX.tsx'), 'utf8')

describe('the Table 9.1 spec constants', () => {
  it('press scale is 0.97', () => {
    expect(PRESS_SCALE).toBe(0.97)
  })

  it('the release ("out") duration is 120ms', () => {
    expect(PRESS_RELEASE_MS).toBe(120)
  })
})

describe('the dim is the §4.3 state layer, never a private opacity', () => {
  it('pressed renders stateLayerFor(...).pressed — the 6% ink overlay', () => {
    expect(source).toContain('stateLayerFor(theme.isDark)')
    expect(source).toMatch(/pressed && !disabled \? layers\.pressed : null/)
  })

  it('disabled renders the stateLayer.disabled token (38% + no shadow)', () => {
    expect(source).toMatch(/disabled \? layers\.disabled : null/)
  })
})

describe('reduce motion — instant states, no choreography (report §9)', () => {
  it('both reduce-motion sources fold into one boolean', () => {
    expect(source).toMatch(/export function useReducedMotion/)
    expect(source).toContain('motionScale === 0 || useWebReducedMotion()')
  })

  it('the web half honours the prefers-reduced-motion media query', () => {
    expect(source).toContain("(prefers-reduced-motion: reduce)")
  })

  it('when reduced, the press state applies via setValue — no animation', () => {
    // The animate() helper branches on `reduced` BEFORE touching Animated.timing.
    expect(source).toMatch(/if \(reduced\) \{\s*\/\/ Reduce motion[\s\S]*?scale\.setValue\(to\)/)
  })
})

describe('hit area and structure', () => {
  it('the caller style lands on the scaled visual box, inside the Pressable', () => {
    expect(source).toMatch(/<Pressable \{\.\.\.rest\} disabled=\{disabled\} onPressIn=\{pressIn\} onPressOut=\{pressOut\}>/)
    expect(source).toMatch(/style=\{\[\s*style,/)
  })

  it('caller press handlers still fire (onPressIn/onPressOut are forwarded)', () => {
    expect(source).toContain('onPressIn?.(event)')
    expect(source).toContain('onPressOut?.(event)')
  })
})
