/**
 * AndroidImportance values mirrored as plain numbers (the expo-notifications
 * enum is UNKNOWN=0/NONE=2/MIN=3/LOW=4/DEFAULT=5/HIGH=6/MAX=7) so this module
 * — and every test over it — stays importable under bare Node. The scheduler
 * passes them straight into setNotificationChannelAsync.
 */
export const CHANNEL_IMPORTANCE = { NONE: 2, DEFAULT: 5, HIGH: 6 } as const

/**
 * The notification category registry (Task 3-b, owner item #10).
 *
 * ONE table describing every local notification this app can schedule: its
 * Android channel, its settings keys, its deep link and its copy. All other
 * notifications modules (settings/scheduler/handler/UI) read from here so a
 * new category is one row + a settings key, never a grep.
 *
 * DESIGN CONTRACT (kept honest):
 * - channel id === category id — one Android channel per category, so users
 *   also get the OS-level per-channel controls for free.
 * - deep links go through the nutai:// alias map (src/navigation/deep-links.ts)
 *   and are locked by categories.test.ts.
 *
 * DEFAULTS, decided honestly against the onboarding promise
 * (OnboardingSections.tsx: "we'll ask for notification permission the first
 * time a reminder is actually worth sending"):
 * - rest_timer ships ON: it fires mid-workout, only after the user explicitly
 *   started a rest — a completion signal for a flow they opted into, not a
 *   nudge channel.
 * - every forward-looking reminder ships OFF until the user enables it in
 *   /notification-settings — enabling is also the moment permission is
 *   requested (contextual, never at startup).
 */

export type NotificationCategoryId =
  | 'workout_reminder'
  | 'rest_timer'
  | 'meal_reminder'
  | 'weigh_in'
  | 'daily_review'

export interface NotificationCategory {
  id: NotificationCategoryId
  /** === id: one Android channel per category (OS-level user controls). */
  channelId: string
  channelName: string
  /** One-sentence user-readable description for the Android channel settings sheet (T4-c P2-13). */
  channelDescription: string
  /** AndroidImportance value: DEFAULT for reminders, HIGH for the mid-workout rest timer. */
  importance: (typeof CHANNEL_IMPORTANCE)[keyof typeof CHANNEL_IMPORTANCE]
  /** Per-category on/off switch in the settings table. */
  settingsKey: string
  /** 'HH:MM' schedule field, or null when the category schedules itself (rest timer). */
  timeKey: string | null
  defaultEnabled: boolean
  /** Default 'HH:MM' for time-scheduled categories, else null. */
  defaultTime: string | null
  /** Where a tap lands — a nutai:// alias from src/navigation/deep-links.ts. */
  deepLink: string
  title: string
  body: string
  /** Preset times offered by the settings screen (no picker dependency). */
  presetTimes: readonly string[]
}

export const CATEGORIES: readonly NotificationCategory[] = [
  {
    id: 'workout_reminder',
    channelId: 'workout_reminder',
    channelName: 'Workout reminders',
    channelDescription: 'Reminds you on a scheduled program day, at the time you set.',
    importance: CHANNEL_IMPORTANCE.DEFAULT,
    settingsKey: 'notifications.workoutReminders',
    timeKey: 'notifications.workoutTime',
    defaultEnabled: false,
    defaultTime: '08:00',
    deepLink: 'nutai://train',
    title: 'Workout day',
    // The scheduler appends the program/routine names when they resolve.
    body: 'A session is on the schedule today.',
    presetTimes: ['07:00', '08:00', '09:00', '17:00', '18:00', '19:00'],
  },
  {
    id: 'rest_timer',
    channelId: 'rest_timer',
    channelName: 'Rest timer',
    channelDescription: 'Fires the moment a workout rest timer runs out.',
    importance: CHANNEL_IMPORTANCE.HIGH,
    settingsKey: 'notifications.restTimer',
    timeKey: null,
    defaultEnabled: true,
    defaultTime: null,
    deepLink: 'nutai://workout',
    title: 'Rest complete',
    body: 'Next set when you are ready.',
    presetTimes: [],
  },
  {
    id: 'meal_reminder',
    channelId: 'meal_reminder',
    channelName: 'Meal reminders',
    channelDescription: 'A daily nudge to log a meal at the time you pick.',
    importance: CHANNEL_IMPORTANCE.DEFAULT,
    settingsKey: 'notifications.mealReminders',
    timeKey: 'notifications.mealTime',
    defaultEnabled: false,
    defaultTime: '12:30',
    deepLink: 'nutai://log',
    title: 'Time to log a meal',
    body: 'A quick photo keeps the day honest.',
    presetTimes: ['08:00', '12:00', '12:30', '13:00', '18:30', '19:00'],
  },
  {
    id: 'weigh_in',
    channelId: 'weigh_in',
    channelName: 'Weigh-in reminders',
    channelDescription: 'A daily nudge to weigh in at the time you pick.',
    importance: CHANNEL_IMPORTANCE.DEFAULT,
    settingsKey: 'notifications.weighIn',
    timeKey: 'notifications.weighInTime',
    defaultEnabled: false,
    defaultTime: '07:30',
    deepLink: 'nutai://weight',
    title: 'Weigh-in reminder',
    body: 'A quick weigh-in keeps your calorie target calibrated.',
    presetTimes: ['06:30', '07:00', '07:30', '08:00', '08:30'],
  },
  {
    id: 'daily_review',
    channelId: 'daily_review',
    channelName: 'Daily review',
    channelDescription: 'An evening nudge to check the day’s totals while they are fresh.',
    importance: CHANNEL_IMPORTANCE.DEFAULT,
    settingsKey: 'notifications.dailyReview',
    timeKey: 'notifications.dailyReviewTime',
    defaultEnabled: false,
    defaultTime: '20:30',
    deepLink: 'nutai://checkin',
    title: 'Daily review is ready',
    body: 'Check today’s totals while they are fresh.',
    presetTimes: ['20:00', '20:30', '21:00', '21:30', '22:00'],
  },
]

/** Registry accessor — CATEGORIES is the same array; this exists for the UI's typed iteration. */
export function notificationCategories(): readonly NotificationCategory[] {
  return CATEGORIES
}

export function categoryById(id: NotificationCategoryId): NotificationCategory {
  const found = CATEGORIES.find((c) => c.id === id)
  if (!found) throw new Error(`Unknown notification category: ${id}`)
  return found
}
