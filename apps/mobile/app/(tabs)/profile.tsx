import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Linking, Platform } from 'react-native'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { WeightUnit } from '@nutai/analytics'
import type { ProviderId } from '@nutai/prompt'
import { availability, requestPermissions } from '../../src/health/healthkit'
import { exportAndShareBackup, finishRestore, importBackup, pickBackupFile } from '../../src/data/backup'
import { currentGoal, db, resetEverything, setting, type CurrentGoal } from '../../src/data/repo'
import { readWeightUnit, writeWeightUnit } from '../../src/data/weight-units'
import { loadCredential, maskCredential } from '../../src/inference/credentials'
import { PROVIDER_NAME } from '../../src/components/CredentialForm'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../../src/theme/tokens'
import { showToast } from '../../src/components/toast-store'
import { confirmDialog } from '../../src/ui/alert-web'

/**
 * Profile.
 *
 * Structurally the reference's settings list, minus everything that only exists
 * to extract money or attention:
 *
 *   NO "Refer a friend and earn $10" — a referral bounty is a growth mechanic,
 *   and there is no money here to pay it with.
 *   NO "Upgrade to Family Plan", no Premium crown. There is no paid tier.
 *   NO Logout / Delete Account. There is no account and no server; a delete
 *     button that only clears local data should say exactly that, which is what
 *     "Erase all data" below does.
 *   NO Follow Us. A settings screen is not a marketing surface.
 */
