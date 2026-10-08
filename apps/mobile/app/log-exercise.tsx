import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ExerciseEstimateZ, SetValues, type TrackingType } from '@nutai/core-schema'
import {
  activeWorkout,
  addExercise,
  isExerciseInWorkout,
  listEquipment,
  listExercises,
  performanceHistory,
  saveSet,
  startWorkout,
  type Exercise,
  type Workout,
} from '@nutai/training'
import { cheapestModel, type ProviderId } from '@nutai/prompt'
import { Icon, type IconName } from '../src/components/Icon'
import { ItemRow } from '../src/components/ItemRow'
import { Badge } from '../src/components/Badge'
import { db, customProviderBaseUrl, localDate, logExercise, setting, weightHistory } from '../src/data/repo'
import { readWeightUnit } from '../src/data/weight-units'
import { primaryFields, shortFieldLabel } from '../src/data/set-table'
import { canonicalizeFieldValue, getFieldLabels, setValuesToDisplay } from '../src/data/workout-load'
import {
  exerciseKcal,
  INTENSITY_ANCHORS,
  type ExerciseKind,
  type Intensity,
} from '../src/exercise/met'
import { loadCredential } from '../src/inference/credentials'
import { runExerciseEstimate } from '../src/inference/pathA/client'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'
import { showToast } from '../src/components/toast-store'

/**
 * Log exercise — UI/UX report Ch. 8.5 (Wave 3): the four-screen wizard
 * compresses into TWO — pick (search, filters, recents) then configure
 * (sets/reps/weight in one card + Add).
 *
 *   PICK      search across the exercise library, an owned-equipment filter,
 *             recently performed exercises, and the four calorie paths below.
 *   CONFIGURE for a library exercise: the sets card (one row per set, the
 *             exercise's own tracked fields) + “Add to workout”, which
 *             appends to the ACTIVE workout or starts one. For the calorie
 *             paths (Run / Weight lifting / Describe / Manual) the configure
 *             screen is the existing deterministic estimator / text / manual
 *             entry — every one of the old wizard's capabilities survives,
 *             one pick deep instead of stacked menus.
 *
 * Run and Weight lifting are DETERMINISTIC: MET x body weight x minutes, the
 * same three intensity anchors the incumbent shows, no model anywhere.
 * Describe is the one model-owned path and says so on screen. Manual is the
 * user's own number, recorded verbatim.
 *
 * Everything lands in exercise_entries with provenance 'manual' (typed here,
 * as opposed to imported from Apple Health) so the HealthKit reader can never
 * double-count a workout that was also typed in.
 */

type Step =
  | { kind: 'pick' }
  | { kind: 'configure'; exercise: { id: number; name: string; tracking_type: TrackingType } }
  | { kind: 'intensity'; exercise: ExerciseKind }
  | { kind: 'describe' }
  | { kind: 'manual' }

/** The calorie quick paths — the old menu, now rows on the pick screen. */
const QUICK_PATHS: Array<{ step: Step; icon: IconName; title: string; sub: string }> = [
  { step: { kind: 'intensity', exercise: 'run' }, icon: 'run', title: 'Run', sub: 'Running, jogging, sprinting — MET × body weight × minutes' },
  { step: { kind: 'intensity', exercise: 'weights' }, icon: 'dumbbell', title: 'Weight lifting', sub: 'Machines, free weights — MET × body weight × minutes' },
  { step: { kind: 'describe' }, icon: 'pencil', title: 'Describe', sub: 'Write your workout in text' },
  { step: { kind: 'manual' }, icon: 'flame', title: 'Manual', sub: 'Enter exactly how many calories you burned' },
]

const KIND_META: Record<ExerciseKind, { icon: IconName; title: string }> = {
  run: { icon: 'run', title: 'Run' },
  weights: { icon: 'dumbbell', title: 'Weight lifting' },
}

const DURATIONS = [15, 30, 60, 90] as const

async function latestWeightKg(): Promise<number> {
  const points = await weightHistory()
  return points[points.length - 1]?.weightKg ?? 80
}

async function saveEntry(name: string, kcal: number): Promise<void> {
  await logExercise(name, kcal, Date.now())
}

