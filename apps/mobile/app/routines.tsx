import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, View } from 'react-native'
import { RoutineInput, TRACKING_FIELDS, type ProgressionRule, type SetValues, type RoutineInput as RoutineInputType } from '@nutai/core-schema'
import {
  listRoutines,
  saveRoutine,
  launchRoutine,
  listExercises,
  getExercise,
  type Routine,
  type Exercise,
} from '@nutai/training'
import { db, localDate } from '../src/data/repo'
import { consumePendingRoutineExercises } from '../src/data/routine-draft'
import { useWebDirtyGuard } from '../src/ui/web-dirty-guard'
import { Screen, Card, Label, Button, Field, Row, useAction } from '../src/components/Screen'
import { ItemRow } from '../src/components/ItemRow'
import { Empty } from '../src/components/Empty'
import { getFieldLabels } from '../src/data/workout-load'
import { useTheme } from '../src/theme/ThemeProvider'
import { space } from '../src/theme/tokens'

const PROGRESSION_KINDS = ['double', 'fixed', 'percentage', 'rir', 'manual'] as const

/** The SetValues fields one planned-set row edits (the tracked numeric keys). */
type SetFieldKey = 'load_kg' | 'reps' | 'duration_s' | 'distance_m' | 'assistance_kg'

/**
 * T1-b jitter helper: a cheap fingerprint of exactly what this screen renders
 * per row (id + name + payload). refresh() compares it before setState, so a
 * re-fired refresh (focus re-run, useAction's trailing refresh) can no longer
 * hand the lists fresh array identities — the fuel of the focus-effect loop
 * this screen used to have.
 */
function rowsFingerprint(rows: Array<{ id: number; name: string; definition_json?: string }>): string {
  return rows.map((r) => `${r.id}:${r.name}:${r.definition_json ?? ''}`).join('|')
}

/** SetValues copy with one tracked field replaced (boring, type-safe). */
function withSetField(set: SetValues, key: SetFieldKey, value: number | null): SetValues {
  const next = { ...set }
  if (key === 'load_kg') next.load_kg = value
  else if (key === 'reps') next.reps = value
  else if (key === 'duration_s') next.duration_s = value
  else if (key === 'distance_m') next.distance_m = value
  else next.assistance_kg = value
  return next
}

/** SetValues copy with one planned extra (rir/rpe/tempo) replaced. */
function withPlannedExtra(set: SetValues, key: 'rir' | 'rpe' | 'tempo', value: number | string | null): SetValues {
  const next = { ...set }
  if (key === 'rir') next.rir = typeof value === 'number' ? value : null
  else if (key === 'rpe') next.rpe = typeof value === 'number' ? value : null
  else next.tempo = typeof value === 'string' ? value : null
  return next
}

