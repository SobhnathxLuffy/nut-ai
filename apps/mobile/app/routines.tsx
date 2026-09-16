import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, View } from 'react-native'
import { RoutineInput, type ProgressionRule, type SetValues, type RoutineInput as RoutineInputType } from '@nutai/core-schema'
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
import { Screen, Card, Label, Button, Field, Row, useAction } from '../src/components/Screen'

const PROGRESSION_KINDS = ['double', 'fixed', 'percentage', 'rir', 'manual'] as const

export default function RoutinesScreen() {
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

  const refresh = useCallback(async () => {
    const h = await db()
    const rList = await listRoutines(h)
    const eList = await listExercises(h)
    setRoutines(rList)
    setExercises(eList)

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
      let ex = exercises.find((e) => e.id === exerciseId)
      if (!ex) {
        const h = await db()
        const fetched = await getExercise(h, exerciseId)
        if (fetched) ex = fetched
      }
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
    [exercises],
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
        Create reusable workout routines with planned targets and automatic progressive overload.
      </Label>
      {action.feedback}

      {!editing && (
        <Button
          label="Create New Routine"
          selected
          onPress={() => {
            setName('')
            setEditId(null)
            setSelectedExercises([])
            setEditing(true)
          }}
        />
      )}

      {editing && (
        <Card>
          <Label>{editId ? 'Edit Routine Details' : 'Design Routine'}</Label>
          <Field label="Routine Name" value={name} onChangeText={setName} placeholder="e.g. Upper Body A" />

          <Label>Planned Exercises ({selectedExercises.length})</Label>
          {selectedExercises.map((se, idx) => {
            const exInfo = exercises.find((e) => e.id === se.exercise_id)
            return (
              <View key={`${se.exercise_id}-${idx}`} style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#ffffff0a' }}>
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

                <Row>
                  <Button label={`Add Set (${se.sets.length + 1})`} onPress={() => handleAddSet(idx)} />
                </Row>
              </View>
            )
          })}

          <Button
            label="+ Add Exercises from Library"
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
            <Button label="Save Routine" selected disabled={action.busy} onPress={() => void action.run(handleSave)} />
            <Button label="Cancel" onPress={() => { setEditing(false); initialLoadedRef.current = false }} />
          </Row>
        </Card>
      )}

      <Label>Saved Routines ({routines.length})</Label>
      {!routines.length && (
        <Label muted>No routines created yet. Tap Create New Routine above.</Label>
      )}

      {routines.map((r) => {
        let count = 0
        try {
          const parsed = RoutineInput.parse(JSON.parse(r.definition_json))
          count = parsed.exercises.length
        } catch {
          // ignore
        }
        return (
          <Card key={r.id}>
            <Row>
              <View style={{ flex: 1 }}>
                <Label>{r.name}</Label>
                <Label muted>{count} exercises</Label>
              </View>
            </Row>
            <Row>
              <Button label="Launch Workout" selected onPress={() => void action.run(() => handleLaunch(r.id))} />
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
          </Card>
        )
      })}
    </Screen>
  )
}
