import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { ProgramInput, type ProgramInput as ProgramInputType } from '@nutai/core-schema'
import {
  listPrograms,
  saveProgram,
  listRoutines,
  scheduledRoutine,
  launchRoutine,
  type Program,
  type Routine,
} from '@nutai/training'
import { db, localDate } from '../src/data/repo'
import { Screen, Card, Label, Button, Field, Row, useAction } from '../src/components/Screen'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export default function ProgramsScreen() {
  const [programs, setPrograms] = useState<Program[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(localDate(Date.now()))
  const [weeks, setWeeks] = useState('8')
  const [schedule, setSchedule] = useState<Array<{ day: number; routine_id: number }>>([])

  const refresh = useCallback(async () => {
    const h = await db()
    const pList = await listPrograms(h)
    const rList = await listRoutines(h)
    setPrograms(pList)
    setRoutines(rList)
  }, [])

  const action = useAction(refresh)
  useFocusEffect(
    useCallback(() => {
      void action.run(refresh)
    }, [refresh]),
  )

  const handleSave = async () => {
    if (!name.trim()) throw new Error('Enter a program name')
    const w = Number(weeks)
    if (!Number.isInteger(w) || w < 1 || w > 104) throw new Error('Weeks must be between 1 and 104')
    if (!schedule.length) throw new Error('Assign at least one routine to a day of the week')

    const input: ProgramInputType = {
      name: name.trim(),
      start_date: startDate,
      weeks: w,
      schedule,
    }
    ProgramInput.parse(input)
    const h = await db()
    await saveProgram(h, input)
    setEditing(false)
    setName('')
    setSchedule([])
  }

  const handleToggleDayRoutine = (day: number, routineId: number) => {
    const filtered = schedule.filter((s) => s.day !== day)
    const current = schedule.find((s) => s.day === day)
    if (current && current.routine_id === routineId) {
      setSchedule(filtered)
    } else {
      setSchedule([...filtered, { day, routine_id: routineId }])
    }
  }

  const handleLaunch = async (routineId: number) => {
    const h = await db()
    const workoutId = await launchRoutine(h, routineId, localDate(Date.now()))
    router.push({ pathname: '/workout', params: { id: workoutId } } as never)
  }

  const handleDelete = async (id: number) => {
    const h = await db()
    await h.run('UPDATE programs SET deleted_at = ?, sync_state = ? WHERE id = ?', [
      Date.now(),
      'local',
      id,
    ])
    await refresh()
  }

  const today = localDate(Date.now())

  return (
    <Screen title="Programs & Schedule" back>
      <Label muted>
        Multi-week training blocks with explicit weekly schedule mapping and auto-launching.
      </Label>
      {action.feedback}

      {!editing && (
        <Button
          label="Create New Program"
          selected
          onPress={() => {
            setName('')
            setStartDate(today)
            setWeeks('8')
            setSchedule([])
            setEditing(true)
          }}
        />
      )}

      {editing && (
        <Card>
          <Label>Create Training Program</Label>
          <Field label="Program Name" value={name} onChangeText={setName} placeholder="e.g. 8-Week Hypertrophy" />
          <Row>
            <View style={{ flex: 1 }}>
              <Field label="Start Date (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Duration (Weeks)" keyboardType="number-pad" value={weeks} onChangeText={setWeeks} />
            </View>
          </Row>

          <Label>Assign Weekly Schedule</Label>
          {routines.length === 0 ? (
            <Label muted>You must create at least one routine before configuring a program schedule.</Label>
          ) : (
            DAYS.map((dayName, dayIdx) => {
              const assigned = schedule.find((s) => s.day === dayIdx)
              return (
                <View key={dayName} style={{ gap: 6 }}>
                  <Label>{dayName}: {assigned ? (routines.find((r) => r.id === assigned.routine_id)?.name ?? 'Assigned') : 'Rest Day'}</Label>
                  <Row>
                    {routines.map((r) => (
                      <Button
                        key={r.id}
                        label={r.name}
                        selected={assigned?.routine_id === r.id}
                        onPress={() => handleToggleDayRoutine(dayIdx, r.id)}
                      />
                    ))}
                  </Row>
                </View>
              )
            })
          )}

          <Row>
            <Button label="Save Program" selected disabled={!routines.length} onPress={() => void action.run(handleSave)} />
            <Button label="Cancel" onPress={() => setEditing(false)} />
          </Row>
        </Card>
      )}

      <Label>Saved Programs ({programs.length})</Label>
      {!programs.length && (
        <Label muted>No active programs. Tap Create New Program to start a routine schedule.</Label>
      )}

      {programs.map((p) => {
        let plan: ProgramInputType | null = null
        try {
          plan = ProgramInput.parse(JSON.parse(p.definition_json))
        } catch {
          // ignore
        }
        if (!plan) return null
        const todayRoutineId = scheduledRoutine(plan, today)
        const routineName = todayRoutineId
          ? routines.find((r) => r.id === todayRoutineId)?.name
          : null

        return (
          <Card key={p.id}>
            <Label>{p.name}</Label>
            <Label muted>
              Started {plan.start_date} · {plan.weeks} weeks · {plan.schedule.length} days/week
            </Label>
            {todayRoutineId && (
              <View style={{ padding: 10, borderRadius: 10, backgroundColor: '#10b98120' }}>
                <Label>Today's Scheduled Workout: {routineName ?? 'Routine'}</Label>
                <Button label="Launch Today's Workout" selected onPress={() => void action.run(() => handleLaunch(todayRoutineId))} />
              </View>
            )}
            {!todayRoutineId && <Label muted>Rest day scheduled for today</Label>}
            <Row>
              <Button label="Delete Program" onPress={() => void action.run(() => handleDelete(p.id))} />
            </Row>
          </Card>
        )
      })}
    </Screen>
  )
}
