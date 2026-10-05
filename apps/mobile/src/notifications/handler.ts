import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { AppState, Platform } from 'react-native'
import Storage from 'expo-sqlite/kv-store'
import { onWorkoutsChanged } from '@nutai/training'
import { db } from '../data/repo'
import { ONBOARDING_DONE_KEY } from '../onboarding/done-key'
import { routeFromNotificationUrl } from '../navigation/deep-links'
import { isRoutineEditorDirty } from '../ui/editor-dirty'
import { confirmDialog } from '../ui/alert-web'
import { syncAllReminders, syncWorkoutReminders } from './scheduler'

/**
 * Notification handler + tap routing (Task 3-b).
 *
 * Installed ONCE from the root layout. While onboarding runs it never
 * requests permission and never schedules anything (the onboarding-gate
 * promise: no prompt, no reminders, before the user has finished setting up);
 * tap routing itself is live from install so an early tap is never dropped.
 * After the onboarding-done flag is seen it wires the rest:
 *
 * 1. Foreground presentation — without a handler, expo-notifications DROPS a
 *    notification that fires while the app is open. The rest-timer signal is
 *    most useful exactly when the user wandered to another screen mid-rest.
 * 2. Tap routing — the notification's data.url (a nutai:// URL from the
 *    category registry) is resolved through the deep-link map and navigated.
 *    Cold start uses getLastNotificationResponseAsync, warm taps use the
 *    response listener; a 2s same-URL debounce guards double delivery.
 * 3. Schedule upkeep — syncAllReminders re-derives the plan on install and on
 *    every foreground (covers paths that bypass the workout event bus: backup
 *    import, undo/redo), and onWorkoutsChanged re-syncs the workout-reminder
 *    horizon after any workout write.
 */

let installed = false

export function initNotifications(): void {
  if (installed || Platform.OS === 'web') return
  installed = true

  // 1. Foreground presentation. Android honours channel importance for sound.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })

  // 2. Tap routing — registered UNCONDITIONALLY, BEFORE the onboarding gate:
  // the gate check runs once per app start, so if it swallowed this block a
  // user who finished onboarding and enabled a reminder would have DEAD
  // notification taps for the whole first session. Nothing is ever scheduled
  // before onboarding completes (and a reset wipes the flag while its leftover
  // notifications are cancelled by the next foreground sync), so a pre-gate
  // tap cannot navigate anywhere dangerous — routeFromNotificationUrl only
  // follows the alias map.
  let lastRoutedUrl: string | null = null
  let lastRoutedAt = 0
  const navigateGuarded = (target: string): void => {
    // T5-fix2 (review SHOULD-FIX #1): a tap that pops the router back past the
    // routine editor dismisses the editor WITH its unsaved work — the same
    // silent discard the screen's own exits guard against. Consult the
    // editor's published dirty state (src/ui/editor-dirty.ts) and route
    // through the ONE confirm helper with the editor's exact dialog copy.
    // Only the dirty-editor state is gated: every other deep link navigates
    // exactly as before.
    if (!isRoutineEditorDirty()) {
      router.navigate(target as never)
      return
    }
    confirmDialog({
      title: 'Discard changes?',
      message: 'The routine editor has unsaved changes — discarding them cannot be undone.',
      confirmLabel: 'Discard',
      destructive: true,
      onConfirm: () => router.navigate(target as never),
    })
  }
  const route = (response: Notifications.NotificationResponse | null): void => {
    if (!response) return
    const target = routeFromNotificationUrl(response.notification.request.content.data?.url)
    if (!target) return
    const now = Date.now()
    if (target === lastRoutedUrl && now - lastRoutedAt < 2000) return // double-delivery guard
    lastRoutedUrl = target
    lastRoutedAt = now
    navigateGuarded(target)
  }
  // Cold start first (the tap that LAUNCHED the app), then warm taps.
  void Notifications.getLastNotificationResponseAsync().then(route)
  Notifications.addNotificationResponseReceivedListener(route)

  void (async () => {
    // Onboarding gate — SCHEDULE UPKEEP ONLY: the flag is written when
    // onboarding's plan screen is dismissed; until then this app has no
    // reminders to route or schedule (and no permission is ever requested
    // here — see permissions.ts for the contextual contract).
    if ((await Storage.getItem(ONBOARDING_DONE_KEY)) !== 'true') return

    // 3. Schedule upkeep.
    await syncAllReminders()
    try {
      const handle = await db()
      // Listener errors propagate after the write (documented contract) —
      // swallow here so a scheduling hiccup never surfaces as a write error.
      onWorkoutsChanged(handle, () => {
        void syncWorkoutReminders().catch(() => {})
      })
    } catch {
      // DB not openable yet (first boot right after onboarding) — the next
      // foreground re-sync covers it.
    }
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncAllReminders().catch(() => {})
    })
  })().catch(() => {
    // The whole install is best-effort; the app works with notifications off.
  })
}
