import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { ProgramInput, type ProgramInput as ProgramInputType } from '@nutai/core-schema'
import {
  listPrograms,
  saveProgram,
  listRoutines,
  programDayStatus,
  programWeekOf,
  cycleDayToWeekday,
  weekdayToCycleDay,
  offsetLocalDate,
  weekdayOfLocalDate,
  launchRoutine,
  type Program,
  type Routine,
} from '@nutai/training'
import { db, localDate } from '../src/data/repo'
import { isValidLocalDate } from '../src/data/date-utils'
import { friendlySetValueError } from '../src/data/workout-errors'
import { confirmDialog } from '../src/ui/alert-web'
import { Screen, Card, Label, Button, Field, Row, useAction } from '../src/components/Screen'
import { ItemRow } from '../src/components/ItemRow'
import { Empty } from '../src/components/Empty'
import { Badge } from '../src/components/Badge'
import { ChipRow } from '../src/components/ChipRow'
import { useTheme } from '../src/theme/ThemeProvider'
import { space } from '../src/theme/tokens'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** A11Y P2-11: the weekday chips announce the full weekday name, not just
    the row heading's 3-letter abbreviation (index-aligned with DAYS). */
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** What the editor's schedule state holds: a real calendar weekday (0 = Sun)
 * plus the routine. Cycle-day conversion happens once, at save/load — the
 * user never sees the engine's internal offsets. */
type ScheduleSlot = { weekday: number; routine_id: number }

/** Task 2-c (program IA): the start date is entered as three friendly number
 * fields (day/month/year) instead of a raw typed YYYY-MM-DD string — no new
 * dependency, composed back to the canonical ISO string at the boundary. */
type DateParts = { day: string; month: string; year: string }

function partsOfDate(iso: string): DateParts {
  const [y, m, d] = iso.split('-')
  return { day: String(Number(d)), month: String(Number(m)), year: y ?? '' }
}

