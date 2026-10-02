import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The component module imports react-native / react-native-svg /
// react-native-safe-area-context / expo-router (through the shared Screen
// primitives); vitest's node environment cannot load any of them. The mocks
// are hoisted above every import, so the real packages never load — the
// dispatch logic (pressEmptyAction) is exercised directly from the REAL
// module, and the render structure is source-swept below.
vi.mock('react-native', () => ({
  Animated: { Value: class {}, loop: vi.fn(), timing: vi.fn(), View: () => null, Text: () => null, event: vi.fn() },
  Platform: { OS: 'web' },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  TextInput: () => null,
  ActivityIndicator: () => null,
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
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
vi.mock('expo-router', () => ({
  router: { back: vi.fn(), push: vi.fn() },
}))

import { pressEmptyAction } from './Empty'

/**
 * UI/UX report Ch. 6.3 / Table 10.1 (Wave 1c) — the Empty primitive's
 * contract. Plain-Node vitest (no React renderer, same constraint as
 * Toast.test.ts): the action dispatch is exercised directly, and the render
 * structure (icon + title + message + shared Button) is source-swept.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'Empty.tsx'), 'utf8')

describe('the action — fires once, no action is a no-op', () => {
  it('pressEmptyAction calls the action onPress', () => {
    const fired: string[] = []
    pressEmptyAction({ label: 'New recipe', onPress: () => fired.push('new') })
    expect(fired).toEqual(['new'])
  })

  it('pressEmptyAction with no action does nothing', () => {
    expect(() => pressEmptyAction(undefined)).not.toThrow()
  })

  it('the same action can be pressed again (buttons are repeatable)', () => {
    const spy = vi.fn()
    const action = { label: 'Log food', onPress: spy }
    pressEmptyAction(action)
    pressEmptyAction(action)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('render structure — icon, title, message, one shared Button (Ch. 6.3)', () => {
  it('renders the glyph from the icon system, not an emoji or bare text', () => {
    expect(source).toContain('<Icon name={icon}')
    expect(source).toMatch(/icon:\s*IconName/)
  })

  it('title and optional message come from the type scale', () => {
    expect(source).toContain('type.heading')
    expect(source).toContain('type.body')
  })

  it('the action rides the shared Button from Screen.tsx — no private button dialect', () => {
    expect(source).toContain("from './Screen'")
    expect(source).toMatch(/<Button label=\{action\.label\}[^>]*onPress=\{\(\) => pressEmptyAction\(action\)\}/)
  })

  it('centered with generous empty-state spacing (Ch. 6.3 resting place)', () => {
    expect(source).toContain('space.xxxl')
    expect(source).toContain('alignItems: \'center\'')
  })
})
