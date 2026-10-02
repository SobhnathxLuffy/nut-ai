import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Plain-Node vitest (same constraint as Empty.test.ts): react-native and
// react-native-svg are mocked above every import; the variant colour mapping
// is exercised directly from the REAL module, the structure is source-swept.
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
  Ellipse: () => null,
  G: () => null,
  Path: () => null,
  Rect: () => null,
}))
vi.mock('../theme/ThemeProvider', () => ({
  // Never invoked at import time (the component is not rendered here), but the
  // factory must reference the binding lazily to avoid TDZ at hoist time.
  useTheme: () => lightTheme,
  useMotionScale: () => 1,
}))
vi.mock('./PressableFX', () => ({
  PressableFX: () => null,
  useReducedMotion: () => false,
  useWebReducedMotion: () => false,
}))
vi.mock('./Icon', () => ({ Icon: () => null }))

import { badgeColorsFor } from './Badge'
import { darkTheme, lightTheme } from '../theme/tokens'

/**
 * UI/UX report Table 5.1 / Table 12.2 (Wave 2) — the ONE Badge:
 * "Badge / Chip — 5 chip implementations → One Badge/Chip with variants."
 * Every variant resolves to theme tokens (no private wash can regrow), the
 * interactive form carries the 44pt target (Table 11.1), and the two migrated
 * families (ConfidenceChip, progress/camera chips) consume it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'Badge.tsx'), 'utf8')

describe('variant → token colour mapping (both themes)', () => {
  it('default: sunken surface, primary text', () => {
    expect(badgeColorsFor('default', lightTheme)).toEqual({
      bg: lightTheme.bgSunken,
      fg: lightTheme.text,
      border: null,
    })
    expect(badgeColorsFor('default', darkTheme).bg).toBe(darkTheme.bgSunken)
  })

  it('selected: the ink dialect — text surface, bg label', () => {
    expect(badgeColorsFor('selected', lightTheme)).toEqual({
      bg: lightTheme.text,
      fg: lightTheme.bg,
      border: null,
    })
  })

  it('outline: transparent with the border token', () => {
    const c = badgeColorsFor('outline', lightTheme)
    expect(c.bg).toBe('transparent')
    expect(c.border).toBe(lightTheme.border)
  })

  it('macro variants ride the identity tints — never the old Tailwind alphas', () => {
    expect(badgeColorsFor('protein', lightTheme)).toEqual({ bg: lightTheme.proteinTint, fg: lightTheme.protein, border: null })
    expect(badgeColorsFor('carbs', lightTheme)).toEqual({ bg: lightTheme.carbsTint, fg: lightTheme.carbs, border: null })
    expect(badgeColorsFor('fat', lightTheme)).toEqual({ bg: lightTheme.fatTint, fg: lightTheme.fat, border: null })
    expect(badgeColorsFor('carbs', darkTheme).bg).toBe(darkTheme.carbsTint)
  })

  it('tone variants keep their established semantics (affirm/uncertain washes, safetyBg)', () => {
    expect(badgeColorsFor('affirm', lightTheme)).toEqual({ bg: lightTheme.affirmTint, fg: lightTheme.affirm, border: null })
    expect(badgeColorsFor('uncertain', lightTheme)).toEqual({ bg: lightTheme.uncertainBg, fg: lightTheme.uncertain, border: null })
    expect(badgeColorsFor('safety', lightTheme)).toEqual({ bg: lightTheme.safetyBg, fg: lightTheme.safety, border: null })
  })
})

describe('interactive form — 44pt target + press feedback (Table 11.1 / 9.1)', () => {
  it('an onPress badge renders through PressableFX with the button role (radio via the §8.4 role prop)', () => {
    expect(source).toMatch(/const interactive = onPress != null/)
    // The role is prop-driven: 'button' by default, 'radio' for the camera's
    // §8.4 Quick/Advanced segmented pair inside a radiogroup.
    expect(source).toContain('accessibilityRole={role}')
    expect(source).toMatch(/role\?: 'button' | 'radio'/)
    expect(source).toMatch(/role = 'button',/)
    expect(source).toMatch(/minHeight: interactive \? MIN_TAP_TARGET : undefined/)
  })

  it('interactive selection flips to the ink dialect exactly like the old chips', () => {
    expect(source).toMatch(/selected && variant !== 'selected'/)
  })

  it('selection state speaks BOTH a11y dialects (native accessibilityState + flat web aria)', () => {
    // react-native-web (the bundled version) does not translate
    // accessibilityState into DOM aria-*, so the flat props carry the web half:
    // radios expose aria-checked, segmented button pills expose aria-pressed
    // (aria-selected is invalid on role=button). Verified live: the camera
    // pills/radios expose no state without these (scan17 runtime proof).
    expect(source).toMatch(/accessibilityState=\{role === 'radio' \? \{ checked: selected \} : \{ selected \}\}/)
    expect(source).toMatch(/aria-checked=\{role === 'radio' \? selected : undefined\}/)
    expect(source).toMatch(/aria-pressed=\{role === 'radio' \? undefined : selected\}/)
  })

  it('non-interactive badges stay compact (no forced tap target on static chips)', () => {
    expect(source).toMatch(/if \(!interactive\) \{[\s\S]*?<View accessibilityLabel/)
  })
})

describe('the families that collapsed into it (Table 12.2 census)', () => {
  const read = (rel: string) =>
    readFileSync(join(here, rel), 'utf8')

  it('ConfidenceChip consumes Badge and keeps its public API + glyph pair', () => {
    const chip = read('ConfidenceChip.tsx')
    expect(chip).toContain("import { Badge } from './Badge'")
    expect(chip).toMatch(/<Badge\s+variant="uncertain"\s+size="sm"/)
    // The tier glyph still carries independently of colour (§8.5).
    expect(chip).toContain('TIER_GLYPH[band.tier]')
    // Public API unchanged.
    expect(chip).toMatch(/value: number/)
    expect(chip).toMatch(/band: Band/)
  })

  it('the progress section/window chips render the Badge', () => {
    const progress = read('../../app/(tabs)/progress.tsx')
    expect(progress).toContain("from '../../src/components/Badge'")
    expect(progress).toMatch(/<Badge label=\{label\} selected=\{selected\} onPress=\{onPress\}/)
  })

  it('the camera web mode pills render the Badge (native stays chrome-exempt)', () => {
    const camera = read('../../app/camera.tsx')
    expect(camera).toContain("from '../src/components/Badge'")
    expect(camera).toMatch(/<Badge[\s\S]*?label=\{m\.label\}/)
  })
})
