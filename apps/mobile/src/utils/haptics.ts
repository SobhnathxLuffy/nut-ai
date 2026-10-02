import * as Haptics from 'expo-haptics'
import { putSetting, setting } from '../data/repo'

/**
 * The haptics wrapper — UI/UX Transformation Report §9.1 / Table 9.2 (Wave 1c).
 *
 * One rule from the HIG the report adopts: "a haptic must reinforce a
 * cause-and-effect relationship, and never the same pattern for opposite
 * meanings." Logging lands success; a completed set lands light impact; a
 * destructive confirm lands warning; failures land error. Sheets stay silent
 * (motion carries them).
 *
 * Haptics remain OPTIONAL: the `haptics_enabled` settings key (default on) is
 * read once and cached, so a call site never awaits a DB round-trip per tap.
 * Web is a no-op by construction — expo-haptics has no web engine — and every
 * native call is wrapped so a missing engine can never break a write path.
 */

export const HAPTICS_SETTING_KEY = 'haptics_enabled'

/** `null` = not loaded yet; the first read is kicked off at import time. */
let cachedEnabled: boolean | null = null
let inflight: Promise<void> | null = null

async function ensureSettingLoaded(): Promise<void> {
  if (cachedEnabled !== null) return
  if (!inflight) {
    inflight = (async () => {
      try {
        cachedEnabled = (await setting(HAPTICS_SETTING_KEY, 'on')) !== 'off'
      } catch {
        // Unreadable setting falls back to the documented default: on.
        cachedEnabled = true
      } finally {
        inflight = null
      }
    })()
  }
  await inflight
}

// NOTE: no import-time warm-up. Reading the setting awaits db() (migrate +
// seed), and the app deliberately keeps boot free of that work (Home's P2-36
// first-paint discipline). The read runs lazily on the first haptic — by then
// the action that earned the haptic has already warmed the DB, so the SELECT
// costs single-digit milliseconds and nothing at startup regresses.

/** The settings row reads here — resolves the cached toggle (loading once). */
export async function hapticsEnabled(): Promise<boolean> {
  await ensureSettingLoaded()
  return cachedEnabled !== false
}

async function fire(fn: () => Promise<void>): Promise<void> {
  await ensureSettingLoaded()
  if (cachedEnabled === false) return
  try {
    await fn()
  } catch {
    // Haptics is best-effort feedback; a failed buzz must never fail the action.
  }
}

/** Value changes: pickers, chips, segmented rows (Table 9.2 "Selection"). */
export function selectionAsync(): Promise<void> {
  return fire(() => Haptics.selectionAsync())
}

/** Core reward moment: meal / weight logged, recipe saved (Table 9.2 "Success"). */
export function success(): Promise<void> {
  return fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
}

/** Fast, physical, repeatable: set completed, shutter captured (Table 9.2 "Light impact"). */
export function lightImpact(): Promise<void> {
  return fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light))
}

/** Destructive intent confirmed (Table 9.2 "Warning"). */
export function warning(): Promise<void> {
  return fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning))
}

/** Negative outcome surfaced (Table 9.2 "Error"). */
export function error(): Promise<void> {
  return fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error))
}

/** The settings row writes here so the cache stays in sync without a re-read. */
export async function setHapticsEnabled(next: boolean): Promise<void> {
  cachedEnabled = next
  try {
    await putSetting(HAPTICS_SETTING_KEY, next ? 'on' : 'off')
  } catch {
    // The write failed; the in-memory cache still reflects the user's intent
    // for this session. next start re-reads the stored value.
  }
}

/** Test-only: isolated state per case (module state survives across tests). */
export function __resetHapticsForTests(): void {
  cachedEnabled = null
  inflight = null
}

/** Test-only: peek at the cache. */
export function __hapticsCacheForTests(): boolean | null {
  return cachedEnabled
}
