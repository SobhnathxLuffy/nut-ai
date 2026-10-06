import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Task 11-e — the assistant chat must survive the software keyboard (owner
 * QA: "the chat hides behind the keyboard when it comes").
 *
 * app/ screens sit behind expo imports vitest's node environment cannot load,
 * so the wiring is pinned by SOURCE SWEEP (the established pattern —
 * wave3-food.test.ts, wave3-home.test.ts, Screen.button.test.ts). Runtime
 * keyboard behavior (Android edge-to-edge IME insets, iOS padding, the
 * auto-scroll interplay) is a device check — NOT TESTED in this suite.
 */

const here = dirname(fileURLToPath(import.meta.url))
const assistant = readFileSync(join(here, '..', '..', '..', 'app', 'assistant.tsx'), 'utf8')

describe('assistant keyboard — AGENTS §8.3 "keyboard must not hide required controls"', () => {
  it('the KeyboardAvoidingView adjusts on BOTH platforms (Android edge-to-edge broke the old no-op)', () => {
    expect(assistant).toContain('<KeyboardAvoidingView')
    // `undefined` left Android with NO adjustment: edge-to-edge (Expo SDK
    // 53+) stopped the window from resizing for the IME, so the whole chat —
    // input row included — hid behind the keyboard. 'height' shrinks the
    // chat frame instead (iOS keeps 'padding'; on web react-native-web's
    // KeyboardAvoidingView is a plain View, so the value is inert there).
    expect(assistant).toMatch(/behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/)
    expect(assistant).not.toMatch(/behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/)
  })

  it('the safe-area insets stay on the KAV container style (edge-to-edge clearance)', () => {
    expect(assistant).toMatch(
      /style=\{\[s\.container, \{ backgroundColor: t\.bg, paddingTop: insets\.top, paddingBottom: insets\.bottom \}\]\}/,
    )
  })

  it('the message list keeps taps working while the keyboard is up', () => {
    expect(assistant).toContain('keyboardShouldPersistTaps="handled"')
  })
})
