import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { EditableValue, RulerPicker } from '../src/components/onboarding/Controls'
import { lbToKg, weightValueFromKg, type WeightUnit } from '@nutai/analytics'
import { db, logWeight, weightHistory } from '../src/data/repo'
import { readWeightUnit } from '../src/data/weight-units'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * Log today's weight.
 *
 * A dated numeric point, nothing more. Deliberately NOT a slider you nudge from
 * yesterday's value — anchoring today's entry to yesterday's is how a weight log
 * quietly becomes fiction.
 *
 * This is also what feeds the adaptive-TDEE loop, which needs about five real
 * weigh-ins before it will touch anyone's target.
 */
export default function LogWeight() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()

  const [kg, setKg] = useState(80)
  const [unit, setUnit] = useState<WeightUnit>('kg')
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const handle = await db()
      const [history, displayUnit] = await Promise.all([weightHistory(), readWeightUnit(handle)])
      if (!alive) return
      const last = history[history.length - 1]
      if (last) setKg(last.weightKg)
      setUnit(displayUnit)
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  const shown = weightValueFromKg(kg, unit)
  const imperial = unit === 'lb'
  const min = imperial ? 60 : 30
  const max = imperial ? 500 : 227

  async function save() {
    if (saving) return
    setSaving(true)
    await logWeight(kg, Date.now())
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Today's weight</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>

      <Text style={[type.caption, { color: theme.textMuted, paddingHorizontal: space.lg }]}>
        One number, dated today. Day-to-day scale weight is mostly water — the trend line on Trends
        is the thing worth watching, and it is what adjusts your calorie target.
      </Text>

      {ready ? (
        <>
          <View style={{ alignItems: 'center', marginTop: space.xxxl }}>
            <EditableValue
              value={shown}
              unit={unit}
              min={min}
              max={max}
              onCommit={(v) => setKg(imperial ? lbToKg(v) : v)}
            />
          </View>

          <View style={{ marginTop: space.lg }}>
            <RulerPicker
              width={width}
              min={min}
              max={max}
              step={0.1}
              value={Number(shown.toFixed(1))}
              onChange={(v) => setKg(imperial ? lbToKg(v) : v)}
            />
          </View>
        </>
      ) : null}

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <Pressable
          accessibilityRole="button"
          disabled={saving || !ready}
          onPress={save}
          style={[styles.cta, { backgroundColor: saving || !ready ? theme.border : theme.text }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>Save</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    marginBottom: space.sm,
  },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg },
  cta: {
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
  },
})
