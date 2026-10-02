import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  __resetToastStoreForTests,
  dismissToast,
  getToastSnapshot,
  pressToastAction,
  showToast,
  subscribeToast,
  TOAST_DURATION_MS,
  TOAST_ERROR_DURATION_MS,
} from './toast-store'

/**
 * UI/UX report §10.1 (Wave 1b) — the toast store's contract, unit-tested at
 * the pure-state level (the host is presentation only, see Toast.tsx):
 *
 *   1. ONE visible at a time; later toasts queue behind it, in arrival order.
 *   2. Auto-dismiss ~4s (8s for the error tone) — fake timers prove the exact
 *      firing, including "not one millisecond early".
 *   3. The action fires exactly once, dismisses the toast, and any toast the
 *      action itself enqueues waits in the queue instead of replacing one.
 */

const seen: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  __resetToastStoreForTests()
  seen.length = 0
})

afterEach(() => {
  __resetToastStoreForTests()
  vi.useRealTimers()
})

describe('queue semantics — one visible at a time (report §10.1)', () => {
  it('the first toast shows immediately', () => {
    showToast({ message: 'Meal logged' })
    expect(getToastSnapshot().current?.message).toBe('Meal logged')
  })

  it('a second toast waits while the first is visible', () => {
    showToast({ message: 'first' })
    showToast({ message: 'second' })
    expect(getToastSnapshot().current?.message).toBe('first')
  })

  it('dismissing the visible toast reveals the queued one', () => {
    showToast({ message: 'first' })
    showToast({ message: 'second' })
    dismissToast()
    expect(getToastSnapshot().current?.message).toBe('second')
  })

  it('arrival order is preserved across a three-deep queue', () => {
    showToast({ message: 'a' })
    showToast({ message: 'b' })
    showToast({ message: 'c' })
    dismissToast()
    expect(getToastSnapshot().current?.message).toBe('b')
    dismissToast()
    expect(getToastSnapshot().current?.message).toBe('c')
    dismissToast()
    expect(getToastSnapshot().current).toBeNull()
  })

  it('dismiss with nothing queued is a safe no-op', () => {
    dismissToast()
    dismissToast()
    expect(getToastSnapshot().current).toBeNull()
  })

  it('subscribers are notified on show and on dismiss', () => {
    const stop = subscribeToast((snapshot) => seen.push(snapshot.current?.message ?? '-'))
    showToast({ message: 'hello' })
    dismissToast()
    stop()
    // Re-notifications from the reset itself are filtered by re-subscribing
    // after reset (beforeEach); this listener saw exactly the two transitions.
    expect(seen).toEqual(['hello', '-'])
  })
})

describe('auto-dismiss timing — ~4s, errors read longer (report §10.1)', () => {
  it('a default toast survives 3999ms and dies at 4000ms', () => {
    showToast({ message: 'goal updated' })
    vi.advanceTimersByTime(TOAST_DURATION_MS - 1)
    expect(getToastSnapshot().current?.message).toBe('goal updated')
    vi.advanceTimersByTime(1)
    expect(getToastSnapshot().current).toBeNull()
  })

  it('the error tone keeps the card for the longer reading window', () => {
    showToast({ message: 'Could not load day', tone: 'error' })
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    expect(getToastSnapshot().current?.message).toBe('Could not load day')
    vi.advanceTimersByTime(TOAST_ERROR_DURATION_MS - TOAST_DURATION_MS)
    expect(getToastSnapshot().current).toBeNull()
  })

  it('durationMs overrides the tone default', () => {
    showToast({ message: 'undo window', action: { label: 'Undo', onPress: () => {} }, durationMs: 6000 })
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    expect(getToastSnapshot().current?.message).toBe('undo window')
    vi.advanceTimersByTime(2000)
    expect(getToastSnapshot().current).toBeNull()
  })

  it('auto-dismiss reveals the next queued toast', () => {
    showToast({ message: 'first' })
    showToast({ message: 'second' })
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    expect(getToastSnapshot().current?.message).toBe('second')
  })

  it('the timer is cancelled by manual dismissal — no zombie reveal', () => {
    showToast({ message: 'first' })
    // 'second' outlives the first toast's 4s window, so if that timer were
    // still armed it would dismiss 'second' at exactly 4000ms.
    showToast({ message: 'second', durationMs: 2 * TOAST_DURATION_MS })
    dismissToast()
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    expect(getToastSnapshot().current?.message).toBe('second')
  })
})

describe('the action — fires once, dismisses, never replaces (report §10.1)', () => {
  it('pressToastAction fires onPress and dismisses the toast', () => {
    const fired: string[] = []
    showToast({
      message: 'Meal logged',
      action: { label: 'Undo', onPress: () => fired.push('undo') },
    })
    pressToastAction()
    expect(fired).toEqual(['undo'])
    expect(getToastSnapshot().current).toBeNull()
  })

  it('a toast the action enqueues queues behind, not on top of, the waiters', () => {
    const order: string[] = []
    showToast({
      message: 'visible',
      action: {
        label: 'Undo',
        onPress: () => {
          order.push('action')
          showToast({ message: 'restored' })
        },
      },
    })
    showToast({ message: 'waiter' })
    pressToastAction()
    expect(order).toEqual(['action'])
    // 'waiter' was queued BEFORE the action's toast, so it shows next.
    expect(getToastSnapshot().current?.message).toBe('waiter')
    dismissToast()
    expect(getToastSnapshot().current?.message).toBe('restored')
  })

  it('pressToastAction without an action or visible toast is a no-op', () => {
    expect(() => pressToastAction()).not.toThrow()
    showToast({ message: 'no action here' })
    expect(() => pressToastAction()).not.toThrow()
    expect(getToastSnapshot().current?.message).toBe('no action here')
  })

  it('pressing the action clears its auto-dismiss timer', () => {
    const fired: number[] = []
    showToast({
      message: 'Meal logged',
      action: { label: 'Undo', onPress: () => fired.push(1) },
    })
    pressToastAction()
    vi.advanceTimersByTime(TOAST_ERROR_DURATION_MS)
    expect(fired).toEqual([1])
    expect(getToastSnapshot().current).toBeNull()
  })
})

describe('the host is mounted once, at the root (report §10.1)', () => {
  // Source-sweep in the wave3.test.ts style: the store can be pure all it
  // likes, but if nothing mounts the host at the app root, no toast can ever
  // render. app/_layout.tsx is the only sanctioned mount.
  const root = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../app/_layout.tsx'),
    'utf8',
  )

  it('app/_layout.tsx mounts the Toast host exactly once', () => {
    expect(root.match(/<Toast\s*\/>/g)?.length).toBe(1)
  })

  it('the host imports the store, not a second implementation', () => {
    const host = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Toast.tsx'), 'utf8')
    expect(host).toContain("from './toast-store'")
  })
})