export default function Profile() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [healthAvail, setHealthAvail] = useState<'available' | 'not-ios' | 'unavailable' | 'checking'>('checking')
  const [healthBusy, setHealthBusy] = useState(false)
  const [diet, setDiet] = useState('')
  const [providerLabel, setProviderLabel] = useState('—')
  const [dataBusy, setDataBusy] = useState(false)
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg')
  // A failed profile load must be distinguishable from genuinely empty data —
  // otherwise the screen shows '—' placeholders forever with no way to retry.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        try {
          const handle = await db()
          const [g, avail, d, p, unit] = await Promise.all([
            currentGoal(),
            availability(),
            setting('diet.style', 'balanced'),
            setting('provider'),
            readWeightUnit(handle),
          ])
          if (!alive) return
          setGoal(g)
          setDiet(d)
          setWeightUnit(unit)
          setHealthAvail(avail === 'available' ? 'available' : avail === 'not-ios' ? 'not-ios' : 'unavailable')
          if (!p || p === 'none') {
            setProviderLabel('Not connected')
          } else {
            const cred = await loadCredential(p as ProviderId)
            if (!alive) return
            setProviderLabel(
              cred
                ? `${PROVIDER_NAME[p as ProviderId]} · ${maskCredential(cred.value)}`
                : `${PROVIDER_NAME[p as ProviderId]} · key missing`,
            )
          }
          if (alive) setLoadError(null)
        } catch (caught) {
          if (alive) setLoadError(caught instanceof Error ? caught.message : 'Could not load your profile.')
        }
      })()
      return () => {
        alive = false
      }
    }, [reloadKey]),
  )

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

  function exportData() {
    if (dataBusy) return
    setDataBusy(true)
    void (async () => {
      try {
        const res = await exportAndShareBackup()
        if (!res.shared) showToast({ message: `Exported — saved to ${res.name}.`, tone: 'success' })
      } catch {
        showToast({ message: 'Could not write the backup file. Try again.', tone: 'error' })
      } finally {
        setDataBusy(false)
      }
    })()
  }

  function importData() {
    if (dataBusy) return
    void (async () => {
      const picked = await pickBackupFile()
      if (!picked.ok) {
        if (picked.reason !== 'cancelled') {
          showToast({ message: "That doesn't look like a Nut AI backup file.", tone: 'error' })
        }
        return
      }
      // UI/UX report §10.1 rule two: a restore REPLACES all device data and
      // cannot be undone — this stays a destructive confirmation.
      confirmDialog({
        title: 'Restore this backup?',
        message: 'This replaces ALL data currently on this device and cannot be undone.',
        confirmLabel: 'Restore',
        destructive: true,
        onConfirm: () => {
          setDataBusy(true)
          void (async () => {
            try {
              const outcome = await importBackup(picked.payload)
              if (!outcome.ok) {
                showToast({
                  message: 'Cannot restore — this backup is from a newer version of Nut AI. Update the app first.',
                  tone: 'error',
                })
                return
              }
              await finishRestore()
              router.replace('/(tabs)' as never)
            } catch (e) {
              // A restore that fails must SAY SO — the transaction rolled
              // back, nothing was lost, and silence here cost us a real
              // debugging session once already.
              showToast({ message: `Nothing was changed. ${String((e as Error)?.message ?? e)}`, tone: 'error' })
            } finally {
              setDataBusy(false)
            }
          })()
        },
      })
    })()
  }

  function changeWeightUnit(unit: WeightUnit) {
    if (unit === weightUnit) return
    const previous = weightUnit
    setWeightUnit(unit)
    void db()
      .then((handle) => writeWeightUnit(handle, unit))
      .catch(() => {
        setWeightUnit(previous)
        showToast({ message: 'Could not save the preference — your weight display unit was not changed.', tone: 'error' })
      })
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[type.title, { color: theme.text }]}>Profile</Text>

      {loadError ? (
        <View accessibilityRole="alert" style={[styles.hero, { backgroundColor: theme.safetyBg, flexDirection: 'row', alignItems: 'center', gap: space.md }] }>
          <Text style={[type.caption, { color: theme.safety, flex: 1, lineHeight: 19 }]}>
            Could not load your profile. {loadError}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading profile"
            onPress={() => setReloadKey(k => k + 1)}
            hitSlop={space.sm}
            style={{ minHeight: MIN_TAP_TARGET, justifyContent: 'center', paddingHorizontal: space.sm }}
          >
            <Text style={[type.bodyStrong, { color: theme.safety }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.hero, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>No account needed</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
          Everything lives on this device. There is no sign-in, no server, and nothing to breach.
        </Text>
      </View>

      <Section title="Goals & tracking">
        <Row
          label="Daily target"
          value={goal ? `${Math.round(goal.targetKcal)} kcal` : '—'}
          onPress={() => router.push('/edit-goals' as never)}
        />
        <Row
          label="Protein / Carbs / Fat"
          value={goal ? `${Math.round(goal.protein_g)} / ${Math.round(goal.carbs_g)} / ${Math.round(goal.fat_g)} g` : '—'}
          onPress={() => router.push('/edit-goals' as never)}
        />
        <Row label="Log weight" value="" onPress={() => router.push('/log-weight' as never)} />
        <Row label="Diet style" value={diet} />
        <Row
          label="Adaptive target"
          value={goal ? (goal.adaptive ? 'On' : 'Off — set by hand') : '—'}
        />
      </Section>

      <Section title="AI provider">
        <Row label="Provider & key" value={providerLabel} onPress={() => router.push('/provider-settings' as never)} />
      </Section>

      <Section title="Display">
        <View style={{ padding: space.lg }}>
          <Text style={[type.body, { color: theme.text }]}>Bodyweight unit</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>Stored weights remain in kilograms.</Text>
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
                    styles.unitButton,
                    { backgroundColor: selected ? theme.text : theme.bgElevated, borderColor: theme.border },
                  ]}
                >
                  <Text style={[type.label, { color: selected ? theme.bg : theme.text }]}>{unit}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      </Section>

      {/* P2-10: Apple Health has no web implementation — the section was a dead
          control on web and leaked an "iOS only" row into screenshots. */}
      {Platform.OS !== 'web' && (
      <Section title="Apple Health">
        {healthAvail === 'available' ? (
          <>
            <Row
              label={healthBusy ? 'Connecting…' : 'Connect / Reconnect'}
              value=""
              onPress={connectHealth}
            />
            <Pressable onPress={() => void Linking.openSettings()} style={{ padding: space.lg, paddingTop: 0 }}>
              <Text style={[type.caption, { color: theme.textMuted }]}>
                Already answered the prompt? <Text style={{ color: theme.protein }}>Manage access in Settings</Text>
              </Text>
            </Pressable>
          </>
        ) : (
          <Row label="Apple Health" value={healthAvail === 'not-ios' ? 'iOS only' : 'Unavailable on this device'} />
        )}
      </Section>
      )}

      <Section title="Your data">
        <Row label={dataBusy ? 'Working…' : 'Export data'} value="" onPress={exportData} />
        <Row label="Import data" value="" onPress={importData} />
        <Text style={[type.caption, { color: theme.textFaint, padding: space.lg, paddingTop: space.xs, lineHeight: 18 }]}>
          One JSON file with everything: meals, weights, goals, settings. Your API key never
          travels in it — re-enter that once after restoring on a new phone.
        </Text>
      </Section>

      <Section title="How your numbers work">
        {goal ? (
          <View style={{ padding: space.lg, gap: space.sm }}>
            <Line label="BMR (Mifflin-St Jeor)" value={`${Math.round(goal.bmr)} kcal`} />
            <Line label="TDEE (BMR × activity)" value={`${Math.round(goal.tdee)} kcal`} />
            <Line label="Your target" value={`${Math.round(goal.targetKcal)} kcal`} />
            {goal.floorApplied ? (
              <Text style={[type.caption, { color: theme.uncertain, marginTop: space.xs }]}>
                Raised to our safe floor. Your inputs alone gave {Math.round(goal.targetRawKcal)} kcal.
              </Text>
            ) : null}
          </View>
        ) : null}
        <Row label="How food & dish data works" value="" onPress={() => router.push('/data-methods' as never)} />
        <Text style={[type.caption, { color: theme.textFaint, padding: space.lg, paddingTop: space.xs, lineHeight: 18 }]}>
          Where the ingredient data comes from, how dish recipes are counted, how the compose page builds your
          version, and why a dish opens at 150 g.
        </Text>
      </Section>

      <Section title="Start over">
        <Row
          label="Redo onboarding"
          value=""
          onPress={() => {
            // UI/UX report §10.1 rule two: erasing everything is THE
            // destructive confirmation — it stays a dialog.
            confirmDialog({
              title: 'Erase everything and start over?',
              message:
                'Deletes your profile, goals, weight history, logged meals and saved API keys from this device. It cannot be undone, and there is no backup on a server because there is no server.',
              confirmLabel: 'Erase and restart',
              destructive: true,
              onConfirm: () => {
                void resetEverything()
                  .then(() => router.replace('/onboarding' as never))
                  .catch((error: unknown) => {
                    // A half-completed wipe must not strand the user on a
                    // broken profile screen; surface it and keep them here.
                    console.error('[profile] resetEverything failed', error)
                  })
              },
            })
          }}
        />
      </Section>

      <Section title="About">
        <Row label="License" value="AGPL-3.0" />
        <Row label="Nutrition data" value="IFCT 2017 + USDA" />
        <Text style={[type.caption, { color: theme.textFaint, padding: space.lg, paddingTop: 0, lineHeight: 18 }]}>
          IFCT: ICMR-NIN, used with permission. USDA FoodData Central: public domain.
          Open Food Facts barcode data: ODbL 1.0.
        </Text>
      </Section>

      <Text style={[type.caption, { color: theme.textFaint, marginTop: space.xl, lineHeight: 19 }]}>
        Nut AI's estimates are AI-generated approximations and may not be accurate. It is not a
        medical device and does not diagnose, treat, cure or prevent any condition. Consult a
        registered dietitian or healthcare provider before making medical decisions.
      </Text>
    </ScrollView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ marginTop: space.xl }}>
      <Text style={[type.label, { color: theme.textMuted, marginBottom: space.sm }]}>{title}</Text>
      <View style={[styles.group, { backgroundColor: theme.bgSunken }]}>{children}</View>
    </View>
  )
}

function Row({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const theme = useTheme()
  const body = (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Text style={[type.body, { color: theme.text, flex: 1 }]}>{label}</Text>
      {value ? <Text style={[type.body, { color: theme.textMuted }]}>{value}</Text> : null}
      {onPress ? (
        <View style={{ marginLeft: space.sm }}>
          <Icon name="chevron" size={16} color={theme.textFaint} />
        </View>
      ) : null}
    </View>
  )
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  )
}

function Line({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.caption, { color: theme.text, fontWeight: '600' }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { marginTop: space.lg, padding: space.lg, borderRadius: radius.xl },
  group: { borderRadius: radius.xl, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  unitButton: {
    minWidth: 72,
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
