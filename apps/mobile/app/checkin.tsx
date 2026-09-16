import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../src/components/Icon'
import {
  acceptCheckin,
  readSafety,
  reviewCheckin,
  saveSafety,
  type SafetySettings,
} from '../src/data/checkin'
import { db, localDate } from '../src/data/repo'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'
import { kgToLb, type WeightUnit } from '@nutai/analytics'
import { readWeightUnit } from '../src/data/weight-units'

type ReviewResult = Awaited<ReturnType<typeof reviewCheckin>>

export default function CheckinScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [loading, setLoading] = useState(true)
  const [review, setReview] = useState<ReviewResult | null>(null)
  const [safety, setSafety] = useState<SafetySettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [acceptedMessage, setAcceptedMessage] = useState<string | null>(null)
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg')

  const loadReview = useCallback(async () => {
    try {
      const h = await db()
      const today = localDate(Date.now())
      const [rev, safe, unit] = await Promise.all([reviewCheckin(h, today), readSafety(h), readWeightUnit(h)])
      setReview(rev)
      setSafety(safe)
      setWeightUnit(unit)
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        if (!alive) return
        await loadReview()
      })()
      return () => {
        alive = false
      }
    }, [loadReview]),
  )

  const handleToggleLock = async (macro: keyof SafetySettings['locks']) => {
    if (!safety || busy) return
    const updated: SafetySettings = {
      ...safety,
      locks: {
        ...safety.locks,
        [macro]: !safety.locks[macro],
      },
    }
    setSafety(updated)
    const h = await db()
    await saveSafety(h, updated)
    await loadReview()
  }

  const handleToggleReviewed = async () => {
    if (!safety || busy) return
    const updated: SafetySettings = {
      ...safety,
      reviewed: !safety.reviewed,
    }
    setSafety(updated)
    const h = await db()
    await saveSafety(h, updated)
    await loadReview()
  }

  const handleToggleRisk = async (key: 'pregnant' | 'lactating' | 'eating_disorder_risk') => {
    if (!safety || busy) return
    const updated: SafetySettings = {
      ...safety,
      [key]: !safety[key],
    }
    setSafety(updated)
    const h = await db()
    await saveSafety(h, updated)
    await loadReview()
  }

  const handleAccept = async () => {
    if (!review?.suggestion || busy) return
    setBusy(true)
    try {
      const h = await db()
      const today = localDate(Date.now())
      await acceptCheckin(h, today, review.fingerprint, true)
      setAcceptedMessage(
        `Updated calorie target to ${review.suggestion.proposed.kcal} kcal. New macro goals are active.`,
      )
      await loadReview()
    } catch (err) {
      Alert.alert('Unable to apply suggestion', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading || !review) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[type.body, { color: theme.textMuted }]}>Preparing weekly review…</Text>
      </View>
    )
  }

  const { metrics, suggestion, flags, cooldown } = review

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.lg,
        paddingBottom: 150,
        gap: space.md,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[type.title, { color: theme.text }]}>Weekly Check-in</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close weekly check-in"
          onPress={() => router.back()}
          hitSlop={space.md}
        >
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>

      <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
        Adaptive check-ins evaluate your past 7 days of finalized logging and scale weight trends.
        Target changes are never applied silently — you decide whether to accept adjustments.
      </Text>

      {/* Success banner if just accepted */}
      {acceptedMessage && (
        <View style={[styles.banner, { backgroundColor: theme.bgElevated, borderColor: theme.affirm }]}>
          <Icon name="check" size={18} color={theme.affirm} />
          <Text style={[type.bodyStrong, { color: theme.text, flex: 1 }]}>{acceptedMessage}</Text>
        </View>
      )}

      {/* 1. 7-Day Metrics Breakdown */}
      <View style={[styles.card, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
        <Text style={[type.heading, { color: theme.text }]}>Past 7 Days Summary</Text>

        <View style={styles.metricsGrid}>
          <View style={[styles.metricTile, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.caption, { color: theme.textMuted }]}>Finalized Days</Text>
            <Text style={[styles.metricNumber, { color: theme.text }]}>
              {metrics.included_dates.length}/7
            </Text>
            <Text style={[type.micro, { color: theme.textFaint }]}>
              {metrics.fasting_dates.length ? `${metrics.fasting_dates.length} fasting` : 'complete'}
            </Text>
          </View>

          <View style={[styles.metricTile, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.caption, { color: theme.textMuted }]}>Average Intake</Text>
            <Text style={[styles.metricNumber, { color: theme.text }]}>
              {metrics.average_kcal != null ? `${Math.round(metrics.average_kcal)}` : '—'}
            </Text>
            <Text style={[type.micro, { color: theme.textFaint }]}>kcal/day</Text>
          </View>

          <View style={[styles.metricTile, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.caption, { color: theme.textMuted }]}>Weight Trend</Text>
            <Text style={[styles.metricNumber, { color: theme.text }]}>
              {metrics.weight_change_kg_week != null
                ? `${metrics.weight_change_kg_week > 0 ? '+' : ''}${(weightUnit === 'lb' ? kgToLb(metrics.weight_change_kg_week) : metrics.weight_change_kg_week).toFixed(2)}`
                : '—'}
            </Text>
            <Text style={[type.micro, { color: theme.textFaint }]}>
              {metrics.weigh_in_count} weigh-ins ({weightUnit}/wk)
            </Text>
          </View>

          <View style={[styles.metricTile, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.caption, { color: theme.textMuted }]}>Workouts</Text>
            <Text style={[styles.metricNumber, { color: theme.text }]}>
              {metrics.completed_workouts}
            </Text>
            <Text style={[type.micro, { color: theme.textFaint }]}>completed</Text>
          </View>
        </View>

        {metrics.protein_compliance != null && (
          <View style={[styles.infoRow, { borderTopColor: theme.border }]}>
            <Text style={[type.caption, { color: theme.textMuted }]}>Protein target compliance:</Text>
            <Text style={[type.bodyStrong, { color: theme.protein }]}>
              {Math.round(metrics.protein_compliance * 100)}% ({metrics.protein_days} days)
            </Text>
          </View>
        )}
      </View>

      {/* 2. Excluded Dates Evidence */}
      {metrics.excluded_dates.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
          <Text style={[type.label, { color: theme.text }]}>Excluded Dates ({metrics.excluded_dates.length})</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
            Excluded from intake averages to prevent distorted targets.
          </Text>
          <View style={{ gap: space.xs, marginTop: space.sm }}>
            {metrics.excluded_dates.map((ex) => (
              <View key={ex.date} style={styles.spread}>
                <Text style={[type.body, { color: theme.text }]}>{ex.date}</Text>
                <Text style={[type.caption, { color: theme.uncertain }]}>{ex.reason}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 3. Adaptive Target Suggestion */}
      {suggestion ? (
        <View style={[styles.card, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
          <View style={styles.spread}>
            <Text style={[type.heading, { color: theme.text }]}>Suggested Target</Text>
            <View style={[styles.badge, { backgroundColor: theme.bgSunken }]}>
              <Text style={[type.caption, { color: theme.text }]}>{suggestion.confidence} confidence</Text>
            </View>
          </View>

          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
            {suggestion.reason}
          </Text>

          {/* Comparison Table */}
          <View style={[styles.table, { borderColor: theme.border, marginTop: space.md }]}>
            <View style={[styles.tableRow, { backgroundColor: theme.bgSunken }]}>
              <Text style={[type.caption, { color: theme.textMuted, flex: 1.5 }]}>Target</Text>
              <Text style={[type.caption, { color: theme.textMuted, flex: 1, textAlign: 'right' }]}>Current</Text>
              <Text style={[type.caption, { color: theme.text, flex: 1, textAlign: 'right', fontWeight: '700' }]}>
                Proposed
              </Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[type.body, { color: theme.text, flex: 1.5 }]}>Calories</Text>
              <Text style={[type.body, { color: theme.textMuted, flex: 1, textAlign: 'right' }]}>
                {suggestion.old.kcal} kcal
              </Text>
              <Text style={[type.bodyStrong, { color: theme.protein, flex: 1, textAlign: 'right' }]}>
                {suggestion.proposed.kcal} kcal
              </Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[type.body, { color: theme.text, flex: 1.5 }]}>Protein</Text>
              <Text style={[type.body, { color: theme.textMuted, flex: 1, textAlign: 'right' }]}>
                {suggestion.old.protein_g} g
              </Text>
              <Text style={[type.bodyStrong, { color: theme.text, flex: 1, textAlign: 'right' }]}>
                {suggestion.proposed.protein_g} g
              </Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[type.body, { color: theme.text, flex: 1.5 }]}>Carbs</Text>
              <Text style={[type.body, { color: theme.textMuted, flex: 1, textAlign: 'right' }]}>
                {suggestion.old.carbs_g} g
              </Text>
              <Text style={[type.bodyStrong, { color: theme.text, flex: 1, textAlign: 'right' }]}>
                {suggestion.proposed.carbs_g} g
              </Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[type.body, { color: theme.text, flex: 1.5 }]}>Fat</Text>
              <Text style={[type.body, { color: theme.textMuted, flex: 1, textAlign: 'right' }]}>
                {suggestion.old.fat_g} g
              </Text>
              <Text style={[type.bodyStrong, { color: theme.text, flex: 1, textAlign: 'right' }]}>
                {suggestion.proposed.fat_g} g
              </Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={{ gap: space.sm, marginTop: space.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Accept suggested calorie target of ${suggestion.proposed.kcal} kcal`}
              disabled={busy}
              onPress={handleAccept}
              style={[styles.cta, { backgroundColor: busy ? theme.border : theme.text }]}
            >
              <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 17 }]}>
                {busy ? 'Applying…' : 'Accept New Target'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Keep current targets and dismiss suggestion"
              disabled={busy}
              onPress={() => router.back()}
              style={[styles.ghostBtn, { borderColor: theme.border }]}
            >
              <Text style={[type.label, { color: theme.textMuted }]}>Keep Current Target</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
          <Text style={[type.heading, { color: theme.text }]}>Adaptive Status</Text>
          {flags.length > 0 ? (
            <View style={{ gap: space.xs, marginTop: space.xs }}>
              {flags.map((flag) => (
                <Text key={flag} style={[type.caption, { color: theme.uncertain, lineHeight: 18 }]}>
                  • {flag}
                </Text>
              ))}
            </View>
          ) : cooldown ? (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              Your target was recently adjusted. Adaptive adjustments are spaced at least 7 days apart.
            </Text>
          ) : (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              Log at least 5 finalized days (complete or fasting) and at least 3 weigh-ins across a 7-day span
              to generate an adaptive target suggestion.
            </Text>
          )}
        </View>
      )}

      {/* 4. Safety Guardrails & Locks Configuration */}
      {safety && (
        <View style={[styles.card, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
          <Text style={[type.heading, { color: theme.text }]}>Safety Guardrails & Target Locks</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2, lineHeight: 18 }]}>
            Protect your health and prevent automatic adjustments from changing targets you prefer to manage manually.
          </Text>

          <View style={{ gap: space.md, marginTop: space.md }}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: space.sm }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>Reviewed Safety Information</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  Confirms baseline readiness for adaptive target adjustments.
                </Text>
              </View>
              <Switch
                value={safety.reviewed}
                onValueChange={handleToggleReviewed}
                thumbColor={safety.reviewed ? theme.protein : theme.border}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: space.sm }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>Pregnant or Lactating</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  Disables automated adjustments for professional nutritional oversight.
                </Text>
              </View>
              <Switch
                value={safety.pregnant || safety.lactating}
                onValueChange={() => handleToggleRisk('pregnant')}
                thumbColor={safety.pregnant || safety.lactating ? theme.protein : theme.border}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: space.sm }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>Eating Disorder Risk / Concern</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  Suppresses adaptive deficits and encourages professional guidance.
                </Text>
              </View>
              <Switch
                value={safety.eating_disorder_risk}
                onValueChange={() => handleToggleRisk('eating_disorder_risk')}
                thumbColor={safety.eating_disorder_risk ? theme.protein : theme.border}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: space.sm }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>Lock Calories</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  Keeps your current calorie target strictly fixed.
                </Text>
              </View>
              <Switch
                value={safety.locks.kcal}
                onValueChange={() => handleToggleLock('kcal')}
                thumbColor={safety.locks.kcal ? theme.protein : theme.border}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, paddingRight: space.sm }}>
                <Text style={[type.bodyStrong, { color: theme.text }]}>Lock Protein</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  Protects your protein gram goal during any adjustment.
                </Text>
              </View>
              <Switch
                value={safety.locks.protein}
                onValueChange={() => handleToggleLock('protein')}
                thumbColor={safety.locks.protein ? theme.protein : theme.border}
              />
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  card: {
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.md,
  },
  metricTile: {
    flex: 1,
    minWidth: '45%',
    padding: space.md,
    borderRadius: radius.lg,
    gap: 2,
  },
  metricNumber: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.md,
    marginTop: space.md,
    borderTopWidth: 1,
  },
  spread: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  table: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cta: {
    height: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
  },
  ghostBtn: {
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
  },
})