export default function RoutinesScreen() {
  const t = useTheme()
  const params = useLocalSearchParams<{ id?: string; addExerciseId?: string }>()
  const [routines, setRoutines] = useState<Routine[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])

  // Creation/Edit mode
  const [editing, setEditing] = useState(false)
  const [editId, setEditId] = useState<number | null>(params.id ? Number(params.id) : null)
  const [name, setName] = useState('')
  const [selectedExercises, setSelectedExercises] = useState<
    Array<{
      exercise_id: number
      group: string | null
      sets: SetValues[]
      rule: ProgressionRule
    }>
  >([])
  const initialLoadedRef = useRef(false)

  // P2-15/P3-47: web parity — reload and tab close now get the browser
  // leave-confirmation while the editor holds unsaved routine work. (Browser
  // back cannot be intercepted on expo-router web; see
  // src/ui/web-dirty-guard.ts.)
  useWebDirtyGuard(editing)

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing) {
        setEditing(false)
        initialLoadedRef.current = false
        return true
      }
      router.back()
      return true
    })
    return () => sub.remove()
  }, [editing])

  // T1-b: last-rendered fingerprints per list (see rowsFingerprint).
  const rowsRef = useRef({ routines: '', exercises: '' })

  const refresh = useCallback(async () => {
    const h = await db()
    const rList = await listRoutines(h)
    const eList = await listExercises(h)
    // T1-b: setState only when the rows actually changed — a refired refresh
    // (focus re-run, useAction's trailing refresh) no longer re-renders the
    // whole list with fresh array identities.
    const rFp = rowsFingerprint(rList)
    const eFp = rowsFingerprint(eList)
    if (rFp !== rowsRef.current.routines) {
      rowsRef.current.routines = rFp
      setRoutines(rList)
    }
    if (eFp !== rowsRef.current.exercises) {
      rowsRef.current.exercises = eFp
      setExercises(eList)
    }

    if (params.id && !initialLoadedRef.current) {
      initialLoadedRef.current = true
      const target = rList.find((r) => r.id === Number(params.id))
      if (target) {
        setEditId(target.id)
        setName(target.name)
        try {
          const parsed = RoutineInput.parse(JSON.parse(target.definition_json))
          setSelectedExercises(parsed.exercises)
          setEditing(true)
        } catch {
          // parse error
        }
      }
    }
  }, [params.id])

  const handleAddExercise = useCallback(
    async (exerciseId: number) => {
      // T1-b jitter ROOT CAUSE fix: this callback sat in the useFocusEffect
      // deps with an [exercises] dependency — every refresh re-created it,
      // the focus callback identity changed, and expo-router's useFocusEffect
      // re-fired the refresh WHILE FOCUSED (an unbounded loop). Stable
      // identity instead: one indexed fetch per USER add; list state is
      // never read here (deps must stay []).
      const h = await db()
      const ex = await getExercise(h, exerciseId)
      if (!ex) return
      const defaultSet: SetValues = {
        load_kg: ex.tracking_type === 'weight_reps' ? 20 : null,
        reps: ['weight_reps', 'bodyweight_reps', 'reps', 'assisted'].includes(ex.tracking_type) ? 10 : null,
        duration_s: ['distance_time', 'time', 'weight_time'].includes(ex.tracking_type) ? 60 : null,
        distance_m: ['distance_time', 'distance'].includes(ex.tracking_type) ? 1000 : null,
        assistance_kg: ex.tracking_type === 'assisted' ? 20 : null,
        rir: null,
        rpe: null,
        tempo: null,
      }

      const defaultRule: ProgressionRule = {
        kind: 'double',
        increment: 2.5,
        min_reps: 8,
        max_reps: 12,
        target_rir: 2,
      }

      setSelectedExercises((prev) => {
        if (prev.some((se) => se.exercise_id === exerciseId)) return prev
        return [
          ...prev,
          {
            exercise_id: exerciseId,
            group: null,
            sets: [defaultSet, { ...defaultSet }, { ...defaultSet }],
            rule: defaultRule,
          },
        ]
      })
    },
    // Stable on purpose — see the T1-b note above. The useFocusEffect deps
    // lock (src/components/routines-screen.test.ts) pins this array empty.
    [],
  )

  const action = useAction(refresh)
  useFocusEffect(
    useCallback(() => {
      void action.run(async () => {
        await refresh()
        const pending = consumePendingRoutineExercises()
        if (pending.length > 0) {
          for (const id of pending) {
            await handleAddExercise(id)
          }
          setEditing(true)
        }
      })
    }, [refresh, handleAddExercise]),
  )

  useEffect(() => {
    if (params.addExerciseId) {
      const id = Number(params.addExerciseId)
      if (Number.isInteger(id) && id > 0) {
        setEditing(true)
        void handleAddExercise(id)
      }
    }
  }, [params.addExerciseId, handleAddExercise])
  const handleSave = async () => {
    if (!name.trim()) throw new Error('Enter a routine name')
    if (!selectedExercises.length) throw new Error('Add at least one exercise to the routine')

    const input: RoutineInputType = {
      name: name.trim(),
      exercises: selectedExercises,
    }
    RoutineInput.parse(input)
    const h = await db()
    await saveRoutine(h, input, editId ?? undefined)
    setEditing(false)
    setEditId(null)
    setName('')
    setSelectedExercises([])
    initialLoadedRef.current = false
  }

  const handleLaunch = async (id: number) => {
    const h = await db()
    const workoutId = await launchRoutine(h, id, localDate(Date.now()))
    router.push({ pathname: '/workout', params: { id: workoutId } } as never)
  }

  // Task 2-c: the schema-backed planned controls. All three are pure
  // setSelectedExercises updates — nothing writes until Save (which rides
  // action.run's busy guard), so rapid taps cannot duplicate writes (§8.3).
  const updateSetField = (ei: number, si: number, key: SetFieldKey, text: string) => {
    let value: number | null = null
    if (text !== '') {
      const n = Number(text)
      if (!Number.isFinite(n) || n < 0) return
      if (key === 'reps' && !Number.isInteger(n)) return
      value = n
    }
    setSelectedExercises((prev) => prev.map((se, i) => {
      if (i !== ei) return se
      const sets = [...se.sets]
      sets[si] = withSetField(sets[si]!, key, value)
      return { ...se, sets }
    }))
  }

  const updatePlannedExtra = (ei: number, key: 'rir' | 'rpe' | 'tempo', text: string) => {
    let value: number | string | null = null
    if (text !== '') {
      if (key === 'tempo') {
        if (!/^(\d+|X)-(\d+|X)-(\d+|X)-(\d+|X)$/.test(text)) return
        value = text
      } else {
        const n = Number(text)
        if (!Number.isFinite(n) || n < 0 || n > 10 || (key === 'rpe' && n < 1)) return
        value = n
      }
    }
    setSelectedExercises((prev) => prev.map((se, i) => (
      i !== ei ? se : { ...se, sets: se.sets.map((s) => withPlannedExtra(s, key, value)) }
    )))
  }

  const updateSupersetGroup = (ei: number, group: string | null) => {
    setSelectedExercises((prev) => prev.map((se, i) => (i !== ei ? se : { ...se, group })))
  }

  const handleAddSet = (index: number) => {
    const current = selectedExercises[index]
    if (!current) return
    const lastSet = current.sets[current.sets.length - 1] ?? {
      load_kg: 20,
      reps: 10,
      duration_s: null,
      distance_m: null,
      assistance_kg: null,
      rir: null,
      rpe: null,
      tempo: null,
    }
    const updated = [...selectedExercises]
    updated[index] = {
      ...current,
      sets: [...current.sets, { ...lastSet }],
    }
    setSelectedExercises(updated)
  }

  const handleRemoveExercise = (index: number) => {
    setSelectedExercises(selectedExercises.filter((_, i) => i !== index))
  }

  const handleDeleteRoutine = async (id: number) => {
    const h = await db()
    await h.run('UPDATE routines SET deleted_at = ?, sync_state = ? WHERE id = ?', [
      Date.now(),
      'local',
      id,
    ])
    await refresh()
  }

  return (
    <Screen title={editing ? (editId ? 'Edit Routine' : 'New Routine') : 'Routines'} back>
      <Label muted>
        A routine is a reusable workout template: pick exercises, plan the sets and progression, then start it any day from the Train tab.
      </Label>
      {action.feedback}

      {!editing && routines.length > 0 && (
        <Button
          label="Create new routine"
          selected
          onPress={() => {
            setName('')
            setEditId(null)
            setSelectedExercises([])
            setEditing(true)
          }}
        />
      )}

      {routines.length === 0 && !editing ? (
        // UI/UX report Ch. 6.3 / Table 10.1 (Wave 1c): create-first Empty —
        // THE one primary action while the list is empty (AGENTS §8.1: one
        // obvious primary per state); with routines saved, the top button
        // returns.
        <Empty
          icon="dumbbell"
          title="No routines yet"
          message="Build a routine once with planned targets, then start it any day from the Train tab — one tap."
          action={{
            label: 'Create new routine',
            onPress: () => {
              setName('')
              setEditId(null)
              setSelectedExercises([])
              setEditing(true)
            },
          }}
        />
      ) : null}

      {editing && (
        <Card>
          <Label>{editId ? 'Edit routine details' : 'Design routine'}</Label>
          <Field label="Routine Name" value={name} onChangeText={setName} placeholder="e.g. Upper Body A" />

          <Label>Planned Exercises ({selectedExercises.length})</Label>
          {selectedExercises.map((se, idx) => {
            const exInfo = exercises.find((e) => e.id === se.exercise_id)
            // Task 2-c: per-set planned inputs follow the exercise's tracked
            // fields (TRACKING_FIELDS values are always tracked numeric keys).
            const tracked = (exInfo
              ? TRACKING_FIELDS[exInfo.tracking_type]
              : ['load_kg', 'reps']) as readonly SetFieldKey[]
            const fieldLabels = getFieldLabels('kg')
            return (
              <View key={`${se.exercise_id}-${idx}`} style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: t.rowRaised }}>
                <Row>
                  <Label>{exInfo?.name ?? `Exercise #${se.exercise_id}`}</Label>
                  <Button label="Remove" onPress={() => handleRemoveExercise(idx)} />
                </Row>
                <Label muted>{se.sets.length} planned sets · Progression: {se.rule.kind}</Label>

                <Row>
                  <Label muted>Progression Rule:</Label>
                  {PROGRESSION_KINDS.map((k) => (
                    <Button
                      key={k}
                      label={k}
                      selected={se.rule.kind === k}
                      onPress={() => {
                        const next = [...selectedExercises]
                        next[idx] = { ...se, rule: { ...se.rule, kind: k } }
                        setSelectedExercises(next)
                      }}
                    />
                  ))}
                </Row>

                {se.rule.kind === 'double' && (
                  <Row>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Min Reps"
                        keyboardType="number-pad"
                        value={String(se.rule.min_reps)}
                        onChangeText={(t) => {
                          const n = Number(t)
                          if (Number.isInteger(n) && n > 0) {
                            const next = [...selectedExercises]
                            next[idx] = { ...se, rule: { ...se.rule, min_reps: n } }
                            setSelectedExercises(next)
                          }
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Max Reps"
                        keyboardType="number-pad"
                        value={String(se.rule.max_reps)}
                        onChangeText={(t) => {
                          const n = Number(t)
                          if (Number.isInteger(n) && n > 0) {
                            const next = [...selectedExercises]
                            next[idx] = { ...se, rule: { ...se.rule, max_reps: n } }
                            setSelectedExercises(next)
                          }
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Increment (kg)"
                        keyboardType="decimal-pad"
                        value={String(se.rule.increment)}
                        onChangeText={(t) => {
                          const n = Number(t)
                          if (Number.isFinite(n) && n >= 0) {
                            const next = [...selectedExercises]
                            next[idx] = { ...se, rule: { ...se.rule, increment: n } }
                            setSelectedExercises(next)
                          }
                        }}
                      />
                    </View>
                  </Row>
                )}

                {/* Task 2-c: increment/target_rir are schema fields the editor
                    never exposed (they previously rendered only under the
                    double gate). fixed/percentage step by increment, rir
                    escalates when the last set's RIR reaches target_rir. */}
                {(se.rule.kind === 'fixed' || se.rule.kind === 'percentage' || se.rule.kind === 'rir') && (
                  <Row>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={se.rule.kind === 'percentage' ? 'Increment (%)' : 'Increment (kg)'}
                        keyboardType="decimal-pad"
                        value={String(se.rule.increment)}
                        onChangeText={(text) => {
                          const n = Number(text)
                          if (Number.isFinite(n) && n >= 0) {
                            const next = [...selectedExercises]
                            next[idx] = { ...se, rule: { ...se.rule, increment: n } }
                            setSelectedExercises(next)
                          }
                        }}
                      />
                    </View>
                    {se.rule.kind === 'rir' && (
                      <View style={{ flex: 1 }}>
                        <Field
                          label="Target RIR (0-10)"
                          keyboardType="decimal-pad"
                          value={String(se.rule.target_rir)}
                          onChangeText={(text) => {
                            const n = Number(text)
                            if (Number.isFinite(n) && n >= 0 && n <= 10) {
                              const next = [...selectedExercises]
                              next[idx] = { ...se, rule: { ...se.rule, target_rir: n } }
                              setSelectedExercises(next)
                            }
                          }}
                        />
                      </View>
                    )}
                  </Row>
                )}

                {/* Task 2-c: planned RIR/RPE/tempo (SetValues.rir/rpe/tempo).
                    Scope choice: ONE value per exercise, written into every
                    planned set — per-set RIR planning here would triple the
                    inputs; the live workout already edits RIR per set. */}
                <Row>
                  {(['rir', 'rpe'] as const).map((key) => (
                    <View key={key} style={{ flex: 1, minWidth: 90 }}>
                      <Field
                        label={`Planned ${fieldLabels[key]}`}
                        keyboardType="decimal-pad"
                        value={se.sets[0]?.[key] == null ? '' : String(se.sets[0]![key])}
                        onChangeText={(text) => updatePlannedExtra(idx, key, text)}
                      />
                    </View>
                  ))}
                  <View style={{ flex: 1, minWidth: 130 }}>
                    <Field
                      label="Planned tempo (e.g. 3-1-2-0)"
                      value={se.sets[0]?.tempo ?? ''}
                      onChangeText={(text) => updatePlannedExtra(idx, 'tempo', text)}
                    />
                  </View>
                </Row>

                {/* Task 2-c: superset grouping (exercises[].group →
                    superset_group_id at launch). Consecutive same-group
                    exercises launch linked as a circuit. */}
                <Row>
                  <Label muted>Superset group:</Label>
                  {(['none', 'A', 'B', 'C'] as const).map((g) => (
                    <Button
                      key={g}
                      label={g}
                      selected={(se.group ?? 'none') === g}
                      onPress={() => updateSupersetGroup(idx, g === 'none' ? null : g)}
                    />
                  ))}
                </Row>
                {se.group ? <Label muted>Consecutive exercises sharing a group launch linked as a circuit.</Label> : null}

                {/* Task 2-c: planned values per set (RoutineInput.sets[]). */}
                {se.sets.map((set, si) => (
                  <Row key={si}>
                    {tracked.map((key) => (
                      <View key={key} style={{ flex: 1, minWidth: 90 }}>
                        <Field
                          label={`${fieldLabels[key]} · set ${si + 1}`}
                          keyboardType="decimal-pad"
                          value={set[key] == null ? '' : String(set[key])}
                          onChangeText={(text) => updateSetField(idx, si, key, text)}
                        />
                      </View>
                    ))}
                  </Row>
                ))}

                <Row>
                  <Button label={`Add Set (${se.sets.length + 1}, same as last)`} onPress={() => handleAddSet(idx)} />
                </Row>
              </View>
            )
          })}

          <Button
            label="+ Add exercises from library"
            selected
            onPress={() => {
              router.push({
                pathname: '/search',
                params: {
                  mode: 'multi',
                  routineId: editId ? String(editId) : undefined,
                  initialSelected: selectedExercises.map((se) => se.exercise_id).join(','),
                },
              } as never)
            }}
          />

          <Row>
            <Button label="Save routine" selected disabled={action.busy} onPress={() => void action.run(handleSave)} />
            <Button label="Cancel" onPress={() => { setEditing(false); initialLoadedRef.current = false }} />
          </Row>
        </Card>
      )}

      <Label>Saved Routines ({routines.length})</Label>

      {routines.map((r) => {
        let count = 0
        try {
          const parsed = RoutineInput.parse(JSON.parse(r.definition_json))
          count = parsed.exercises.length
        } catch {
          // ignore
        }
        // UI/UX report Ch. 8.5 (Wave 3): list rows collapse to icon + label +
        // value + chevron; the three actions ride below instead of competing
        // with the row itself.
        return (
          <View key={r.id} style={{ gap: space.sm }}>
            <ItemRow
              icon="dumbbell"
              label={r.name}
              value={`${count} exercise${count === 1 ? '' : 's'}`}
              onPress={() => {
                setEditId(r.id)
                setName(r.name)
                try {
                  const parsed = RoutineInput.parse(JSON.parse(r.definition_json))
                  setSelectedExercises(parsed.exercises)
                  setEditing(true)
                } catch {
                  // ignore
                }
              }}
              accessibilityLabel={`Edit routine ${r.name}`}
            />
            <Row>
              <Button label="Launch workout" selected onPress={() => void action.run(() => handleLaunch(r.id))} />
              <Button
                label="Edit"
                onPress={() => {
                  setEditId(r.id)
                  setName(r.name)
                  try {
                    const parsed = RoutineInput.parse(JSON.parse(r.definition_json))
                    setSelectedExercises(parsed.exercises)
                    setEditing(true)
                  } catch {
                    // ignore
                  }
                }}
              />
              <Button label="Delete" onPress={() => void action.run(() => handleDeleteRoutine(r.id))} />
            </Row>
          </View>
        )
      })}
    </Screen>
  )
}
