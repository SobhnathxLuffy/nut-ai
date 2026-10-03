import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { WeightUnit } from '@nutai/analytics'
import { availability, requestPermissions } from '../src/health/healthkit'
import { db } from '../src/data/repo'
import { readWeightUnit, writeWeightUnit } from '../src/data/weight-units'
import { hapticsEnabled, setHapticsEnabled } from '../src/utils/haptics'
import { ItemRow } from '../src/components/ItemRow'
import { Screen } from '../src/components/Screen'
import { showToast } from '../src/components/toast-store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * Units & Health — UI/UX report Ch 8.8 (Wave 3) sub-page.
 *
 * Everything the Profile tab's old "Display" and "Apple Health" sections did,
 * MOVED here verbatim (not rewritten): the bodyweight display-unit toggle
 * (stored weights stay in kilograms), the §9.1 optional-haptics toggle, and
 * the native Apple Health connect/manage-access flow. On web the Health group
 * renders nothing — P2-10: it had no web implementation, so showing it would
 * be a dead control.
 */
export default function UnitsHealthSettings() {
  const theme = useTheme()
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg')
  const [hapticsOn, setHapticsOn] = useState(true)
  const [healthAvail, setHealthAvail] = useState<'available' | 'not-ios' | 'unavailable' | 'checking'>('checking')
  const [healthBusy, setHealthBusy] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        try {
          const handle = await db()
          const [unit, haptics, avail] = await Promise.all([
            readWeightUnit(handle),
            hapticsEnabled(),
            availability(),
          ])
          if (!alive) return
          setWeightUnit(unit)
          setHapticsOn(haptics)
          setHealthAvail(avail === 'available' ? 'available' : avail === 'not-ios' ? 'not-ios' : 'unavailable')
        } catch {
          // Unreadable settings keep their defaults; the toggles below stay
          // functional and write through on first change.
        }
      })()
      return () => {
        alive = false
      }
    }, []),
  )

  function changeWeightUnit(unit: WeightUnit) {
    if (unit === weightUnit) return
    const previous = weightUnit
    setWeightUnit(unit)
    void db()
      .then((handle) => writeWeightUnit(handle, unit))
      .catch(() => {
        setWeightUnit(previous)
        showToast({
          message: 'Could not save the preference — your weight display unit was not changed.',
          tone: 'error',
        })
      })
  }

  function changeHaptics(next: boolean) {
    if (next === hapticsOn) return
    setHapticsOn(next)
    void setHapticsEnabled(next)
  }

  function connectHealth() {
    if (healthBusy) return
    setHealthBusy(true)
    void (async () => {
      const res = await requestPermissions()
      setHealthBusy(false)
      // iOS never reports whether READ access was granted — claiming success
      // here would be a lie. Say what actually happened and point at Settings.
      // (UI/UX report §10.1, Wave 1b: neutral info → toast, not a dialog.)
      if (res.prompted) {
        showToast({ message: 'If you allowed access, steps and workouts will appear as they sync.' })
      } else {
        // The original dialog pointed at "the button below" — a toast can do
        // one better and BE the button (report §10.1: offer the next action).
        showToast({
          message: 'Health did not respond.',
          tone: 'error',
          action: { label: 'Open Settings', onPress: () => void Linking.openSettings() },
        })
      }
    })()
  }

  return (
    <Screen title="Units & health" back backLabel="Back to profile">
      <Text style={[type.label, { color: theme.textMuted }]}>Units</Text>
      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.body, { color: theme.text }]}>Bodyweight unit</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
          Stored weights remain in kilograms.
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          {(['kg', 'lb'] as const).map((unit) => {
            const selected = weightUnit === unit
            return (
              <Pressable
                key={unit}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => changeWeightUnit(unit)}
                style={[
                  styles.choiceButton,
                  { backgroundColor: selected ? theme.text : theme.bgElevated, borderColor: theme.border },
                ]}
              >
                <Text style={[type.label, { color: selected ? theme.bg : theme.text }]}>{unit}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {/* §9.1: the make-it-optional toggle for the Table 9.2 haptic patterns. */}
      <Text style={[type.label, { color: theme.textMuted, marginTop: space.md }]}>Feedback</Text>
      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.body, { color: theme.text }]}>Haptic feedback</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
          Success, impact and warning taps. Turn this off if you prefer silence.
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          {([
            [true, 'On'],
            [false, 'Off'],
          ] as const).map(([value, label]) => {
            const selected = hapticsOn === value
            return (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => changeHaptics(value)}
                style={[
                  styles.choiceButton,
                  { backgroundColor: selected ? theme.text : theme.bgElevated, borderColor: theme.border },
                ]}
              >
                <Text style={[type.label, { color: selected ? theme.bg : theme.text }]}>{label}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {/* P2-10: Apple Health has no web implementation — the group was a dead
          control on web and leaked an "iOS only" row into screenshots. */}
      {Platform.OS !== 'web' && (
        <>
          <Text style={[type.label, { color: theme.textMuted, marginTop: space.md }]}>Apple Health</Text>
          <View style={{ gap: space.sm }}>
            {healthAvail === 'available' ? (
              <>
                <ItemRow
                  icon="heart"
                  label={healthBusy ? 'Connecting…' : 'Connect / Reconnect'}
                  value="Steps and workouts sync from Apple Health"
                  onPress={connectHealth}
                />
                <Pressable
                  onPress={() => void Linking.openSettings()}
                  style={styles.manageAccess}
                >
                  <Text style={[type.caption, { color: theme.textMuted }]}>
                    Already answered the prompt?{' '}
                    <Text style={{ color: theme.proteinText }}>Manage access in Settings</Text>
                  </Text>
                </Pressable>
              </>
            ) : (
              <ItemRow
                icon="heart"
                label="Apple Health"
                value={healthAvail === 'not-ios' ? 'iOS only' : 'Unavailable on this device'}
              />
            )}
          </View>
        </>
      )}

      {Platform.OS === 'web' ? (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, lineHeight: 18 }]}>
          Apple Health is iOS-only, so it is absent here. Steps and workouts sync on iPhone.
        </Text>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  card: { padding: space.lg, borderRadius: radius.lg },
  choiceButton: {
    minWidth: 72,
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageAccess: { padding: space.sm, minHeight: MIN_TAP_TARGET, justifyContent: 'center' },
})
