import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { reconcileFromMacros } from '@nutai/totals'
import { currentGoal, overrideTargets, type CurrentGoal } from '../src/data/repo'
import { useTheme } from '../src/theme/ThemeProvider'
import { Field } from '../src/components/Field'
import { radius, space, type } from '../src/theme/tokens'

/**
 * Edit nutrition goals.
 *
 * Two rules carried over from the engine, because a settings screen that breaks
 * them re-introduces the exact bug the engine was built to prevent:
 *
 *   CARBS ARE THE DERIVED VARIABLE. Editing calories, protein or fat re-solves
 *   carbs as the remainder. There is always exactly one dependent value, so the
 *   four numbers can never drift out of agreement.
 *
 *   SAVING TURNS THE ADAPTIVE LOOP OFF. Silently overwriting a target someone
 *   deliberately typed is the fastest way to lose their trust in every other
 *   number in the app.
 */
export default function EditGoals() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [base, setBase] = useState<CurrentGoal | null>(null)
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [fat, setFat] = useState('')
  const [saving, setSaving] = useState(false)
  // A failed target override must surface — 'Saving…' forever reads as saved.
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void currentGoal().then((g) => {
      if (!alive || !g) return
      setBase(g)
      setKcal(String(Math.round(g.targetKcal)))
      setProtein(String(Math.round(g.protein_g)))
      setFat(String(Math.round(g.fat_g)))
    })
    return () => {
      alive = false
    }
  }, [])

  const n = (s: string) => {
    const v = Number.parseFloat(s)
    return Number.isFinite(v) && v >= 0 ? v : 0
  }

  const kcalV = n(kcal)
  const proteinV = n(protein)
  const fatV = n(fat)
  // The single derived value.
  const carbsV = Math.max(0, (kcalV - 4 * proteinV - 9 * fatV) / 4)
  const impossible = kcalV > 0 && 4 * proteinV + 9 * fatV > kcalV

  async function save() {
    if (!base || saving || kcalV <= 0 || impossible) return
    setSaving(true)
    setError(null)
    try {
      await overrideTargets(
        {
          targetKcal: kcalV,
          macros: { protein_g: proteinV, fat_g: fatV, carbs_g: carbsV, carbsFloored: carbsV === 0 },
        },
        base,
        Date.now(),
      )
      router.back()
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Could not save your goals. Nothing was changed.')
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Nutrition goals</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        <Field label="Calories" unit="kcal" value={kcal} onValueChange={setKcal} />
        <Field label="Protein" unit="g" value={protein} onValueChange={setProtein} />
        <Field label="Fat" unit="g" value={fat} onValueChange={setFat} />

        <View style={[styles.derived, { backgroundColor: theme.bgSunken }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={[type.body, { color: theme.textMuted }]}>Carbs</Text>
            <Text style={[styles.big, { color: theme.text }]}>{Math.round(carbsV)} g</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 18 }]}>
            Carbs are always the remainder, so your four numbers can never disagree with each other.
            Change calories, protein or fat and this re-solves.
          </Text>
        </View>

        {error ? (
          <View style={[styles.warn, { backgroundColor: theme.safetyBg }]} accessibilityRole="alert">
            <Text style={[type.caption, { color: theme.safety }]}>{error}</Text>
          </View>
        ) : null}

        {impossible ? (
          <View style={[styles.warn, { backgroundColor: theme.safetyBg }]}>
            <Text style={[type.caption, { color: theme.safety }]}>
              Protein and fat alone already exceed {Math.round(kcalV)} kcal
              ({Math.round(reconcileFromMacros(proteinV, 0, fatV))} kcal). Raise calories or lower one
              of them.
            </Text>
          </View>
        ) : null}

        <View style={[styles.note, { backgroundColor: theme.uncertainBg }]}>
          <Text style={[type.caption, { color: theme.text, lineHeight: 18 }]}>
            Saving switches OFF the adaptive target. We will not quietly overwrite a number you
            chose on purpose — you can turn adaptation back on by regenerating your plan.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={save}
          disabled={kcalV <= 0 || impossible || saving}
          style={[styles.cta, { backgroundColor: kcalV > 0 && !impossible ? theme.text : theme.border }]}
        >
          {/* Wave 1a: CTA text drops the 18px override — bodyStrong is the
              button voice (UI/UX report Table 3.1). */}
          <Text style={[type.bodyStrong, { color: theme.bg }]}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  )
}


const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, minHeight: 56,
  },
  input: { flex: 1, ...type.heading, paddingVertical: space.md },
  derived: { padding: space.lg, borderRadius: radius.lg },
  big: { ...type.title },
  warn: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  note: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg },
  cta: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
