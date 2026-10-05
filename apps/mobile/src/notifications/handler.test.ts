import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Notifications from 'expo-notifications'

/**
 * Task 3-b — the root-install glue (foreground handler + tap routing +
 * gated schedule upkeep), locked through the same vi.mock DI seam as
 * scheduler.test.ts.
 *
 * The load-bearing behaviors:
 * - tap routing registers on install EVEN BEFORE the onboarding gate passes
 *   (the gate check runs once per app start — gating routing behind it would
 *   make every first-session notification tap dead);
 * - the data.url alias resolves through the REAL deep-link map, query kept
 *   (rest → workout?id=…), unknown aliases dropped;
 * - the 2s same-URL debounce collapses double delivery;
 * - schedule upkeep (syncAllReminders / workout-change re-sync / foreground
 *   re-sync) stays BEHIND the onboarding-done gate, and no permission is ever
 *   requested here.
 */

let warmTapListener: ((response: Notifications.NotificationResponse) => void) | null = null
let appStateListener: ((state: string) => void) | null = null
let coldStartResponse: Notifications.NotificationResponse | null = null

vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  getLastNotificationResponseAsync: vi.fn(async () => coldStartResponse),
  addNotificationResponseReceivedListener: vi.fn((listener: (r: Notifications.NotificationResponse) => void) => {
    warmTapListener = listener
  }),
}))

const navigate = vi.fn()
vi.mock('expo-router', () => ({ router: { navigate: navigate } }))

// T5-fix2 — the ONE confirm helper (the editor's own exits use the same
// copy via confirmDiscardThen) and the dirty seam it consults.
const confirmDialog = vi.fn()
vi.mock('../ui/alert-web', () => ({ confirmDialog }))
const editorDirty = vi.hoisted(() => ({ dirty: false }))
vi.mock('../ui/editor-dirty', () => ({
  isRoutineEditorDirty: () => editorDirty.dirty,
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: {
    addEventListener: (_type: string, listener: (s: string) => void) => {
      appStateListener = listener
    },
  },
}))

const kvRows: Record<string, string> = {}
vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: async (key: string) => kvRows[key] ?? null },
}))

vi.mock('../data/repo', () => ({ db: vi.fn(async () => ({})) }))
const onWorkoutsChanged = vi.fn()
vi.mock('@nutai/training', () => ({ onWorkoutsChanged: onWorkoutsChanged }))

const syncAll = vi.fn(async () => {})
const syncWorkout = vi.fn(async () => {})
vi.mock('./scheduler', () => ({
  syncAllReminders: syncAll,
  syncWorkoutReminders: syncWorkout,
}))

import { ONBOARDING_DONE_KEY } from '../onboarding/done-key'

/** A tap response carrying a notification data.url. */
const tapped = (url: string): Notifications.NotificationResponse =>
  ({ notification: { request: { content: { data: { url } } } } }) as unknown as Notifications.NotificationResponse

/** Flush the fire-and-forget install chain (mocked asyncs settle in microtasks/timers). */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Fresh module graph per test so the module-level `installed` latch resets. */
async function load(): Promise<typeof import('./handler')> {
  vi.resetModules()
  return import('./handler')
}

beforeEach(() => {
  vi.clearAllMocks()
  warmTapListener = null
  appStateListener = null
  coldStartResponse = null
  editorDirty.dirty = false
  for (const key of Object.keys(kvRows)) delete kvRows[key]
})

describe('initNotifications — install, routing and the onboarding gate', () => {
  it('routes nothing and syncs nothing while onboarding has not completed', async () => {
    const { initNotifications } = await load()
    initNotifications()
    await flush()
    expect(navigate).not.toHaveBeenCalled()
    expect(syncAll).not.toHaveBeenCalled()
    expect(onWorkoutsChanged).not.toHaveBeenCalled()
  })

  it('registers tap routing BEFORE the gate — a first-session tap is never dead', async () => {
    const { initNotifications } = await load()
    initNotifications()
    await flush()
    // Onboarding NOT done, yet the warm-tap listener is already live.
    expect(warmTapListener).toBeTypeOf('function')
    warmTapListener!(tapped('nutai://weight'))
    expect(navigate).toHaveBeenCalledWith('/log-weight')
  })

  it('resolves the REAL deep-link map, keeping the query (rest → workout?id=…)', async () => {
    const { initNotifications } = await load()
    kvRows[ONBOARDING_DONE_KEY] = 'true'
    initNotifications()
    await flush()
    warmTapListener!(tapped('nutai://workout?id=7'))
    expect(navigate).toHaveBeenCalledWith('/workout?id=7')
  })

  it('routes the cold-start tap that launched the app', async () => {
    const { initNotifications } = await load()
    kvRows[ONBOARDING_DONE_KEY] = 'true'
    coldStartResponse = tapped('nutai://checkin')
    initNotifications()
    await flush()
    expect(navigate).toHaveBeenCalledWith('/checkin')
  })

  it('drops the same URL twice within the debounce window and unknown aliases always', async () => {
    const { initNotifications } = await load()
    initNotifications()
    await flush()
    warmTapListener!(tapped('nutai://train'))
    warmTapListener!(tapped('nutai://train'))
    expect(navigate).toHaveBeenCalledTimes(1)
    warmTapListener!(tapped('nutai://nope'))
    warmTapListener!(tapped('https://example.com'))
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('after onboarding completes: syncs once, wires the workout re-sync and the foreground re-sync', async () => {
    const { initNotifications } = await load()
    kvRows[ONBOARDING_DONE_KEY] = 'true'
    initNotifications()
    await flush()
    expect(syncAll).toHaveBeenCalledTimes(1)
    expect(onWorkoutsChanged).toHaveBeenCalledTimes(1)
    ;(onWorkoutsChanged.mock.calls[0]![1] as () => void)()
    await flush()
    expect(syncWorkout).toHaveBeenCalledTimes(1)
    expect(appStateListener).toBeTypeOf('function')
    appStateListener!('active')
    await flush()
    expect(syncAll).toHaveBeenCalledTimes(2)
    appStateListener!('background')
    await flush()
    expect(syncAll).toHaveBeenCalledTimes(2)
  })
})

describe('T5-fix2 — the dirty routine editor gates deep-link navigation', () => {
  it('routes DIRECTLY while the routine editor is closed or clean (no dialog, ever)', async () => {
    editorDirty.dirty = false
    const { initNotifications } = await load()
    initNotifications()
    await flush()
    warmTapListener!(tapped('nutai://train'))
    expect(navigate).toHaveBeenCalledWith('/train')
    expect(confirmDialog).not.toHaveBeenCalled()
  })

  it('a dirty editor gets the "Discard changes?" confirm INSTEAD of navigation, and confirming navigates', async () => {
    editorDirty.dirty = true
    const { initNotifications } = await load()
    initNotifications()
    await flush()
    warmTapListener!(tapped('nutai://train'))
    // The silent discard is gone: navigation waits for the user.
    expect(navigate).not.toHaveBeenCalled()
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    const options = confirmDialog.mock.calls[0]![0] as {
      title: string
      message: string
      confirmLabel: string
      destructive: boolean
      onConfirm: () => void
    }
    expect(options.title).toBe('Discard changes?')
    expect(options.message).toContain('unsaved changes')
    expect(options.confirmLabel).toBe('Discard')
    expect(options.destructive).toBe(true)
    // Accepting the discard completes exactly the navigation the tap asked for.
    options.onConfirm()
    expect(navigate).toHaveBeenCalledWith('/train')
  })
})
