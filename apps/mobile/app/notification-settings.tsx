import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import {
  CATEGORIES,
  type NotificationCategoryId,
} from '../src/notifications/categories'
import {
  defaultNotificationSettings,
  readNotificationSettings,
  writeCategoryEnabled,
  writeCategoryTime,
  writeMaster,
  type NotificationSettings,
} from '../src/notifications/settings'
import {
  ensureNotificationPermission,
  notificationPermissionState,
  openSystemNotificationSettings,
  type NotificationPermissionState,
} from '../src/notifications/permissions'
import { syncAllReminders } from '../src/notifications/scheduler'
import { Screen } from '../src/components/Screen'
import { ItemRow } from '../src/components/ItemRow'
import { type IconName } from '../src/components/Icon'
import { showToast } from '../src/components/toast-store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, stateLayerFor, type } from '../src/theme/tokens'

/**
 * Notification settings — Task 3-b, route /notification-settings.
 *
 * The Profile tab row that opens this page is a coordinator micro-task
 * (src/settings/profile-groups.ts is owned by a concurrent agent); this file
 * only ships the route.
 *
 * PERMISSION, kept honest against the onboarding promise ("we'll ask the
 * first time a reminder is actually worth sending, not now"): the prompt
 * fires only when the user ENABLES a category or turns the master switch on —
 * a deliberate action with an obvious reason. A permanent denial never nags:
 * the row switches to the OS-settings path.
 */

const CATEGORY_ICONS: Record<NotificationCategoryId, IconName> = {
  workout_reminder: 'dumbbell',
  rest_timer: 'clock',
  meal_reminder: 'burger',
  weigh_in: 'scale',
  daily_review: 'bookOpen',
}

const CATEGORY_HINTS: Record<NotificationCategoryId, string> = {
  workout_reminder: 'Morning-of reminder for the next scheduled program session',
  rest_timer: '“Rest complete” when a workout rest runs out',
  meal_reminder: 'A daily nudge to log, at the time you pick',
  weigh_in: 'A daily weigh-in nudge keeps your target calibrated',
  daily_review: 'Check today’s totals while they are fresh',
}

const TIME_LABELS: Record<NotificationCategoryId, string> = {
  workout_reminder: 'Reminder time',
  rest_timer: '',
  meal_reminder: 'Reminder time',
  weigh_in: 'Reminder time',
  daily_review: 'Review time',
}

