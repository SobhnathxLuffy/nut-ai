import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { darkTheme, lightTheme } from './tokens'

/**
 * Wave 3 — trust and consistency (QA P2-17..19, P2-21, P2-14, P2-15, P2-16).
 * UI behaviour itself is covered by the Playwright e2e pass; these tests pin
 * the parts that are pure data or source-level invariants.
 */
describe('onboarding chrome tokens (P2-19)', () => {
  it('light theme preserves the exact hexes the deleted ternaries used', () => {
    // Chrome.tsx track + disabled CTA, Chrome.tsx back circle, Controls.tsx wells
    expect(lightTheme.bgSunkenStrong).toBe('#EDEDF0')
    expect(lightTheme.bgChrome).toBe('#F3F3F6')
    expect(lightTheme.bgSunkenVariant).toBe('#F0F0F3')
  })

  it('dark theme routes the chrome surfaces to contrast-checked palette values', () => {
    expect(darkTheme.bgSunkenStrong).toBe(darkTheme.border)
    expect(darkTheme.bgChrome).toBe(darkTheme.bgElevated)
    expect(darkTheme.bgSunkenVariant).toBe(darkTheme.bgSunken)
  })

  it('every chrome token differs meaningfully across modes (dark is first-class)', () => {
    expect(lightTheme.bgSunkenStrong).not.toBe(darkTheme.bgSunkenStrong)
    expect(lightTheme.bgChrome).not.toBe(darkTheme.bgChrome)
    expect(lightTheme.bgSunkenVariant).not.toBe(darkTheme.bgSunkenVariant)
  })
})

describe('DayTimeline web-alert shim is gone for good (P2-16)', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../components/DayTimeline.tsx'),
    'utf8',
  )

  it('no local window.confirm shim and no positional button mapping left', () => {
    expect(source).not.toContain('window.confirm')
    expect(source).not.toContain('showAlert')
    // Wave 1b (UI/UX report §10.1): confirmations now go through the ONE
    // shared helper (confirmDialog, which the global styled shim in
    // src/ui/alert-web.ts renders on web); failures surface as toasts.
    // The raw Alert.alert dependency is gone with the 2026 collapse.
    expect(source).toContain('confirmDialog(')
    expect(source).not.toContain('Alert.alert(')
  })
})
