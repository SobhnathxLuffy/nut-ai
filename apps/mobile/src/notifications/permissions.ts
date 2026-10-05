import * as Notifications from 'expo-notifications'
import { Linking, Platform } from 'react-native'

/**
 * Notification permission wrapper (Task 3-b).
 *
 * THE RULE that makes the onboarding promise true ("we'll ask for notification
 * permission the first time a reminder is actually worth sending, not now"):
 * NOTHING in this module is ever called at app start or during onboarding.
 * The only call sites are (a) the /notification-settings screen when the user
 * enables a reminder category, and (b) the first rest-timer start of a
 * workout (a moment the user opted into by starting a rest).
 *
 * On web the whole notification system is unsupported (no expo-notifications
 * scheduling engine) — every helper degrades to 'unsupported' without
 * touching the module.
 */

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported'

/**
 * 'undetermined' = we never asked (Android 13+ POST_NOTIFICATIONS before the
 * first request); 'denied' = asked and refused — on Android 13+ a denial with
 * canAskAgain === false is the permanent one, reachable only through the OS
 * app-settings screen.
 */
export async function notificationPermissionState(): Promise<NotificationPermissionState> {
  if (Platform.OS === 'web') return 'unsupported'
  try {
    const status = await Notifications.getPermissionsAsync()
    if (status.granted) return 'granted'
    return status.canAskAgain ? 'undetermined' : 'denied'
  } catch {
    // An unavailable engine (some emulators) must not crash a settings screen.
    return 'unsupported'
  }
}

/**
 * The contextual request: asks ONLY when still undetermined, so a user who
 * already answered (either way) is never re-prompted from a random flow.
 * Returns the resulting state for honest follow-up copy.
 */
export async function ensureNotificationPermission(): Promise<NotificationPermissionState> {
  const state = await notificationPermissionState()
  if (state !== 'undetermined') return state
  try {
    const status = await Notifications.requestPermissionsAsync()
    return status.granted ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

/** The permanent-denial path: hand the user to the OS app settings. */
export function openSystemNotificationSettings(): void {
  if (Platform.OS === 'web') return
  void Linking.openSettings().catch(() => {
    // Nothing actionable — the row that launched this stays on screen.
  })
}