export default function NotificationSettings() {
  const theme = useTheme()
  const [settings, setSettings] = useState<NotificationSettings>(defaultNotificationSettings)
  const [permission, setPermission] = useState<NotificationPermissionState>('undetermined')

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        try {
          const [next, state] = await Promise.all([readNotificationSettings(), notificationPermissionState()])
          if (!alive) return
          setSettings(next)
          setPermission(state)
        } catch {
          // Unreadable settings keep their defaults; toggles write through on change.
        }
      })()
      return () => {
        alive = false
      }
    }, []),
  )

  const requestPermission = () => {
    void (async () => {
      const state = await ensureNotificationPermission()
      setPermission(state)
      if (state === 'granted') {
        showToast({ message: 'Notifications are on — reminders can reach you now.' })
        await syncAllReminders()
      }
    })()
  }

  const toggleMaster = (next: boolean) => {
    setSettings((s) => ({ ...s, master: next }))
    void (async () => {
      try {
        if (next && permission === 'undetermined') {
          // Turning notifications ON is a meaningful moment — ask here.
          const state = await ensureNotificationPermission()
          setPermission(state)
          if (state === 'denied') {
            showToast({
              message: 'Notifications are turned off for this app in Android Settings.',
              tone: 'error',
            })
          }
        }
        await writeMaster(next)
        await syncAllReminders()
      } catch (err) {
        setSettings((s) => ({ ...s, master: !next }))
        showToast({ message: err instanceof Error ? err.message : 'Could not save the setting.', tone: 'error' })
      }
    })()
  }

  const toggleCategory = (id: NotificationCategoryId, next: boolean) => {
    setSettings((s) => ({ ...s, enabled: { ...s.enabled, [id]: next } }))
    void (async () => {
      try {
        if (next) {
          // THE contextual permission moment: enabling a reminder is when a
          // reminder becomes "actually worth sending" (onboarding §Preferences).
          const state = await ensureNotificationPermission()
          setPermission(state)
          if (state === 'denied') {
            setSettings((s) => ({ ...s, enabled: { ...s.enabled, [id]: false } }))
            showToast({
              message: 'Notifications are turned off for this app in Android Settings.',
              tone: 'error',
              action: Platform.OS === 'android' ? { label: 'Open Settings', onPress: openSystemNotificationSettings } : undefined,
            })
            return
          }
          if (state === 'unsupported') {
            setSettings((s) => ({ ...s, enabled: { ...s.enabled, [id]: false } }))
            showToast({ message: 'Reminders need the Android app — the web build cannot schedule them.', tone: 'error' })
            return
          }
        }
        await writeCategoryEnabled(id, next)
        await syncAllReminders()
      } catch (err) {
        setSettings((s) => ({ ...s, enabled: { ...s.enabled, [id]: !next } }))
        showToast({ message: err instanceof Error ? err.message : 'Could not save the setting.', tone: 'error' })
      }
    })()
  }

  const changeTime = (id: NotificationCategoryId, time: string) => {
    const previous = settings.times[id]
    setSettings((s) => ({ ...s, times: { ...s.times, [id]: time } }))
    void (async () => {
      try {
        await writeCategoryTime(id, time)
        await syncAllReminders()
      } catch (err) {
        setSettings((s) => ({ ...s, times: { ...s.times, [id]: previous } }))
        showToast({ message: err instanceof Error ? err.message : 'Could not save the time.', tone: 'error' })
      }
    })()
  }

  const permissionCopy: Record<NotificationPermissionState, string> = {
    granted: 'Allowed — reminders can reach you.',
    undetermined: 'Not asked yet — you’ll be asked when you turn a reminder on.',
    denied: 'Turned off for this app. Re-enable them in Android Settings → Notifications.',
    unsupported: 'Not available here — reminders work in the Android app.',
  }

  return (
    <Screen title="Notifications" back backLabel="Back to profile">
      {/* Master */}
      {/* 'clock' — the same honest glyph the Profile tab's Notifications row
          uses (profile-groups.ts). 'sparkles' is the AI-assistant identity
          glyph (design-system §3.1); this screen schedules nothing smart and
          no bell exists in the in-house set, so the neutral existing mark
          wins over adding a 65th glyph for one row. */}
      <ItemRow
        icon="clock"
        label="All notifications"
        value={settings.master ? 'On' : 'Off — nothing will be scheduled'}
        accessibilityLabel="All notifications"
        trailing={
          <Switch value={settings.master} onValueChange={toggleMaster} accessibilityLabel="Toggle all notifications" />
        }
      />

      {/* Permission row — the glyph tracks the state honestly (§8: no fake states). */}
      <ItemRow
        icon={permission === 'granted' ? 'check' : 'warning'}
        label="Permission"
        value={permissionCopy[permission]}
        // ItemRow composes this with the value line (T4-c P2-5) — the human
        // copy carries the state; the raw token ('undetermined') never speaks.
        accessibilityLabel="Notification permission"
        trailing={
          permission === 'undetermined' ? (
            <Pressable
              accessibilityRole="button"
              onPress={requestPermission}
              style={[styles.smallButton, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
            >
              <Text style={[type.label, { color: theme.text }]}>Allow</Text>
            </Pressable>
          ) : permission === 'denied' && Platform.OS === 'android' ? (
            <Pressable
              accessibilityRole="button"
              onPress={openSystemNotificationSettings}
              style={[styles.smallButton, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
            >
              <Text style={[type.label, { color: theme.text }]}>Open Settings</Text>
            </Pressable>
          ) : undefined
        }
      />

      <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm }]}>
        Every reminder is scheduled on this device. Nothing is sent to a server, and there is no push channel at all.
      </Text>

      {/* Categories */}
      {CATEGORIES.map((c) => {
        // The EFFECTIVE state: nothing is scheduled while the master is off,
        // so the switch must not display an enabled flag it would ignore
        // (T4-c: category switches showed raw enabled flags while master OFF).
        const enabled = settings.master && settings.enabled[c.id]
        return (
          <View key={c.id} style={{ marginTop: space.md }}>
            <View style={settings.master ? undefined : stateLayerFor(theme.isDark).disabled}>
              <ItemRow
                icon={CATEGORY_ICONS[c.id]}
                label={c.channelName}
                value={CATEGORY_HINTS[c.id]}
                accessibilityLabel={c.channelName}
                trailing={
                  <Switch
                    value={enabled}
                    disabled={!settings.master}
                    // Explicit alongside the disabled prop: the announced state
                    // must match the (non-)behavior on every platform shim.
                    accessibilityState={{ disabled: !settings.master }}
                    onValueChange={(next) => toggleCategory(c.id, next)}
                    accessibilityLabel={`Toggle ${c.channelName}`}
                  />
                }
              />
            </View>
            {enabled && c.timeKey && c.defaultTime ? (
              <View style={[styles.timeCard, { backgroundColor: theme.bgSunken }]}>
                <Text style={[type.label, { color: theme.textMuted }]}>{TIME_LABELS[c.id]}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
                  {c.presetTimes.map((preset) => {
                    const selected = settings.times[c.id] === preset
                    return (
                      <Pressable
                        key={preset}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        // Category context: "12:30, selected" alone is useless
                        // when every category offers its own chip row (T4-c).
                        accessibilityLabel={`${c.channelName} · ${preset}`}
                        onPress={() => changeTime(c.id, preset)}
                        style={[
                          styles.timeChip,
                          { backgroundColor: selected ? theme.text : theme.bgElevated, borderColor: theme.border },
                        ]}
                      >
                        <Text style={[type.label, { color: selected ? theme.bg : theme.text }]}>{preset}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            ) : null}
          </View>
        )
      })}
    </Screen>
  )
}

const styles = StyleSheet.create({
  smallButton: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  timeCard: {
    padding: space.lg,
    borderRadius: radius.lg,
    marginTop: space.xs,
  },
  timeChip: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
})