function composeDate(p: DateParts): string {
  const d = Number(p.day)
  const m = Number(p.month)
  if (!/^\d{4}$/.test(p.year) || !Number.isInteger(d) || !Number.isInteger(m)) return ''
  return `${p.year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const EMPTY_FORM = { name: '', startDate: localDate(Date.now()), weeks: '8', schedule: [] as ScheduleSlot[] }

export default function ProgramsScreen() {
  const t = useTheme()
  const [programs, setPrograms] = useState<Program[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])

  const [editing, setEditing] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [name, setName] = useState(EMPTY_FORM.name)
  const [dateParts, setDateParts] = useState<DateParts>(() => partsOfDate(EMPTY_FORM.startDate))
  const [weeks, setWeeks] = useState(EMPTY_FORM.weeks)
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(EMPTY_FORM.schedule)

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

  const resetForm = () => {
    setEditId(null)
    setName(EMPTY_FORM.name)
    setDateParts(partsOfDate(EMPTY_FORM.startDate))
    setWeeks(EMPTY_FORM.weeks)
    setSchedule([])
    setEditing(false)
  }

  const handleSave = async () => {
    if (!name.trim()) throw new Error('Enter a program name')
    const w = Number(weeks)
    if (!Number.isInteger(w) || w < 1 || w > 104) throw new Error('Weeks must be between 1 and 104')
    if (!schedule.length) throw new Error('Assign at least one routine to a day of the week')
    const startDate = composeDate(dateParts)
    if (!isValidLocalDate(startDate)) throw new Error('Choose a real calendar date — day 1–31, month 1–12, and a four-digit year.')

    // The engine stores cycle days (0 = the start date itself); the user
    // picked real weekdays. Convert here — the single boundary — so "Wed"
    // means the calendar Wednesday no matter which weekday the block starts.
    const input: ProgramInputType = {
      name: name.trim(),
      start_date: startDate,
      weeks: w,
      schedule: schedule.map((s) => ({ day: weekdayToCycleDay(s.weekday, startDate), routine_id: s.routine_id })),
    }
    // P1-6: the start date is user-entered — reject impossible dates with a
    // sentence instead of letting the schema throw raw zod JSON at the user.
    try {
      ProgramInput.parse(input)
    } catch (error) {
      throw new Error(friendlySetValueError(error))
    }
    const h = await db()
    // saveProgram accepts an id for updates — the edit flow is the only caller.
    await saveProgram(h, input, editId ?? undefined)
    resetForm()
  }

  const startCreate = () => {
    setEditId(null)
    setName('')
    setDateParts(partsOfDate(localDate(Date.now())))
    setWeeks('8')
    setSchedule([])
    setEditing(true)
  }

  const handleEdit = (p: Program) => {
    let plan: ProgramInputType | null = null
    try {
      plan = ProgramInput.parse(JSON.parse(p.definition_json))
    } catch {
      return
    }
    if (!plan) return
    setEditId(p.id)
    setName(p.name)
    setDateParts(partsOfDate(plan.start_date))
    setWeeks(String(plan.weeks))
    // Stored cycle days → weekdays for the form, using the program's own
    // start date, so the editor shows exactly what the user originally picked.
    setSchedule(plan.schedule.map((s) => ({ weekday: cycleDayToWeekday(s.day, plan!.start_date), routine_id: s.routine_id })))
    setEditing(true)
  }

  const handleToggleDayRoutine = (weekday: number, routineId: number) => {
    const filtered = schedule.filter((s) => s.weekday !== weekday)
    const current = schedule.find((s) => s.weekday === weekday)
    if (current && current.routine_id === routineId) {
      setSchedule(filtered)
    } else {
      setSchedule([...filtered, { weekday, routine_id: routineId }])
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
      {/* Task 2-c (program IA): the chain was never explained anywhere — one
          short card states it in the order the user builds it. */}
      <Card>
        <Label>How programs work</Label>
        <Label muted>
          Exercises → Routine (a reusable workout) → Program (which routine runs on which weekday, for N weeks) → the Train tab shows today's session.
        </Label>
      </Card>
      {action.feedback}

      {!editing && programs.length > 0 && (
        <Button label="Create new program" selected onPress={startCreate} />
      )}

      {editing && (
        <Card>
          <Label>{editId ? 'Edit Program' : 'Create Training Program'}</Label>
          <Field label="Program Name" value={name} onChangeText={setName} placeholder="e.g. 8-Week Hypertrophy" />
          <Row>
            {/* Task 2-c (program IA): three-part date entry replaces the raw
                typed YYYY-MM-DD field (no new dependency; validation still
                happens once at the save boundary). */}
            <View style={{ flex: 1 }}>
              <Field label="Start day" keyboardType="number-pad" maxLength={2} value={dateParts.day} onChangeText={(day) => setDateParts({ ...dateParts, day })} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Start month" keyboardType="number-pad" maxLength={2} value={dateParts.month} onChangeText={(month) => setDateParts({ ...dateParts, month })} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Start year" keyboardType="number-pad" maxLength={4} value={dateParts.year} onChangeText={(year) => setDateParts({ ...dateParts, year })} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Duration (Weeks)" keyboardType="number-pad" value={weeks} onChangeText={setWeeks} />
            </View>
          </Row>

          <Label>Assign Weekly Schedule</Label>
          <Label muted>
            Pick the weekday each routine runs. The week repeats from the start date — changing the start date keeps your weekday plan.
          </Label>
          {routines.length === 0 ? (
            <>
              <Label muted>You need at least one routine before a program has anything to schedule.</Label>
              <Button label="Create a routine first" onPress={() => router.push('/routines' as never)} />
            </>
          ) : (
            DAYS.map((dayName, weekday) => {
              const assigned = schedule.find((s) => s.weekday === weekday)
              return (
                <View key={dayName} style={{ gap: 6 }}>
                  <Label>
                    {dayName}: {assigned ? (routines.find((r) => r.id === assigned.routine_id)?.name ?? 'Assigned') : 'Rest Day'}
                  </Label>
                  <Row>
                    {/* A11Y P2-11: the sanctioned ChipRow replaces the
                        hand-rolled Button row — each chip now announces the
                        routine AND the weekday it assigns (the visible row
                        heading is invisible to a per-chip reader), under a
                        radiogroup named for the weekday. */}
                    <View accessibilityRole="radiogroup" accessibilityLabel={`${FULL_DAYS[weekday]} — assign a routine`}>
                      <ChipRow
                        items={routines}
                        keyOf={(r) => String(r.id)}
                        label={(r) => r.name}
                        a11yLabel={(r) => `${r.name} — ${FULL_DAYS[weekday]}`}
                        isActive={(r) => assigned?.routine_id === r.id}
                        onPress={(r) => handleToggleDayRoutine(weekday, r.id)}
                      />
                    </View>
                  </Row>
                </View>
              )
            })
          )}

          {/* T6 (program as plan): the schedule renders as real dates — the
              user sees WHICH day each routine lands on before saving, never
              just an abstract weekday matrix. */}
          {(() => {
            const previewStart = composeDate(dateParts)
            if (!isValidLocalDate(previewStart) || schedule.length === 0) return null
            const routineName = (id: number) => routines.find((r) => r.id === id)?.name ?? 'Routine'
            const lines: string[] = []
            for (let i = 0; i < 14; i++) {
              const date = offsetLocalDate(previewStart, i)
              const weekday = weekdayOfLocalDate(date)
              const slot = schedule.find((s) => s.weekday === weekday)
              const dayNumber = Number(date.slice(8, 10))
              const month = date.slice(5, 7)
              const label = i < 7 ? `Week 1 · ${FULL_DAYS[weekday]} ${dayNumber}.${month}` : `Week 2 · ${FULL_DAYS[weekday]} ${dayNumber}.${month}`
              lines.push(`${label} — ${slot ? routineName(slot.routine_id) : 'rest'}`)
            }
            return (
              <View style={{ gap: 4 }}>
                <Label muted>First two weeks:</Label>
                {lines.map((line) => (
                  <Label key={line} muted>
                    {line}
                  </Label>
                ))}
              </View>
            )
          })()}

          <Row>
            <Button label={editId ? 'Save changes' : 'Save program'} selected disabled={!routines.length} onPress={() => void action.run(handleSave)} />
            <Button label="Cancel" onPress={resetForm} />
          </Row>
        </Card>
      )}

      <Label>Saved Programs ({programs.length})</Label>
      {!programs.length && (
        // UI/UX report Ch. 6.3 / Table 10.1 (Wave 1c): create-first Empty —
        // the same reset-and-edit path the "Create new program" button runs.
        <Empty
          icon="calendar"
          title="No active programs"
          message="A program maps each weekday to one of your routines, so the Train tab always shows today's session."
          action={{ label: 'Create new program', onPress: startCreate }}
        />
      )}

      {programs.map((p) => {
        let plan: ProgramInputType | null = null
        try {
          plan = ProgramInput.parse(JSON.parse(p.definition_json))
        } catch {
          // ignore
        }
        if (!plan) {
          // Task 12-b m4: a corrupt row used to `return null` — invisible and
          // therefore un-editable/un-deletable. Render the same unreadable
          // card (tabs)/train.tsx shows so the row stays visible and the tab
          // survives one bad row.
          return (
            <Card key={p.id}>
              <Label>{p.name}</Label>
              <Label muted>This program could not be read. Edit or recreate it from Programs &amp; schedule.</Label>
            </Card>
          )
        }
        const status = programDayStatus(plan, today)
        const weekdays = plan.schedule.length
          ? plan.schedule
              .map((s) => DAYS[cycleDayToWeekday(s.day, plan!.start_date)])
              .sort((a, b) => DAYS.indexOf(a as (typeof DAYS)[number]) - DAYS.indexOf(b as (typeof DAYS)[number]))
              .join(' · ')
          : ''

        return (
          <View key={p.id} style={{ gap: space.sm }}>
            {/* UI/UX report Ch. 8.5 (Wave 3): the program row collapses to
                icon + label + value; today's session and Delete ride below.
                Owner QA 2026-10: the row is now pressable — editing a program
                is possible, not just deleting it. */}
            <ItemRow
              icon="calendar"
              label={p.name}
              value={
                programWeekOf(plan, today) !== null
                  ? `Week ${programWeekOf(plan, today)} of ${plan.weeks} · started ${plan.start_date} · ${weekdays || 'no days assigned'}`
                  : `Starts ${plan.start_date} · ${plan.weeks} weeks · ${weekdays || 'no days assigned'}`
              }
              onPress={() => handleEdit(p)}
              accessibilityLabel={`Edit program ${p.name}`}
            />
            {status.kind === 'scheduled' && (
              <View style={{ padding: 10, borderRadius: 10, backgroundColor: t.affirmTint }}>
                <Label>Today's Scheduled Workout: {routines.find((r) => r.id === status.routineId)?.name ?? 'Routine'}</Label>
                <Button label="Launch today's workout" selected onPress={() => void action.run(() => handleLaunch(status.routineId))} />
              </View>
            )}
            {status.kind === 'rest' && <Label muted>Rest day scheduled for today</Label>}
            {status.kind === 'before' && (
              // Task 2-c (program IA): 'before' gets a visible Starts chip, not
              // only muted text.
              <Row>
                <Badge label={`Starts ${plan.start_date}`} variant="outline" size="sm" accessibilityLabel={`Program starts ${plan.start_date}`} />
                <Label muted>{status.daysUntil === 1 ? 'tomorrow' : `in ${status.daysUntil} days`} — no sessions before then</Label>
              </Row>
            )}
            {status.kind === 'finished' && <Label muted>Program finished — all {plan.weeks} weeks ran. Edit it to set a new start date, or create a new block.</Label>}
            <Row>
              <Button label="Edit program" onPress={() => handleEdit(p)} />
              <Button
                label="Delete Program"
                onPress={() =>
                  // T4-b #1: destructive confirmation via the ONE shared
                  // helper (the peer pattern: meal-detail, settings-data,
                  // backup restore). This soft delete has no undo, so the
                  // message must not promise one.
                  confirmDialog({
                    title: 'Delete this program?',
                    message: 'The weekday schedule is removed. Your routines and logged workouts are not affected.',
                    confirmLabel: 'Delete',
                    destructive: true,
                    onConfirm: () => void action.run(() => handleDelete(p.id)),
                  })
                }
              />
            </Row>
          </View>
        )
      })}
    </Screen>
  )
}
