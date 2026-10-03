import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { WeightUnit } from '@nutai/analytics'
import type { ProviderId } from '@nutai/prompt'
import { currentGoal, customProviderBaseUrl, db, setting, weightHistory, type CurrentGoal } from '../../src/data/repo'
import { readWeightUnit } from '../../src/data/weight-units'
import { loadCredential, maskCredential } from '../../src/inference/credentials'
import { PROVIDER_NAME } from '../../src/components/CredentialForm'
import { Disclosure } from '../../src/components/Disclosure'
import { ItemRow } from '../../src/components/ItemRow'
import { hapticsEnabled, selectionAsync } from '../../src/utils/haptics'
import { useTheme } from '../../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../../src/theme/tokens'
import {
  PROFILE_GROUPS,
  formatDiagnosticsValue,
  formatGoalsValue,
  formatProviderValue,
  formatWeightValue,
  groupDigits,
} from '../../src/settings/profile-groups'

/**
 * Profile — UI/UX report Ch 8.8 (Wave 3): "iOS grouped-list architecture with
 * sub-pages… Each settings row uses the Item primitive: icon, label, current
 * value in muted text, chevron. The result scans in half a screen and every
 * power option remains two taps away."
 *
 * The old eight-section single scroll (goals, provider, units, health, data,
 * about, licenses, disclaimer) is now this grouped list; every section's
 * content MOVED into its sub-page (see PROFILE_GROUPS in
 * src/settings/profile-groups.ts for the structure-as-data and the honest
 * value formatters). Row values are LIVE reads — the goal row shows the
 * target actually in force, the weight row the newest entry, the provider row
 * the configured key, the data row the real meal count. Never placeholder
 * text (AGENTS.md honesty rule).
 *
 * Structurally the reference's settings list, minus everything that only
 * exists to extract money or attention:
 *
 *   NO "Refer a friend and earn $10" — a referral bounty is a growth mechanic,
 *   and there is no money here to pay it with.
 *   NO "Upgrade to Family Plan", no Premium crown. There is no paid tier.
 *   NO Logout / Delete Account. There is no account and no server; the erase
 *     lives in "Your data" and says exactly what it does.
 *   NO Follow Us. A settings screen is not a marketing surface.
 */
export default function Profile() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [diet, setDiet] = useState('')
  const [lastWeightKg, setLastWeightKg] = useState<number | null>(null)
  const [mealCount, setMealCount] = useState<number | null>(null)
  const [providerLabel, setProviderLabel] = useState<string | null>(null)
  const [keyMask, setKeyMask] = useState<string | null>(null)
  const [gatewayHost, setGatewayHost] = useState<string | null>(null)
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg')
  const [hapticsOn, setHapticsOn] = useState(true)
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
          const [g, d, p, unit, haptics, weights, mealRow, base] = await Promise.all([
            currentGoal(),
            setting('diet.style', 'balanced'),
            setting('provider'),
            readWeightUnit(handle),
            hapticsEnabled(),
            weightHistory(),
            handle.get<{ n: number }>('SELECT COUNT(*) AS n FROM meals WHERE deleted_at IS NULL'),
            customProviderBaseUrl(),
          ])
          if (!alive) return
          setGoal(g)
          setDiet(d)
          setWeightUnit(unit)
          setHapticsOn(haptics)
          setLastWeightKg(weights.length > 0 ? (weights[weights.length - 1]!.weightKg) : null)
          setMealCount(mealRow?.n ?? 0)
          setGatewayHost(base ? hostOf(base) : null)
          if (!p || p === 'none') {
            setProviderLabel(null)
            setKeyMask(null)
          } else {
            const cred = await loadCredential(p as ProviderId)
            if (!alive) return
            setProviderLabel(PROVIDER_NAME[p as ProviderId])
            setKeyMask(cred ? maskCredential(cred.value) : null)
          }
          setLoadError(null)
        } catch (caught) {
          if (alive) setLoadError(caught instanceof Error ? caught.message : 'Could not load your profile.')
        }
      })()
      return () => {
        alive = false
      }
    }, [reloadKey]),
  )

  /** Table 9.2 selection haptic + navigate — every row goes somewhere. */
  function go(route: string) {
    void selectionAsync()
    router.push(route as never)
  }

  /** The live muted value per row key — honest reads, never placeholders. */
  const rowValues: Record<string, string> = {
    goals: formatGoalsValue(goal),
    'log-weight': formatWeightValue(lastWeightKg, weightUnit),
    provider: providerLabel
      ? formatProviderValue(providerLabel, keyMask ? `key ${keyMask}` : 'key missing')
      : 'Not connected',
    units: `Bodyweight in ${weightUnit} · Haptics ${hapticsOn ? 'on' : 'off'}`,
    data: mealCount != null ? `${groupDigits(mealCount)} meals logged` : '—',
    'data-methods': 'Where every number comes from',
    about: 'Licenses & medical disclaimer',
    diagnostics: formatDiagnosticsValue(providerLabel, gatewayHost),
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[type.title, { color: theme.text }]}>Profile</Text>

      {loadError ? (
        <View accessibilityRole="alert" style={[styles.hero, { backgroundColor: theme.safetyBg, flexDirection: 'row', alignItems: 'center', gap: space.md }]}>
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

      {PROFILE_GROUPS.map((group) => (
        <View key={group.key} style={styles.group}>
          <Text style={[type.label, { color: theme.textMuted }]}>{group.title}</Text>
          <View style={{ gap: space.sm }}>
            {group.rows.map((row) => (
              <ItemRow
                key={row.key}
                icon={row.icon}
                label={row.label}
                value={rowValues[row.key] ?? '—'}
                onPress={() => go(row.route)}
              />
            ))}
            {/* The old "How your numbers work" block, folded into the Goals
                group as an expandable disclosure — BMR/TDEE/target read live
                from the goal actually in force. */}
            {group.key === 'goals' && goal ? (
              <Disclosure label="How your numbers work" caption="BMR, TDEE and the target in force">
                <View style={{ gap: space.xs }}>
                  <Line label="BMR (Mifflin-St Jeor)" value={`${Math.round(goal.bmr)} kcal`} />
                  <Line label="TDEE (BMR × activity)" value={`${Math.round(goal.tdee)} kcal`} />
                  <Line label="Your target" value={`${Math.round(goal.targetKcal)} kcal`} />
                  <Line label="Diet style" value={diet} />
                  <Line
                    label="Adaptive target"
                    value={goal.adaptive ? 'On' : 'Off — set by hand'}
                  />
                </View>
                {goal.floorApplied ? (
                  <Text style={[type.caption, { color: theme.uncertainText, lineHeight: 18 }]}>
                    Raised to our safe floor. Your inputs alone gave {Math.round(goal.targetRawKcal)} kcal.
                  </Text>
                ) : null}
              </Disclosure>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
  )
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
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
  group: { marginTop: space.xl },
})