export default function LogExercise() {
  const [step, setStep] = useState<Step>({ kind: 'pick' })

  if (step.kind === 'configure') {
    return <ConfigureScreen exercise={step.exercise} onBack={() => setStep({ kind: 'pick' })} />
  }
  if (step.kind === 'intensity') {
    return <IntensityScreen exercise={step.exercise} onBack={() => setStep({ kind: 'pick' })} />
  }
  if (step.kind === 'describe') return <DescribeScreen onBack={() => setStep({ kind: 'pick' })} />
  if (step.kind === 'manual') return <ManualScreen onBack={() => setStep({ kind: 'pick' })} />
  return <PickScreen onPick={setStep} />
}

function Header({ title, icon, onBack }: { title: string; icon?: IconName; onBack: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        style={[styles.backBtn, { backgroundColor: theme.bgSunken }]}
      >
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <Icon name="chevron" size={18} color={theme.text} />
        </View>
      </Pressable>
      <View style={styles.headerTitle}>
        {icon ? <Icon name={icon} size={20} color={theme.text} /> : null}
        <Text style={[type.bodyStrong, { color: theme.text }]}>{title}</Text>
      </View>
      <View style={{ width: 44 }} />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Screen 1 — PICK: search, owned-equipment filter, recents, calorie paths.

function PickScreen({ onPick }: { onPick: (s: Step) => void }) {
  const theme = useTheme()
  const [query, setQuery] = useState('')
  const [filterOwned, setFilterOwned] = useState(false)
  const [loading, setLoading] = useState(true)
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [owned, setOwned] = useState<string[]>([])
  const [recentIds, setRecentIds] = useState<number[]>([])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const h = await db()
        const [all, equipment, perf] = await Promise.all([listExercises(h), listEquipment(h), performanceHistory(h)])
        if (!alive) return
        setExercises(all)
        setOwned(equipment.map(e => e.kind))
        // Recents: the exercises you actually performed, newest first.
        const latestAt = new Map<number, number>()
        for (const row of perf) {
          const prev = latestAt.get(row.exercise_id) ?? 0
          if (row.at > prev) latestAt.set(row.exercise_id, row.at)
        }
        setRecentIds([...latestAt.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const byId = useMemo(() => new Map(exercises.map(e => [e.id, e])), [exercises])
  const recents = useMemo(
    () => recentIds.map(id => byId.get(id)).filter((e): e is Exercise => !!e).slice(0, 8),
    [recentIds, byId],
  )
  const matchesQuery = useCallback((e: Exercise, q: string) => {
    if (!q) return true
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return (
      e.name.toLowerCase().includes(needle) ||
      e.aliases.some(a => a.toLowerCase().includes(needle))
    )
  }, [])

  const results = useMemo(() => {
    let list = exercises
    if (filterOwned && owned.length > 0) {
      list = list.filter(e => !e.equipment.length || !e.equipment.some(eq => !owned.includes(eq)))
    }
    const q = query.trim().toLowerCase()
    if (q) list = list.filter(e => matchesQuery(e, q))
    // Recents stay ranked above the plain alphabetical list when not searching.
    if (!q) {
      const recentSet = new Set(recentIds)
      list = [...list].sort((a, b) => (recentSet.has(b.id) ? 1 : 0) - (recentSet.has(a.id) ? 1 : 0))
    }
    return list.slice(0, 30)
  }, [exercises, filterOwned, owned, query, matchesQuery, recentIds])

  const configure = (e: Exercise) =>
    onPick({ kind: 'configure', exercise: { id: e.id, name: e.name, tracking_type: e.tracking_type } })

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="Exercise" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        {/* Wave 1a: screen headers unify on type.title — the 34px override
            joins the 24/26/28/30 header family at 28/32 (UI/UX report
            Table 3.1 + §3.3 "four competing header scales"). */}
        <Text style={[type.title, { color: theme.text }]}>Log Exercise</Text>

        <TextInput
          accessibilityLabel="Search exercises"
          allowFontScaling
          placeholder="Search exercises or aliases"
          placeholderTextColor={theme.textFaint}
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          style={[styles.searchInput, { color: theme.text, borderColor: theme.border }]}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: filterOwned }}
          onPress={() => setFilterOwned(!filterOwned)}
          style={[styles.filterRow, { borderColor: theme.border }]}
        >
          <Icon name="dumbbell" size={16} color={theme.text} />
          <Text style={[type.label, { color: theme.text, flex: 1 }]}>
            {filterOwned ? 'Using owned equipment' : 'Filter by owned equipment'}
          </Text>
          {filterOwned ? <Badge label="On" variant="selected" size="sm" accessibilityLabel="Owned-equipment filter on" /> : null}
        </Pressable>

        {loading ? <ActivityIndicator color={theme.textMuted} style={{ marginTop: space.xl }} /> : null}

        {!query && recents.length > 0 && (
          <View style={{ marginTop: space.lg, gap: space.sm }}>
            <Text style={[type.caption, { color: theme.textFaint, textTransform: 'uppercase' as const }]}>Recent</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {recents.map(e => (
                <Pressable
                  key={e.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Pick recent exercise ${e.name}`}
                  onPress={() => configure(e)}
                  style={[styles.recentChip, { borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                >
                  <Text style={[type.label, { color: theme.text }]}>{e.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={{ marginTop: space.lg, gap: space.sm }}>
          <Text style={[type.caption, { color: theme.textFaint, textTransform: 'uppercase' as const }]}>
            {loading ? 'Library' : `${results.length} exercises`}
          </Text>
          {results.map(e => (
            <ItemRow
              key={e.id}
              icon="dumbbell"
              label={e.name}
              value={`${e.tracking_type.replaceAll('_', ' + ')} · ${e.equipment.join(', ') || 'bodyweight'}${e.is_custom ? ' · custom' : ''}`}
              onPress={() => configure(e)}
              accessibilityLabel={`Pick exercise ${e.name}`}
            />
          ))}
          {!loading && !results.length && (
            <Text style={[type.body, { color: theme.textMuted }]}>
              No matching exercise. Adjust the filter, or create your own from the Train tab’s Exercise library.
            </Text>
          )}
        </View>

        <View style={{ marginTop: space.xl, gap: space.sm }}>
          <Text style={[type.caption, { color: theme.textFaint, textTransform: 'uppercase' as const }]}>Cardio &amp; calories</Text>
          {QUICK_PATHS.map(m => (
            <ItemRow
              key={m.title}
              icon={m.icon}
              label={m.title}
              value={m.sub}
              onPress={() => onPick(m.step)}
              accessibilityLabel={`${m.title} — log calories`}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Screen 2 — CONFIGURE: sets/reps/weight in ONE card + Add.

interface DraftRow {
  key: number
  /** Display-unit text per field, exactly as typed ("" = empty). */
  text: Record<string, string>
  /** Canonical parsed values (kg loads) — null while text is invalid. */
  parsed: SetValues | null
}

function defaultSetsFor(trackingType: TrackingType): Array<{ text: Record<string, string>; parsed: SetValues }> {
  const base: SetValues = {
    load_kg: trackingType === 'weight_reps' ? 20 : null,
    reps: ['weight_reps', 'bodyweight_reps', 'reps', 'assisted'].includes(trackingType) ? 10 : null,
    duration_s: ['distance_time', 'time', 'weight_time'].includes(trackingType) ? 60 : null,
    distance_m: ['distance_time', 'distance'].includes(trackingType) ? 1000 : null,
    assistance_kg: trackingType === 'assisted' ? 20 : null,
    rir: null,
    rpe: null,
    tempo: null,
  }
  return [base, { ...base }, { ...base }].map(parsed => ({ text: {}, parsed }))
}

function ConfigureScreen({ exercise, onBack }: { exercise: { id: number; name: string; tracking_type: TrackingType }; onBack: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const fields = primaryFields(exercise.tracking_type)
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg')
  const [unitReady, setUnitReady] = useState(false)
  const [active, setActive] = useState<Workout | null>(null)
  const [rows, setRows] = useState<DraftRow[]>(() =>
    defaultSetsFor(exercise.tracking_type).map((r, i) => ({ key: i, text: r.text, parsed: r.parsed })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const h = await db()
      const loadedUnit = await readWeightUnit(h)
      setUnit(loadedUnit)
      setUnitReady(true)
      setActive(await activeWorkout(h))
      // T9: the configure screen used to hard-code 20 kg × 10 even though the
      // user's last session was one tap away. Seed the draft rows from the
      // most recent completed performance of THIS exercise (any workout) —
      // before the user types a thing.
      try {
        const perf = await performanceHistory(h)
        const mine = perf.filter((p) => p.exercise_id === exercise.id)
        if (mine.length === 0) return
        const lastWorkoutId = Math.max(...mine.map((p) => p.workout_id))
        const lastSets = mine.filter((p) => p.workout_id === lastWorkoutId && p.kind !== 'warmup' && p.kind !== 'cooldown').slice(0, 6)
        if (lastSets.length === 0) return
        const seeded = lastSets.map((s) => ({
          load_kg: s.load_kg,
          reps: s.reps,
          duration_s: s.duration_s,
          distance_m: s.distance_m,
          assistance_kg: s.assistance_kg,
          rir: null,
          rpe: null,
          tempo: null,
        }))
        setRows(seeded.map((parsed, i) => ({ key: i, text: setValuesToDisplay(parsed, loadedUnit), parsed })))
      } catch {
        // seeding is best-effort — the static defaults remain
      }
    })()
  }, [])

  // Seed the display text of each field from the parsed defaults (unit-aware) —
  // only once the real unit is known, so lb users see lb numbers.
  useEffect(() => {
    if (!unitReady) return
    setRows(prev =>
      prev.map(row => {
        if (Object.keys(row.text).length > 0 || !row.parsed) return row
        return { ...row, text: setValuesToDisplay(row.parsed, unit) }
      }),
    )
  }, [unit, unitReady])

  const updateField = (rowKey: number, key: string, text: string) => {
    setRows(prev =>
      prev.map(row => {
        if (row.key !== rowKey) return row
        const nextText = { ...row.text, [key]: text }
        const base: SetValues = row.parsed ?? defaultSetsFor(exercise.tracking_type)[0]!.parsed
        const { valid, value } = canonicalizeFieldValue(key, text, unit)
        const parsed = valid ? { ...base, [key]: value } as SetValues : null
        return { ...row, text: nextText, parsed }
      }),
    )
  }

  const addRow = () => {
    setRows(prev => {
      const last = prev.at(-1)
      const parsed = last?.parsed ?? defaultSetsFor(exercise.tracking_type)[0]!.parsed
      const copy: SetValues = { ...parsed }
      return [...prev, { key: (prev.at(-1)?.key ?? 0) + 1, text: last ? { ...last.text } : {}, parsed: copy }]
    })
  }

  const removeRow = (rowKey: number) => {
    setRows(prev => (prev.length > 1 ? prev.filter(r => r.key !== rowKey) : prev))
  }

  const addToWorkout = async (force: boolean) => {
    if (saving) return
    const validRows = rows.filter(r => r.parsed != null)
    if (!validRows.length) {
      setError('Enter the set values before adding — or remove the empty row.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const h = await db()
      const current = await activeWorkout(h)
      const workoutId = current?.id ?? (await startWorkout(h, localDate(Date.now())))
      if (!force) {
        const isDup = await isExerciseInWorkout(h, workoutId, exercise.id)
        if (isDup) {
          // UI/UX report §10.1 (Wave 1b): reversible duplicate — a toast states
          // the fact and offers the action, never a blocking question.
          setSaving(false)
          showToast({
            message: `"${exercise.name}" is already in this workout.`,
            action: {
              label: 'Add again',
              onPress: () => { void addToWorkout(true) },
            },
          })
          return
        }
      }
      const workoutExerciseId = await addExercise(h, workoutId, exercise.id)
      for (const row of validRows) {
        await saveSet(h, workoutExerciseId, row.parsed!, { completed: false })
      }
      router.push({ pathname: '/workout', params: { id: workoutId } } as never)
    } catch (caught) {
      setSaving(false)
      setError(caught instanceof Error && caught.message ? caught.message : 'Could not add this exercise. Nothing was written.')
    }
  }

  const current = active

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={exercise.name} icon="dumbbell" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        {error ? (
          <View accessibilityRole="alert" style={[styles.example, { backgroundColor: theme.safetyBg, marginBottom: space.md }]}>
            <Text style={[type.caption, { color: theme.safety, lineHeight: 19 }]}>{error}</Text>
          </View>
        ) : null}

        <View style={[styles.setsCard, { backgroundColor: theme.bgSunken }]}>
          <View style={styles.setsCardHead}>
            <Text style={[type.heading, { color: theme.text }]}>Sets</Text>
            <Text style={[type.caption, { color: theme.textMuted }]}>{rows.length} planned</Text>
          </View>

          {/* The mini set table — same columns as the live workout screen. */}
          <View style={styles.setHeader}>
            <Text style={[type.caption, { color: theme.textFaint, width: 26, textAlign: 'center' }]}>#</Text>
            {fields.map(key => (
              <Text key={key} style={[type.caption, { color: theme.textFaint, flex: 1, textAlign: 'center' }]}>
                {shortFieldLabel(key, unit)}
              </Text>
            ))}
            <Text style={[type.caption, { color: theme.textFaint, width: MIN_TAP_TARGET, textAlign: 'center' }]}>—</Text>
          </View>

          {rows.map((row, i) => (
            <View key={row.key} style={styles.setLine}>
              <Text style={[type.monoData, { color: theme.textFaint, width: 26, textAlign: 'center' }]}>{i + 1}</Text>
              {fields.map(key => (
                <TextInput
                  key={key}
                  accessibilityLabel={`${getFieldLabels(unit)[key]} set ${i + 1}`}
                  keyboardType={key === 'tempo' ? 'default' : 'decimal-pad'}
                  // Wave 4 wrap (report §11.1): mirrors the workout.tsx
                  // set-cell cells — Android's TextInput default is font
                  // scaling OFF, so the explicit prop grows the numerals with
                  // the OS font size, and the 1.2 cap (also arriving via the
                  // monoData token spread in the style array) stops growth
                  // where column alignment lives.
                  allowFontScaling
                  maxFontSizeMultiplier={1.2}
                  value={row.text[key] ?? ''}
                  onChangeText={text => updateField(row.key, key, text)}
                  style={[styles.cellInput, type.monoData, { color: theme.text, borderColor: theme.border }]}
                />
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove set ${i + 1}`}
                onPress={() => removeRow(row.key)}
                disabled={rows.length <= 1}
                hitSlop={space.sm}
                style={styles.removeSet}
              >
                <Icon name="minus" size={18} color={rows.length <= 1 ? theme.textFaint : theme.text} />
              </Pressable>
            </View>
          ))}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add set"
            onPress={addRow}
            style={[styles.addSetRow, { borderColor: theme.border }]}
          >
            <Icon name="plus" size={18} color={theme.textMuted} />
            <Text style={[type.label, { color: theme.textMuted }]}>Add set</Text>
          </Pressable>
        </View>

        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 19 }]}>
          Added to your {current ? 'active workout' : 'new workout'} — sets land as drafts; complete them with a tap on the workout screen.
        </Text>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={() => void addToWorkout(false)}
          disabled={saving}
          style={[styles.cta, { backgroundColor: theme.text }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>
            {saving ? 'Adding…' : 'Add to workout'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// The calorie configure screens (preserved from the four-path flow — each is
// now exactly ONE pick deep).

function IntensityScreen({ exercise, onBack }: { exercise: ExerciseKind; onBack: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [level, setLevel] = useState<Intensity>('medium')
  const [minutes, setMinutes] = useState('15')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const anchors = INTENSITY_ANCHORS[exercise]
  const mins = Number.parseInt(minutes, 10)
  const valid = Number.isFinite(mins) && mins > 0 && mins <= 600
  // Thumb sits at the selected anchor: index 0 (high) at the top.
  const idx = anchors.findIndex((a) => a.level === level)

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const kg = await latestWeightKg()
      const kcal = exerciseKcal(exercise, level, kg, mins)
      await saveEntry(`${KIND_META[exercise].title} — ${level}, ${mins} min`, kcal)
      router.back()
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Could not save this exercise. Nothing was written.')
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={KIND_META[exercise].title} icon={KIND_META[exercise].icon} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        {error ? (
          <View accessibilityRole="alert" style={[styles.example, { backgroundColor: theme.safetyBg, marginBottom: space.md }]}>
            <Text style={[type.caption, { color: theme.safety, lineHeight: 19 }]}>{error}</Text>
          </View>
        ) : null}
        <View style={styles.sectionHead}>
          <Icon name="sun" size={20} color={theme.text} />
          {/* Wave 1a: header-scale 26px override removed — type.title (28/32). */}
          <Text style={[type.title, { color: theme.text }]}>Set intensity</Text>
        </View>

        <View style={[styles.intensityCard, { backgroundColor: theme.bgSunken }]}>
          <View style={{ flex: 1, gap: space.xl }}>
            {anchors.map((a) => {
              const active = a.level === level
              return (
                <Pressable
                  key={a.level}
                  accessibilityRole="radio"
                  accessibilityLabel={`${a.title} intensity`}
                  accessibilityState={{ selected: active }}
                  onPress={() => setLevel(a.level)}
                  hitSlop={space.sm}
                >
                  <Text style={[active ? type.heading : type.bodyStrong, { color: active ? theme.text : theme.textMuted }]}>
                    {a.title}
                  </Text>
                  <Text
                    style={[
                      active ? type.bodyStrong : type.body,
                      { color: active ? theme.text : theme.textFaint, marginTop: 2, lineHeight: 20 },
                    ]}
                  >
                    {a.desc}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          {/* The level track: three tap zones, thumb at the active third. */}
          <View style={styles.track}>
            <View style={[styles.trackLine, { backgroundColor: theme.text }]} />
            {anchors.map((a, i) => (
              <Pressable
                key={a.level}
                accessibilityRole="button"
                accessibilityLabel={`${a.title} intensity`}
                onPress={() => setLevel(a.level)}
                style={[styles.trackZone, { top: `${(i * 100) / 3}%` as const }]}
              />
            ))}
            <View
              pointerEvents="none"
              style={[
                styles.thumb,
                { backgroundColor: theme.text, borderColor: theme.bg, top: `${(idx * 100) / 3 + 8}%` as const },
              ]}
            />
          </View>
        </View>

        <View style={[styles.sectionHead, { marginTop: space.xl }]}>
          <Icon name="clock" size={20} color={theme.text} />
          <Text style={[type.title, { color: theme.text }]}>Duration</Text>
        </View>

        <View style={styles.chipRow}>
          {DURATIONS.map((d) => {
            const active = minutes === String(d)
            return (
              <Pressable
                key={d}
                onPress={() => setMinutes(String(d))}
                style={[
                  styles.chip,
                  active
                    ? { backgroundColor: theme.text }
                    : { borderWidth: 1.5, borderColor: theme.text },
                ]}
              >
                <Text style={[type.bodyStrong, { color: active ? theme.bg : theme.text }]}>{d} mins</Text>
              </Pressable>
            )
          })}
        </View>

        <TextInput
          accessibilityLabel="Duration in minutes"
          allowFontScaling
          keyboardType="number-pad"
          value={minutes}
          onChangeText={setMinutes}
          style={[styles.minutesInput, { color: theme.text, borderColor: theme.border }]}
        />
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={save}
          disabled={!valid || saving}
          style={[styles.cta, { backgroundColor: valid ? theme.text : theme.border }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>
            {saving ? 'Saving…' : 'Continue'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function DescribeScreen({ onBack }: { onBack: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    const desc = text.trim()
    if (!desc || busy) return
    setBusy(true)
    setError(null)

    try {
      const provider = (await setting('provider')) as ProviderId | 'none' | ''
      const credential = provider && provider !== 'none' ? await loadCredential(provider) : null
      if (!credential || !provider || provider === 'none') {
        setBusy(false)
        setError('Describing a workout needs an API key — add one in Profile, or use Run, Weight lifting or Manual instead.')
        return
      }

      const model = (await setting('provider_model')) || cheapestModel(provider).id
      const kg = await latestWeightKg()
      const outcome = await runExerciseEstimate(provider, { model, description: desc, weightKg: kg, baseUrl: await customProviderBaseUrl() }, credential)
      const parsed = outcome.ok ? ExerciseEstimateZ.safeParse(outcome.raw) : null

      if (!parsed?.success) {
        setBusy(false)
        setError(outcome.ok ? 'Could not turn that into an estimate — try adding a duration.' : (outcome.error?.message ?? 'The estimate failed — nothing was written. Try again, or use Run, Weight lifting or Manual instead.'))
        return
      }

      const e = parsed.data
      await saveEntry(e.duration_min ? `${e.label} — ${Math.round(e.duration_min)} min` : e.label, Math.round(e.calories_kcal))
      router.back()
    } catch (caught) {
      setBusy(false)
      setError(caught instanceof Error && caught.message ? caught.message : 'Could not estimate this exercise — nothing was written. Check the description and try again.')
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="Describe Exercise" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
        <TextInput
          autoFocus
          allowFontScaling
          placeholder="Describe workout time, intensity, etc."
          placeholderTextColor={theme.textFaint}
          value={text}
          onChangeText={(t) => {
            setText(t)
            setError(null)
          }}
          style={[styles.describeInput, { color: theme.text, borderColor: theme.border }]}
        />

        <View style={[styles.aiPill, { borderColor: theme.border }]}>
          <Icon name="scan" size={14} color={theme.text} />
          <Text style={[type.label, { color: theme.text }]}>Estimated with your API key</Text>
        </View>

        <View style={[styles.example, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.body, { color: theme.textMuted, lineHeight: 22 }]}>
            <Text style={{ fontWeight: '700', color: theme.text }}>Example:</Text> Leg strength
            training for 35 mins, 9/10 intensity
          </Text>
        </View>

        {error ? (
          <View style={[styles.example, { backgroundColor: theme.safetyBg, marginTop: space.md }]}>
            <Text style={[type.caption, { color: theme.safety, lineHeight: 19 }]}>{error}</Text>
          </View>
        ) : null}

        {busy ? <ActivityIndicator color={theme.textMuted} style={{ marginTop: space.xl }} /> : null}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={add}
          disabled={!text.trim() || busy}
          style={[styles.cta, { backgroundColor: text.trim() && !busy ? theme.text : theme.border }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>
            {busy ? 'Estimating…' : 'Add Exercise'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function ManualScreen({ onBack }: { onBack: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [kcal, setKcal] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const n = Number.parseInt(kcal, 10)
  const valid = Number.isFinite(n) && n > 0 && n <= 5000

  async function add() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      await saveEntry(name.trim() || 'Workout', n)
      router.back()
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Could not save this exercise. Nothing was written.')
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title="Manual" icon="flame" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
        <Text style={[type.label, { color: theme.textMuted }]}>Calories burned</Text>
        <TextInput
          autoFocus
          allowFontScaling
          accessibilityLabel="Calories burned"
          keyboardType="number-pad"
          placeholder="250"
          placeholderTextColor={theme.textFaint}
          value={kcal}
          onChangeText={setKcal}
          style={[styles.minutesInput, { color: theme.text, borderColor: theme.border, marginTop: space.sm }]}
        />

        <Text style={[type.label, { color: theme.textMuted, marginTop: space.xl }]}>Name (optional)</Text>
        <TextInput
          accessibilityLabel="Exercise name"
          allowFontScaling
          placeholder="Workout"
          placeholderTextColor={theme.textFaint}
          value={name}
          onChangeText={setName}
          style={[styles.minutesInput, { color: theme.text, borderColor: theme.border, marginTop: space.sm, ...type.body }]}
        />

        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.lg, lineHeight: 19 }]}>
          Recorded exactly as entered. Your number, your log.
        </Text>

        {error ? (
          <View accessibilityRole="alert" style={[styles.example, { backgroundColor: theme.safetyBg, marginTop: space.md }]}>
            <Text style={[type.caption, { color: theme.safety, lineHeight: 19 }]}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={add}
          disabled={!valid || saving}
          style={[styles.cta, { backgroundColor: valid ? theme.text : theme.border }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg }]}>
            {saving ? 'Saving…' : 'Add Exercise'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  searchInput: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    fontSize: type.body.fontSize,
    minHeight: 56,
    marginTop: space.md,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    marginTop: space.md,
    minHeight: MIN_TAP_TARGET + 4,
  },
  recentChip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  setsCard: {
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  setsCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  setHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  setLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cellInput: {
    flex: 1,
    minHeight: MIN_TAP_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
  },
  removeSet: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSetRow: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  intensityCard: {
    flexDirection: 'row',
    gap: space.lg,
    marginTop: space.lg,
    padding: space.lg,
    paddingVertical: space.xl,
    borderRadius: radius.lg,
  },
  track: { width: 28, alignItems: 'center', position: 'relative' },
  trackLine: { width: 8, flex: 1, borderRadius: 4, opacity: 0.9 },
  trackZone: { position: 'absolute', left: -space.md, right: -space.md, height: '33%' },
  thumb: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  chip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  minutesInput: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    // Wave 1a: the 20/700 ad-hoc input joins type.heading (Table 3.1); the
    // name field below overrides to type.body for regular-weight entry.
    ...type.heading,
    minHeight: 56,
  },
  describeInput: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    fontSize: type.body.fontSize,
    minHeight: 56,
  },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    marginTop: space.lg,
  },
  example: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg },
  cta: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
