import { putSetting, setting } from '../data/repo'
import { CATEGORIES, categoryById, type NotificationCategoryId } from './categories'
import { parseHHMM } from './schedule'

/**
 * Notification settings (Task 3-b) — stored in the EXISTING settings
 * key-value table via the repo's setting/putSetting helpers.
 *
 * AGENTS §10 note: no new persisted store, therefore no migration and no new
 * backup surface — the settings table is already exported/imported by the
 * backup rules. The scheduled-notification state itself is NOT persisted
 * app-side at all: it lives in expo-notifications' native store and is
 * re-derived from these keys on every sync (init, foreground, settings
 * change, workout write). Wipe/restore the settings table and the schedule
 * rebuilds to match.
 *
 * Toggle values are the strings 'on'/'off' (the repo-wide convention,
 * cf. haptics_enabled). Times are strict 'HH:MM' 24h strings; a corrupt row
 * falls back to the documented default instead of throwing.
 */

export const NOTIFICATIONS_MASTER_KEY = 'notifications.enabled'

export interface NotificationSettings {
  /** Master switch — OFF cancels and suppresses every category. */
  master: boolean
  /** Per-category on/off, keyed by category id. */
  enabled: Record<NotificationCategoryId, boolean>
  /** Per-category 'HH:MM' schedule (only where the category has a timeKey). */
  times: Partial<Record<NotificationCategoryId, string>>
}

function parseToggle(raw: string | undefined, fallback: boolean): boolean {
  if (raw !== 'on' && raw !== 'off') return fallback
  return raw === 'on'
}

/** The documented defaults: master on, rest timer on (in-flow signal), every forward-looking reminder off. */
export function defaultNotificationSettings(): NotificationSettings {
  const enabled = {} as Record<NotificationCategoryId, boolean>
  const times: Partial<Record<NotificationCategoryId, string>> = {}
  for (const c of CATEGORIES) {
    enabled[c.id] = c.defaultEnabled
    if (c.timeKey && c.defaultTime) times[c.id] = c.defaultTime
  }
  return { master: true, enabled, times }
}

/** Reads every notifications.* key in one pass; absent/corrupt rows fall back to defaults. */
export async function readNotificationSettings(): Promise<NotificationSettings> {
  const defaults = defaultNotificationSettings()
  const master = parseToggle(await setting(NOTIFICATIONS_MASTER_KEY, ''), defaults.master)
  const enabled = {} as Record<NotificationCategoryId, boolean>
  const times: Partial<Record<NotificationCategoryId, string>> = {}
  for (const c of CATEGORIES) {
    enabled[c.id] = parseToggle(await setting(c.settingsKey, ''), c.defaultEnabled)
    if (c.timeKey) {
      const raw = await setting(c.timeKey, '')
      const parsed = parseHHMM(raw)
      const fallback = c.defaultTime
      if (fallback) times[c.id] = parsed ? raw : fallback
    }
  }
  return { master, enabled, times }
}

export async function writeMaster(next: boolean): Promise<void> {
  await putSetting(NOTIFICATIONS_MASTER_KEY, next ? 'on' : 'off')
}

export async function writeCategoryEnabled(categoryId: NotificationCategoryId, next: boolean): Promise<void> {
  await putSetting(categoryById(categoryId).settingsKey, next ? 'on' : 'off')
}

/** Validates the schedule field at the write boundary — a malformed time never enters the settings table. */
export async function writeCategoryTime(categoryId: NotificationCategoryId, time: string): Promise<void> {
  const c = categoryById(categoryId)
  if (!c.timeKey) throw new Error(`${c.channelName} has no schedule field`)
  if (!parseHHMM(time)) throw new Error(`Invalid reminder time: ${time}`)
  await putSetting(c.timeKey, time)
}
