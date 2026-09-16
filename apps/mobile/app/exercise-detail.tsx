import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, BackHandler, View } from 'react-native'
import { RoutineInput } from '@nutai/core-schema'
import {
  activeWorkout,
  addExercise,
  addExerciseToRoutine,
  getExercise,
  isExerciseInWorkout,
  listExercises,
  listRoutines,
  startWorkout,
  type Exercise,
  type Routine,
  type Workout,
} from '@nutai/training'
import { db, localDate } from '../src/data/repo'
import { Screen, Button, Card, Label, Row, useAction } from '../src/components/Screen'

export default function ExerciseDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>()
  const [exercise, setExercise] = useState<Exercise | null>(null)
  const [active, setActive] = useState<Workout | null>(null)
  const [routines, setRoutines] = useState<Routine[]>([])
  const [showRoutineChooser, setShowRoutineChooser] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showRoutineChooser) {
        setShowRoutineChooser(false)
        return true
      }
      router.back()
      return true
    })
    return () => sub.remove()
  }, [showRoutineChooser])

  const refresh = useCallback(async () => {
    if (!params.id) return
    const h = await db()
    const found = await getExercise(h, Number(params.id))
    if (found) {
      setExercise(found)
    } else {
      const all = await listExercises(h)
      const fallback = all.find((e) => String(e.id) === params.id)
      if (fallback) setExercise(fallback)
    }
    const currentActive = await activeWorkout(h)
    setActive(currentActive)
    const rList = await listRoutines(h)
    setRoutines(rList)
  }, [params.id])

  const action = useAction(refresh)
  useFocusEffect(
    useCallback(() => {
      void action.run(refresh)
    }, [refresh]),
  )

  const handleStartQuickWorkout = async () => {
    if (!exercise) return
    const h = await db()
    const workoutId = await startWorkout(h, localDate(Date.now()))
    await addExercise(h, workoutId, exercise.id)
    router.push({ pathname: '/workout', params: { id: workoutId } } as never)
  }

  const handleAddToActiveWorkout = async () => {
    if (!exercise || !active) return
    const h = await db()
    const isDup = await isExerciseInWorkout(h, active.id, exercise.id)
    if (isDup) {
      Alert.alert(
        'Exercise Already Added',
        `"${exercise.name}" is already in this workout. Would you like to add it again?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add Again',
            onPress: () => {
              void action.run(async () => {
                const dbHandle = await db()
                await addExercise(dbHandle, active.id, exercise.id)
                router.push({ pathname: '/workout', params: { id: active.id } } as never)
              })
            },
          },
        ],
      )
      return
    }
    await addExercise(h, active.id, exercise.id)
    router.push({ pathname: '/workout', params: { id: active.id } } as never)
  }

  const handleAddToRoutine = async (r: Routine) => {
    if (!exercise) return
    let isDup = false
    try {
      const parsed = RoutineInput.parse(JSON.parse(r.definition_json))
      isDup = parsed.exercises.some((e) => e.exercise_id === exercise.id)
    } catch {
      // ignore
    }

    const executeAdd = async () => {
      await action.run(async () => {
        const h = await db()
        await addExerciseToRoutine(h, r.id, exercise.id)
        setSuccessMessage(`Added "${exercise.name}" to routine "${r.name}".`)
        setShowRoutineChooser(false)
        await refresh()
      })
    }

    if (isDup) {
      Alert.alert(
        'Exercise Already in Routine',
        `"${exercise.name}" is already in "${r.name}". Would you like to add it again?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Again', onPress: () => void executeAdd() },
        ],
      )
      return
    }

    await executeAdd()
  }

  return (
    <Screen title={exercise?.name ?? 'Exercise Detail'} back>
      {action.feedback}
      {!!successMessage && (
        <Card>
          <Label>{successMessage}</Label>
        </Card>
      )}

      {exercise && (
        <>
          <Row>
            {active ? (
              <Button
                label={`Add to ${active.name}`}
                selected
                disabled={action.busy}
                onPress={() => void action.run(handleAddToActiveWorkout)}
              />
            ) : (
              <Button
                label="Start quick workout"
                selected
                disabled={action.busy}
                onPress={() => void action.run(handleStartQuickWorkout)}
              />
            )}
            <Button
              label={showRoutineChooser ? 'Close routine chooser' : 'Add to routine'}
              disabled={action.busy}
              onPress={() => {
                setShowRoutineChooser(!showRoutineChooser)
                setSuccessMessage('')
              }}
            />
          </Row>

          {showRoutineChooser && (
            <Card>
              <Label>Select a Routine</Label>
              <Button
                label="+ Create New Routine"
                selected
                disabled={action.busy}
                onPress={() => {
                  router.push({
                    pathname: '/routines',
                    params: { addExerciseId: String(exercise.id) },
                  } as never)
                }}
              />

              {!routines.length ? (
                <Label muted>No routines found. Tap Create New Routine above.</Label>
              ) : (
                routines.map((r) => {
                  let count = 0
                  try {
                    const parsed = JSON.parse(r.definition_json)
                    count = parsed.exercises?.length ?? 0
                  } catch {
                    // ignore
                  }
                  return (
                    <Row key={r.id}>
                      <View style={{ flex: 1 }}>
                        <Label>{r.name}</Label>
                        <Label muted>{count} exercises</Label>
                      </View>
                      <Button
                        label={`Add to ${r.name}`}
                        disabled={action.busy}
                        onPress={() => void handleAddToRoutine(r)}
                      />
                    </Row>
                  )
                })
              )}
            </Card>
          )}

          <Card>
            <Label>Tracking Type</Label>
            <Label muted>{exercise.tracking_type.replaceAll('_', ' + ')}</Label>
          </Card>
          <Card>
            <Label>Muscles</Label>
            <Label muted>Primary: {exercise.primary_muscles.join(', ') || 'None'}</Label>
            {exercise.secondary_muscles && exercise.secondary_muscles.length > 0 && (
              <Label muted>Secondary: {exercise.secondary_muscles.join(', ')}</Label>
            )}
          </Card>
          <Card>
            <Label>Equipment</Label>
            <Label muted>{exercise.equipment.join(', ') || 'bodyweight'}</Label>
          </Card>
          {exercise.aliases && exercise.aliases.length > 0 && (
            <Card>
              <Label>Aliases</Label>
              <Label muted>{exercise.aliases.join(', ')}</Label>
            </Card>
          )}
          {exercise.notes && (
            <Card>
              <Label>Notes</Label>
              <Label muted>{exercise.notes}</Label>
            </Card>
          )}
          <Card>
            <Label>Source</Label>
            <Label muted>{exercise.is_custom ? 'Custom user exercise' : `Built-in (${exercise.source})`}</Label>
          </Card>
        </>
      )}

      {!exercise && !action.busy && (
        <Card>
          <Label>Exercise not found.</Label>
          <Button label="Go back" onPress={() => router.back()} />
        </Card>
      )}
    </Screen>
  )
}
