import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { Alert, Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { RoutineInput, SetKind, SetValues, TRACKING_FIELDS, type ProgressionRule } from '@nutai/core-schema'
import {
  calculatePlates,
  detectSessionPRs,
  discardWorkout,
  editWorkoutExercise,
  finishWorkout,
  groupExercises,
  insertWarmupRamp,
  listEquipment,
  listRoutines,
  nextProgression,
  performanceHistory,
  removeSet,
  reopenWorkout,
  saveRoutine,
  saveSet,
  updateWorkout,
  workoutDetail,
  type Equipment,
  type WorkoutExercise,
  type WorkoutSet,
} from '@nutai/training'
import { type WeightUnit } from '@nutai/analytics'
import { db, putSetting, redoLastWorkoutOperation, setting, undoLastWorkoutOperation } from '../src/data/repo'
import { readWeightUnit } from '../src/data/weight-units'
import { Button, Field, Label, Row, Screen, useAction } from '../src/components/Screen'
import { Badge } from '../src/components/Badge'
import { Icon } from '../src/components/Icon'
import { PressableFX, useReducedMotion } from '../src/components/PressableFX'
import { MenuSheet, Sheet, type MenuSection } from '../src/components/Sheet'
import {
  circuitMemberLabel,
  compactPrevious,
  exerciseBlocks,
  nextFocusIndex,
  previousBySetSlot,
  primaryFields,
  restClockLabel,
  shortFieldLabel,
} from '../src/data/set-table'
import {
  EFFORT_PICKS,
  JARGON_HINTS,
  SET_KIND_LABELS,
  canonicalizeFieldValue,
  describeSet,
  formatLoadForDisplay,
  getFieldLabels,
  setValuesToDisplay,
} from '../src/data/workout-load'
import { friendlySetValueError } from '../src/data/workout-errors'
import { showToast } from '../src/components/toast-store'
import { syncRestNotification } from '../src/notifications/scheduler'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, elevationStyle, radius, space, stateLayerFor, type } from '../src/theme/tokens'
// UI/UX report Table 9.2 (Wave 1c): "Complete a set → Light impact" — fast,
// physical, repeatable; a full workout finish is the success moment instead.
import { lightImpact as hapticLightImpact, warning as hapticWarning } from '../src/utils/haptics'
import { confirmDialog } from '../src/ui/alert-web'

/**
 * The live-workout screen — UI/UX report Ch. 8.5 (Wave 3), the Hevy pattern.
 *
 * The set table is the screen: one row per set (number / previous / the
 * exercise's tracked value fields / a check that completes the set), a check
 * that lands the light-impact haptic and auto-advances, and an "Add set" row.
 * The ~12 equal-weight text buttons the report audited collapse into ONE
 * context menu per exercise (overflow chevron → bottom-sheet menu with
 * icon-labeled groups). The rest timer lives as a persistent chip that counts
 * down, pulses at zero, and skips on tap. Supersets render as linked
 * color-coded groups using ONE tinted token (stateLayerFor selected), not
 * ad-hoc alphas.
 *
 * T-IMPL-B (progression transparency): the launcher's "This week" suggestion
 * (workouts.progression_note) renders as a dismissible banner — the prefill
 * already happened, the banner explains WHY and offers Accept/Edit. Finishing
 * a workout detects e1RM PRs (detectSessionPRs) into the completion summary,
 * a finished exercise shows its computed next-time prescription, and a
 * routine-authored per-exercise rest (RoutineInput.rest_seconds) drives the
 * rest chip when present.
 *
 * DATA FLOW IS UNCHANGED: same workout_sets writes through saveSet /
 * removeSet / editWorkoutExercise / updateWorkout, same undo (operations
 * table), same auto-rest semantics (rest_seconds → rest_until, P2-8). This is
 * a UI-layer change over the same domain calls.
 */

type SetInputRef = ComponentRef<typeof TextInput>

/** Fixed width of the set-number column (#) in the set table. */
const SET_NUMBER_WIDTH = 26

/**
 * T4-b #4: planned_json is written at routine launch and was parsed UNGUARDED
 * in render — one corrupt row threw mid-render and killed the whole flagship
 * screen (the root ErrorBoundary caught it; the workout still died). Parse
 * per row behind a guard: corrupt data renders the honest unreadable caption
 * (the train-tab corrupt-program-card pattern) and logging keeps working.
 */
function plannedCaption(s: WorkoutSet, unit: WeightUnit): string | null {
  if (!s.planned_json) return null
  try {
    return `Planned: ${describeSet({ ...s, ...JSON.parse(s.planned_json) }, unit)}`
  } catch {
    return 'Planned data unreadable — this set still logs normally.'
  }
}

export default function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const t = useTheme()
  const layers = stateLayerFor(t.isDark)
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof workoutDetail>> | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [unit, setUnit] = useState<WeightUnit>('kg')
  const [group, setGroup] = useState<number[]>([])
  const [clock, setClock] = useState(Date.now())
  const [restPref, setRestPref] = useState(90)
  // Per-exercise, per-set-slot previous values from performanceHistory —
  // the "previous" column of the set table (Ch. 8.5).
  const [previous, setPrevious] = useState<Map<number, Map<number, SetValues>>>(new Map())
  // T-IMPL-B A3/I: the routine's plan, parsed ONCE per load into state (the
  // PERF mandate forbids JSON.parse in render loops). Maps exercise_id → its
  // progression rule + authored per-exercise rest. Null for empty workouts.
  const [routinePlan, setRoutinePlan] = useState<Map<number, { rule: ProgressionRule; rest_seconds: number | null }> | null>(null)
  // T-IMPL-B A3: the launcher's "This week" banner — dismissed per workout.
  const [suggestionDismissedFor, setSuggestionDismissedFor] = useState<number | null>(null)
  // T-IMPL-B F4: session PRs, detected once at the finish moment.
  const [prs, setPrs] = useState<Array<{ name: string; e1rm_kg: number }>>([])
  // Context-menu + inline-tools state (the collapsed twelve actions).
  // `menuFor`/`plateFor` RETAIN the last payload after close so the sheets
  // can play their exit animation before unmounting content.
  const [menuFor, setMenuFor] = useState<WorkoutExercise | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notesFor, setNotesFor] = useState<number | null>(null)
  const [plateFor, setPlateFor] = useState<{ name: string; target: string } | null>(null)

  const refresh = useCallback(async () => {
    const h = await db()
    const [nextDetail, nextAdvanced, nextUnit, nextRestPref, perf] = await Promise.all([
      workoutDetail(h, Number(id)),
      setting('training.advanced', 'false'),
      readWeightUnit(h),
      setting('training.rest_seconds', '90'),
      performanceHistory(h),
    ])
    setDetail(nextDetail)
    setAdvanced(nextAdvanced === 'true')
    setUnit(nextUnit)
    const parsed = Number(nextRestPref)
    setRestPref(Number.isFinite(parsed) ? Math.min(600, Math.max(15, Math.round(parsed))) : 90)
    setPrevious(previousBySetSlot(perf))
    // The routine plan (rules + per-exercise rest) rides ONE guarded parse per
    // load — a corrupt definition simply means no plan, never a broken screen.
    const rid = nextDetail.workout.routine_id
    if (rid == null) {
      setRoutinePlan(null)
      return
    }
    const row = await h.get<{ definition_json: string }>('SELECT definition_json FROM routines WHERE id = ?', [rid])
    if (!row) {
      setRoutinePlan(null)
      return
    }
    try {
      const parsedPlan = RoutineInput.parse(JSON.parse(row.definition_json))
      setRoutinePlan(new Map(parsedPlan.exercises.map((e) => [e.exercise_id, { rule: e.rule, rest_seconds: e.rest_seconds ?? null }])))
    } catch {
      setRoutinePlan(null)
    }
  }, [id])
  const action = useAction(refresh)

  useFocusEffect(useCallback(() => { void action.run(refresh) }, [refresh]))
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const run = (fn: () => Promise<unknown>) => { void action.run(fn) }

  // P2-8: rest was a fixed 90s with no adjustments. ±15s now tunes the running
  // timer, or the remembered preferred duration when idle; “Rest Ns” starts a
  // rest with that duration. The chip carries the countdown; these live in
  // the Tools group of the exercise menu.
  const adjustRest = (deltaS: number) => run(async () => {
    const h = await db()
    const w = detail?.workout
    if (!w) return
    if ((w.rest_until ?? 0) > 0) {
      const next = (w.rest_until ?? 0) + deltaS * 1000
      await updateWorkout(h, w.id, { rest_until: next > 0 ? next : null })
      void syncRestNotification(next > 0 ? next : null, w.id)
    } else {
      const next = Math.min(600, Math.max(15, restPref + deltaS))
      setRestPref(next)
      await putSetting('training.rest_seconds', String(next))
    }
  })

  if (!detail) {
    return (
      <Screen title="Workout" back>
        {action.feedback}
        {action.error ? null : <Label muted>Loading saved workout…</Label>}
      </Screen>
    )
  }

  const { workout: w, exercises } = detail
  const active = w.status === 'active'
  const rest = Math.max(0, Math.ceil(((w.rest_until ?? 0) - clock) / 1000))
  // The chip stays up while rest_until is set: counting down, then PULSING at
  // zero until the user taps it away (skip).
  const resting = w.rest_until != null

  const skipRest = () => run(async () => { await updateWorkout(await db(), w.id, { rest_until: null }); void syncRestNotification(null, w.id) })
  // T-IMPL-B (rest polish): a routine-authored per-exercise rest wins over the
  // global preference — the menu rest and the auto-rest per set both read it.
  const restFor = (exerciseId: number): number => {
    const authored = routinePlan?.get(exerciseId)?.rest_seconds
    if (authored != null && authored > 0) return Math.min(600, Math.max(15, authored))
    return restPref
  }
  const startRest = (seconds: number = restPref) => run(async () => { const until = Date.now() + seconds * 1000; await updateWorkout(await db(), w.id, { rest_until: until }); void syncRestNotification(until, w.id) })

  // ------------------------------------------------------------------
  // The collapsed twelve secondary actions (Ch. 8.5). Every handler is the
  // exact one the old equal-weight buttons ran — only the vessel changed.
  const menuSectionsFor = (e: WorkoutExercise, index: number): MenuSection[] => {
    const lastSet = e.sets.at(-1) ?? null
    const lastSetNumber = lastSet ? lastSet.sort_order + 1 : 0
    const trackingFields = TRACKING_FIELDS[e.tracking_type]
    // Plate-helper target: the most recent set that actually carries a load
    // (the empty trailing row would prefill nothing), else the session
    // previous — the same value the old per-set button routed with.
    const lastLoadedSet = [...e.sets].reverse().find(s => s.load_kg != null) ?? null
    const setsSection: MenuSection = {
      caption: 'Sets',
      items: [
        {
          key: 'add-set',
          label: 'Add set',
          icon: 'plus',
          onPress: () => run(async () => {
            const prior = e.sets.at(-1) ?? e.previous
            await saveSet(await db(), e.id, prior ? SetValues.parse(prior) : {}, { completed: false })
          }),
        },
        ...(lastSet
          ? [
              {
                key: 'duplicate-set',
                label: `Duplicate set ${lastSetNumber}`,
                icon: 'dot6' as const,
                onPress: () => run(async () => {
                  await saveSet(await db(), e.id, SetValues.parse(lastSet), { completed: false, kind: lastSet.kind })
                }),
              },
              {
                key: 'delete-set',
                label: `Delete set ${lastSetNumber}`,
                icon: 'minus' as const,
                // Removing a logged set is destructive of data — safety tone,
                // still Undo-able via the operations table.
                destructive: true,
                onPress: () => run(async () => { await removeSet(await db(), lastSet.id) }),
              },
            ]
          : []),
      ],
    }
    const exerciseSection: MenuSection = {
      caption: 'Exercise',
      items: [
        {
          key: 'replace',
          label: 'Replace exercise',
          icon: 'search',
          onPress: () => router.push({ pathname: '/search', params: { scope: 'exercise', workoutId: w.id, replace: e.id } } as never),
        },
        {
          key: 'move-up',
          label: 'Move up',
          icon: 'arrowUp',
          // Task 12-b NIT: index −1 means the menued exercise was removed
          // while the sheet was open — its move target no longer exists and
          // the old handler threw on exercises[-2]. Keep the item unpressable.
          disabled: index <= 0,
          onPress: () => run(async () => {
            const h = await db()
            const previousExercise = exercises[index - 1]!
            await editWorkoutExercise(h, e.id, { sort_order: previousExercise.sort_order })
            await editWorkoutExercise(h, previousExercise.id, { sort_order: e.sort_order })
          }),
        },
        {
          key: 'remove',
          label: 'Remove exercise',
          icon: 'close',
          destructive: true,
          onPress: () => run(async () => { await editWorkoutExercise(await db(), e.id, { deleted_at: Date.now() }) }),
        },
      ],
    }
    const supersetSection: MenuSection = {
      caption: 'Superset',
      items: [
        {
          key: 'circuit',
          label: group.includes(e.id) ? 'Deselect for circuit' : 'Select for circuit',
          icon: 'handshake',
          hint: 'Link exercises into an alternating circuit',
          onPress: () => setGroup(group.includes(e.id) ? group.filter(i => i !== e.id) : [...group, e.id]),
        },
        ...(e.superset_group_id
          ? [
              {
                key: 'ungroup',
                label: 'Remove from circuit',
                icon: 'dot1' as const,
                onPress: () => run(async () => { await editWorkoutExercise(await db(), e.id, { superset_group_id: null }) }),
              },
            ]
          : []),
      ],
    }
    const toolsSection: MenuSection = {
      caption: 'Tools',
      items: [
        {
          key: 'notes',
          label: notesFor === e.id ? 'Hide notes' : 'Notes',
          icon: 'pencil',
          onPress: () => setNotesFor(notesFor === e.id ? null : e.id),
        },
        // T-IMPL-B (warm-up ramp): 40%×5 · 70%×3 · 90%×1 of the first working
        // load, inserted as warmup-kind rows — analytics and PRs already
        // exclude warmups (packages/analytics isWorkingSet).
        ...(trackingFields.includes('load_kg')
          ? [
              {
                key: 'warmup-ramp',
                label: 'Add warm-up ramp',
                icon: 'flame' as const,
                hint: '40%×5 · 70%×3 · 90%×1 of your first working load',
                disabled: e.sets.some((s) => s.kind === 'warmup'),
                onPress: () => run(async () => { await insertWarmupRamp(await db(), e.id) }),
              },
            ]
          : []),
        {
          key: 'rest',
          label: resting ? 'Skip rest' : `Rest ${restFor(e.exercise_id)}s`,
          icon: 'clock',
          onPress: resting ? skipRest : () => startRest(restFor(e.exercise_id)),
        },
        {
          key: 'rest-minus',
          label: '−15 seconds',
          hint: resting ? 'Shorten the running rest' : `Adjust preferred rest (${restPref}s)`,
          icon: 'minus',
          onPress: () => adjustRest(-15),
        },
        {
          key: 'rest-plus',
          label: '+15 seconds',
          hint: resting ? 'Extend the running rest' : `Adjust preferred rest (${restPref}s)`,
          icon: 'plus',
          onPress: () => adjustRest(15),
        },
        ...(trackingFields.includes('load_kg')
          ? [
              {
                key: 'plate',
                label: 'Plate helper',
                icon: 'scale' as const,
                hint: 'Break the load into plates from your inventory',
                onPress: () => setPlateFor({
                  name: e.name,
                  target: lastLoadedSet?.load_kg != null
                    ? String(Math.round(lastLoadedSet.load_kg * 100) / 100)
                    : e.previous?.load_kg != null
                      ? String(Math.round((e.previous?.load_kg ?? 0) * 100) / 100)
                      : '',
                }),
              },
            ]
          : []),
        {
          key: 'routine',
          label: 'Save as routine',
          icon: 'bookmark',
          hint: 'From this workout’s completed sets',
          onPress: () => run(async () => {
            // T-IMPL-B G: the minted routine now carries the DEFAULT
            // progression ("Reps first, then weight") instead of the dead
            // 'manual' kind, and a name collision offers Overwrite vs Create
            // new instead of silently accumulating duplicates.
            const input = {
              name: `${w.name} routine`,
              exercises: exercises
                .filter((ex) => ex.sets.some((s) => s.completed_at))
                .map((ex) => ({
                  exercise_id: ex.exercise_id,
                  group: ex.superset_group_id,
                  sets: ex.sets.filter((s) => s.completed_at).map((s) => SetValues.parse(s)),
                  rule: { kind: 'double', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 },
                })),
            }
            if (!input.exercises.length) throw new Error('Complete at least one set to save a routine')
            const h = await db()
            const existing = (await listRoutines(h)).find((r) => r.name === input.name)
            if (!existing) {
              await saveRoutine(h, input)
            } else {
              await new Promise<void>((resolve) => {
                Alert.alert(
                  'Routine name in use',
                  `“${input.name}” already exists. Overwrite it with this workout's exercises and sets, or create a new routine?`,
                  [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
                    {
                      text: 'Overwrite',
                      onPress: () => {
                        resolve()
                        void action.run(async () => {
                          const dbh = await db()
                          await saveRoutine(dbh, input, existing.id)
                          showToast({ message: `Routine “${existing.name}” updated.`, tone: 'success' })
                        })
                      },
                    },
                    {
                      text: 'Create new',
                      onPress: () => {
                        resolve()
                        void action.run(async () => {
                          const dbh = await db()
                          await saveRoutine(dbh, input)
                          showToast({ message: 'Routine saved.', tone: 'success' })
                        })
                      },
                    },
                  ],
                )
              })
              return
            }
            // UI/UX report §10.1 (Wave 1b): a successful save confirms itself
            // with a toast that offers the next action — not a dialog.
            showToast({
              message: 'Routine saved.',
              tone: 'success',
              action: { label: 'Open Train', onPress: () => router.push('/(tabs)/train' as never) },
            })
          }),
        },
      ],
    }
    return [setsSection, exerciseSection, supersetSection, toolsSection]
  }

  const blocks = exerciseBlocks(exercises)
  const addSetFor = (e: WorkoutExercise) =>
    run(async () => {
      const prior = e.sets.at(-1) ?? e.previous
      await saveSet(await db(), e.id, prior ? SetValues.parse(prior) : {}, { completed: false })
    })
  const openMenuFor = (e: WorkoutExercise) => {
    setMenuFor(e)
    setMenuOpen(true)
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen title={w.name} back>
        <Label muted>
          {w.local_date} · {active ? `${Math.floor((clock - w.started_at) / 60000)} minutes · saved locally` : 'Completed workout'}
        </Label>
        {action.feedback}

        {/* T-IMPL-B A3 — the visible progression suggestion (headline fix).
            The launcher already prefilled today's targets; the banner adds
            the WHY ("Squat: 22.5 kg — you hit 12 reps on all sets last time")
            and the choice: Accept keeps the prefill, Edit closes the banner
            and every field stays editable as normal. */}
        {active && w.progression_note && suggestionDismissedFor !== w.id && (
          <View style={[styles.suggestionCard, { backgroundColor: t.affirmTint, borderColor: t.affirm }]}>
            <Text style={[type.bodyStrong, { color: t.text }]}>This week</Text>
            {w.progression_note.split('\n').filter(Boolean).map((line, i) => (
              <Text key={i} style={[type.caption, { color: t.textMuted, lineHeight: 19 }]}>{line}</Text>
            ))}
            <Row>
              <Button label="Accept" selected onPress={() => setSuggestionDismissedFor(w.id)} />
              <Button label="Edit" onPress={() => setSuggestionDismissedFor(w.id)} />
            </Row>
          </View>
        )}

        {active && (
          <Row>
            <Button label="Add exercise" onPress={() => router.push({ pathname: '/search', params: { scope: 'exercise', workoutId: w.id } } as never)} />
            {/* Task 2-c (mode vocabulary): these are per-SET fields, not modes —
                "quick/advanced mode" collided with the food-scan vocabulary. */}
            <Button label={advanced ? 'Simple set fields' : 'Advanced set fields'} onPress={() => run(async () => { await putSetting('training.advanced', String(!advanced)); setAdvanced(!advanced) })} />
          </Row>
        )}
        {active && (
          <Label muted>
            {advanced
              ? 'Advanced set fields on: RIR (reps left in the tank) · RPE (how hard it felt) · tempo · set types.'
              : 'Advanced set fields add RIR · RPE · tempo · set types per set — each one explains itself where it appears.'}
          </Label>
        )}

        {!exercises.length && <Label muted>Add an exercise to begin. Search or create your own.</Label>}

        {/* Supersets: linked color-coded groups on ONE tinted token (Ch. 8.5
            — stateLayerFor selected, replacing ad-hoc alpha washes). */}
        {blocks.map(block =>
          block.kind === 'single' ? (
            <ExerciseCard
              key={block.exercise.id}
              exercise={block.exercise}
              active={active}
              advanced={advanced}
              refresh={refresh}
              unit={unit}
              restSeconds={restFor(block.exercise.exercise_id)}
              rule={routinePlan?.get(block.exercise.exercise_id)?.rule ?? null}
              previousSlots={previous.get(block.exercise.exercise_id) ?? null}
              selected={group.includes(block.exercise.id)}
              circuitLabel={null}
              notesOpen={notesFor === block.exercise.id}
              onOpenMenu={() => openMenuFor(block.exercise)}
              onAddSet={() => addSetFor(block.exercise)}
            />
          ) : (
            <View key={`group-${block.letter}`} style={[styles.circuitGroup, { backgroundColor: layers.selected.backgroundColor }]}>
              <Label muted>Circuit · alternate exercises each round. Rest starts after the final exercise.</Label>
              {block.exercises.map((e, memberIndex) => (
                <ExerciseCard
                  key={e.id}
                  exercise={e}
                  active={active}
                  advanced={advanced}
                  refresh={refresh}
                  unit={unit}
                  restSeconds={restFor(e.exercise_id)}
                  rule={routinePlan?.get(e.exercise_id)?.rule ?? null}
                  previousSlots={previous.get(e.exercise_id) ?? null}
                  selected={group.includes(e.id)}
                  circuitLabel={circuitMemberLabel(block.letter, memberIndex)}
                  notesOpen={notesFor === e.id}
                  onOpenMenu={() => openMenuFor(e)}
                  onAddSet={() => addSetFor(e)}
                />
              ))}
            </View>
          ),
        )}

        {group.length >= 2 && (
          <Button
            label="Group selected exercises into circuit"
            onPress={() => run(async () => { await groupExercises(await db(), w.id, group); setGroup([]) })}
          />
        )}

        {active && (
          <>
            <SavedText label="Workout notes" initial={w.notes} save={async text => updateWorkout(await db(), w.id, { notes: text })} />
            <SavedText label="Location (optional)" initial={w.location} save={async text => updateWorkout(await db(), w.id, { location: text })} />
          </>
        )}

        <Row>
          {/* Task 12-b M1: scoped variants — a food log newer than the last
              workout action must not be undone by these buttons. */}
          <Button label="Undo workout action" onPress={() => run(async () => { const r = await undoLastWorkoutOperation(); if (!r.success) throw new Error(r.error ?? 'Nothing to undo') })} />
          <Button label="Redo workout action" onPress={() => run(async () => { const r = await redoLastWorkoutOperation(); if (!r.success) throw new Error(r.error ?? 'Nothing to redo') })} />
        </Row>

        {active ? (
          <>
            <Button
              label="Finish workout"
              selected
              disabled={action.busy}
              onPress={() => run(async () => {
                await finishWorkout(await db(), w.id)
                void syncRestNotification(null, w.id)
                // T-IMPL-B F4: one query at the finish moment — a better e1RM
                // than EVERY previous completed session wins the banner below.
                setPrs(await detectSessionPRs(await db(), w.id))
              })}
            />
            <Button
              label="Discard workout"
              onPress={() => confirmDialog({
                title: 'Discard workout?',
                message: 'The saved workout can be restored with Undo.',
                confirmLabel: 'Discard',
                destructive: true,
                onConfirm: () => run(async () => { await discardWorkout(await db(), w.id); void syncRestNotification(null, w.id); router.back() }),
              })}
            />
          </>
        ) : (
          <>
            {/* T-IMPL-B F4: the completion summary's PR banner — the same
                Epley window the Progress charts use, so the two can never
                disagree. Detected at the finish tap; stored sessions reopen
                without re-celebrating. */}
            {prs.map((pr) => (
              <View key={pr.name} style={[styles.suggestionCard, { backgroundColor: t.affirmTint, borderColor: t.affirm }]}>
                <Text style={[type.bodyStrong, { color: t.text }]}>New PR — {pr.name} {formatLoadForDisplay(pr.e1rm_kg, unit)} {unit}</Text>
                <Text style={[type.caption, { color: t.textMuted }]}>Best estimated 1RM across every completed session.</Text>
              </View>
            ))}
            <Button label="Reopen workout to edit" onPress={() => run(async () => reopenWorkout(await db(), w.id))} />
          </>
        )}
      </Screen>

      {/* The persistent rest chip (Strong's pattern, Ch. 8.5): counts down,
          pulses at zero, tap = skip rest. Floating above the scrolling table. */}
      {active && (
        <View pointerEvents="box-none" style={styles.chipLayer}>
          <RestChip rest={rest} resting={resting} onSkip={skipRest} onAdjust={adjustRest} />
        </View>
      )}

      {/* The twelve collapsed actions, grouped (Ch. 8.5). */}
      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={menuFor?.name}
        sections={menuFor ? menuSectionsFor(menuFor, exercises.findIndex(x => x.id === menuFor.id)) : []}
      />

      {/* Plate calculator as a bottom sheet (Ch. 8.5) — same
          calculatePlates domain call as the equipment screen. */}
      <PlateSheet open={plateFor != null} onClose={() => setPlateFor(null)} initialTarget={plateFor?.target ?? ''} />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Exercise card: name + set count + overflow chevron, then the set table.

function ExerciseCard({
  exercise: e,
  active,
  advanced,
  refresh,
  unit,
  restSeconds,
  rule,
  previousSlots,
  selected,
  circuitLabel,
  notesOpen,
  onOpenMenu,
  onAddSet,
}: {
  exercise: WorkoutExercise
  active: boolean
  advanced: boolean
  refresh: () => Promise<void>
  unit: WeightUnit
  restSeconds: number
  /** The routine's progression rule for this exercise (null in empty workouts). */
  rule: ProgressionRule | null
  previousSlots: Map<number, SetValues> | null
  selected: boolean
  circuitLabel: string | null
  notesOpen: boolean
  onOpenMenu: () => void
  onAddSet: () => void
}) {
  const t = useTheme()
  const fields = primaryFields(e.tracking_type)
  const doneCount = e.sets.filter(s => s.completed_at).length
  const hasAnyPrevious = (previousSlots?.size ?? 0) > 0 || e.previous != null
  // Auto-advance: the card owns one ref per set row's first input so a
  // completed check can focus the next open row (Hevy's fast repeat).
  const firstInputRefs = useRef<Array<SetInputRef | null>>([])
  // T-IMPL-B A3: once the exercise is done, show the engine's next-time
  // prescription as a one-line note (computed from the LAST completed set —
  // the same engine the launcher used to prefill). Cheap, memoized per set.
  const nextTimeNote = useMemo(() => {
    if (!rule || !active) return null
    const done = [...e.sets].reverse().find((s) => s.completed_at)
    if (!done) return null
    try {
      const res = nextProgression({ previous: SetValues.parse(done), rule, tracking_type: e.tracking_type })
      const description = describeSet(res.values, unit)
      return description ? `Next time: ${description} — ${res.explanation}` : null
    } catch {
      return null
    }
  }, [rule, active, e.sets, e.tracking_type, unit])

  const onSetChecked = (index: number) => {
    const focus = nextFocusIndex(e.sets, index)
    if (focus == null) return
    firstInputRefs.current[focus]?.focus()
  }

  return (
    <View style={[styles.exerciseCard, { backgroundColor: t.bgElevated, borderColor: t.border }]}>
      <View style={styles.exerciseHeader}>
        {circuitLabel ? <Badge label={circuitLabel} variant="outline" size="sm" accessibilityLabel={`Circuit position ${circuitLabel}`} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={2} style={[type.bodyStrong, { color: t.text }]}>{e.name}</Text>
          <Text style={[type.caption, { color: t.textMuted }]}>
            {active ? `${doneCount}/${e.sets.length} sets complete` : `${e.sets.length} sets`}
            {!hasAnyPrevious ? ' · no completed session yet' : ''}
          </Text>
        </View>
        {selected ? <Badge label="Selected" variant="selected" size="sm" accessibilityLabel="Selected for circuit" /> : null}
        {active && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${e.name} actions`}
            onPress={onOpenMenu}
            hitSlop={space.sm}
            style={styles.overflowButton}
          >
            {/* The overflow ellipsis — the ONE affordance that opens the
                twelve collapsed actions (Ch. 8.5). */}
            <Icon name="dot3" size={20} color={t.text} />
          </Pressable>
        )}
      </View>

      {/* The set table (Ch. 8.5): # | previous | value fields | check. */}
      {active && (
        <View style={{ gap: 6, marginTop: space.xs }}>
          <View style={styles.tableHeader}>
            <Text style={[type.caption, { color: t.textFaint, width: SET_NUMBER_WIDTH, textAlign: 'center' }]}>#</Text>
            <Text style={[type.caption, { color: t.textFaint, flex: 1 }]}>PREV</Text>
            {fields.map(key => (
              <Text key={key} style={[type.caption, { color: t.textFaint, flex: 1, textAlign: 'center' }]}>{shortFieldLabel(key, unit)}</Text>
            ))}
            <View style={{ width: MIN_TAP_TARGET }} />
          </View>
          {e.sets.map((s, index) => (
            <SetRow
              key={s.id}
              exercise={e}
              set={s}
              index={index}
              advanced={advanced}
              refresh={refresh}
              unit={unit}
              restSeconds={restSeconds}
              previousValue={previousSlots?.get(s.sort_order) ?? null}
              onChecked={onSetChecked}
              registerFirstInput={(i, input) => { firstInputRefs.current[i] = input }}
            />
          ))}
          <PressableFX
            accessibilityRole="button"
            accessibilityLabel={`Add set to ${e.name}`}
            onPress={onAddSet}
            style={[styles.addSetRow, { borderColor: t.border }]}
          >
            <Icon name="plus" size={18} color={t.textMuted} />
            <Text style={[type.label, { color: t.textMuted }]}>Add set</Text>
          </PressableFX>
          {nextTimeNote ? (
            <Text style={[type.caption, { color: t.affirm }]}>{nextTimeNote}</Text>
          ) : null}
        </View>
      )}

      {/* Completed workout: the table becomes a read-only summary. */}
      {!active &&
        e.sets.map(s => (
          <View key={s.id} style={styles.summaryRow}>
            <Text style={[type.monoData, { color: t.textFaint, width: SET_NUMBER_WIDTH }]}>{s.sort_order + 1}</Text>
            <Text style={[type.body, { color: t.textMuted, flex: 1, textDecorationLine: s.completed_at ? 'line-through' : 'none' }]}>
              {s.kind !== 'normal' ? `${SET_KIND_LABELS[s.kind as SetKind] ?? s.kind} · ` : ''}{describeSet(s, unit) || 'no values'}{s.completed_at ? '' : ' · not completed'}
            </Text>
            {s.completed_at ? <Icon name="check" size={16} color={t.affirm} /> : null}
          </View>
        ))}

      {active && notesOpen && <SavedText label={`${e.name} notes`} initial={e.notes} save={async notes => editWorkoutExercise(await db(), e.id, { notes })} />}
    </View>
  )
}

/** One set row of the table (see ExerciseCard for the columns). */
function SetRow({
  exercise: e,
  set: s,
  index,
  advanced,
  refresh,
  unit,
  restSeconds,
  previousValue,
  onChecked,
  registerFirstInput,
}: {
  exercise: WorkoutExercise
  set: WorkoutSet
  index: number
  advanced: boolean
  refresh: () => Promise<void>
  unit: WeightUnit
  restSeconds: number
  previousValue: SetValues | null
  /** Fires after a check completes this row — parent focuses the next row. */
  onChecked: (index: number) => void
  registerFirstInput: (index: number, input: SetInputRef | null) => void
}) {
  const t = useTheme()
  const labels = getFieldLabels(unit)
  const fields = primaryFields(e.tracking_type)
  const toDisplayValues = useCallback((parsed: SetValues) => setValuesToDisplay(parsed, unit), [unit])
  const [values, setValues] = useState<Record<string, string>>(() => toDisplayValues(SetValues.parse(s)))
  const [kind, setKind] = useState(s.kind)
  const [error, setError] = useState('')
  const queue = useRef(Promise.resolve())
  const draft = useRef(SetValues.parse(s))
  const [saving, setSaving] = useState(false)
  // P3-A12: parse once per SET ROW OBJECT, not once per render — this component
  // re-renders on every keystroke, and the old deps array re-ran SetValues.parse
  // + JSON.stringify for every row on every one of those renders.
  const parsedSet = useMemo(() => SetValues.parse(s), [s])
  // T4-b #4: the planned line parses per row object behind the guard — a
  // corrupt planned_json renders the honest unreadable caption, never a throw.
  const plannedText = useMemo(() => plannedCaption(s, unit), [s, unit])
  useEffect(() => {
    setValues(toDisplayValues(parsedSet))
    draft.current = parsedSet
    setKind(s.kind)
  }, [s.id, s.completed_at, s.kind, parsedSet, toDisplayValues])
  const persist = (next: SetValues, completed = false, nextKind = kind, refreshAfter = false) => {
    setSaving(true)
    queue.current = queue.current
      .then(async () => {
        await saveSet(await db(), e.id, next, { id: s.id, completed, kind: nextKind, restSeconds })
        if (refreshAfter) await refresh()
        setError('')
      })
      .catch(err => setError(friendlySetValueError(err)))
      .finally(() => setSaving(false))
  }

  const completed = !!s.completed_at

  /** The check (Ch. 8.5): completes the set with the light-impact haptic and
      auto-advances; a completed row un-checks without a haptic. */
  const onCheck = () => {
    if (completed) {
      persist(draft.current, false, kind, true)
      return
    }
    void hapticLightImpact()
    persist(draft.current, true, kind, true)
    onChecked(index)
  }

  const advancedFields = advanced ? (['rir', 'rpe', 'tempo'] as const) : []
  const rowTint = completed ? t.affirmTint : 'transparent'

  return (
    <View style={[styles.setRow, { backgroundColor: rowTint }]}>
      <View style={styles.setRowMain}>
        <Text
          accessibilityLabel={`Set ${s.sort_order + 1}${completed ? ', completed' : ''}`}
          style={[type.monoData, { color: t.textFaint, width: SET_NUMBER_WIDTH, textAlign: 'center', textDecorationLine: completed ? 'line-through' : 'none' }]}
        >
          {s.sort_order + 1}
        </Text>
        <Text
          accessibilityLabel={previousValue ? `Previous: ${describeSet(previousValue, unit)}` : 'No previous set'}
          numberOfLines={1}
          style={[type.monoData, { color: completed ? t.textFaint : t.textMuted, flex: 1, textDecorationLine: completed ? 'line-through' : 'none' }]}
        >
          {compactPrevious(previousValue, fields, unit)}
        </Text>
        {fields.map((key, fieldIndex) => (
          <TextInput
            key={key}
            ref={fieldIndex === 0 ? (el: SetInputRef | null) => registerFirstInput(index, el) : undefined}
            accessibilityLabel={`${labels[key]} set ${s.sort_order + 1}`}
            keyboardType={key === 'tempo' ? 'default' : 'decimal-pad'}
            // Wave 4b (report §11.1): Android's TextInput ships with font
            // scaling OFF — without the explicit prop the set table ignores
            // the OS font scale entirely. The cap mirrors the monoData token
            // (spread below in the style array), so numeral cells grow with
            // the OS font size but stop at 1.2× where column alignment lives.
            allowFontScaling
            maxFontSizeMultiplier={1.2}
            value={values[key] ?? ''}
            onChangeText={text => {
              setValues(v => ({ ...v, [key]: text }))
              const { valid, value } = canonicalizeFieldValue(key, text, unit)
              if (!valid) return
              const next = { ...draft.current, [key]: value }
              draft.current = next
              persist(next, completed)
            }}
            style={[
              styles.cellInput,
              type.monoData,
              { color: completed ? t.textMuted : t.text, borderColor: completed ? 'transparent' : t.border },
            ]}
          />
        ))}
        <PressableFX
          accessibilityRole="button"
          accessibilityLabel={completed ? `Mark set ${s.sort_order + 1} incomplete` : `Complete set ${s.sort_order + 1}`}
          onPress={onCheck}
          style={[styles.checkButton, { backgroundColor: completed ? t.affirm : t.bgSunken, borderColor: completed ? t.affirm : t.border }]}
        >
          <Icon name="check" size={20} color={completed ? t.bg : t.textFaint} />
        </PressableFX>
      </View>

      {s.planned_json && (
        <Text style={[type.caption, { color: t.textFaint }]}>{plannedText}</Text>
      )}
      {saving && <Text style={[type.caption, { color: t.textFaint }]}>Saving…</Text>}
      {!!error && <Label>{error}</Label>}

      {/* T-IMPL-B E1 — the plain-language effort picker: three answers in
          ordinary words, mapped onto the internal RPE/RIR the progression
          engine reads (the rir rule's input path). The advanced toggle above
          still exposes the numeric fields for those who want them. */}
      {!advanced && s.kind !== 'warmup' && s.kind !== 'cooldown' && (
        <View>
          <Text style={[type.caption, { color: t.textFaint }]}>How hard was that?</Text>
          <Row>
            {EFFORT_PICKS.map((pick) => {
              const selected = draft.current.rpe === pick.rpe
              return (
                <Button
                  key={pick.key}
                  label={pick.label}
                  selected={selected}
                  disabled={saving}
                  onPress={() => {
                    const next: SetValues = { ...draft.current, rpe: pick.rpe, rir: pick.rir }
                    draft.current = next
                    setValues((v) => ({ ...v, rpe: String(pick.rpe), rir: String(pick.rir) }))
                    persist(next, completed)
                  }}
                />
              )
            })}
          </Row>
        </View>
      )}

      {/* Advanced extras (same capability as the old editor, compacted under
          the row): set kind + RIR/RPE/tempo — every label now speaks English
          and carries its one-line explainer (T-IMPL-B E2). */}
      {advanced && (
        <>
          <Row>
            {SetKind.options.map(k => (
              <Button
                key={k}
                label={SET_KIND_LABELS[k]}
                selected={kind === k}
                disabled={saving}
                onPress={() => { setKind(k); persist(draft.current, completed, k) }}
              />
            ))}
          </Row>
          {kind === 'amrap' && (
            <Text style={[type.caption, { color: t.textFaint }]}>{JARGON_HINTS.amrap}</Text>
          )}
          <Row>
            {advancedFields.map(key => (
              <View key={key} style={{ minWidth: 105, flex: 1 }}>
                <Field
                  label={`${labels[key]} set ${s.sort_order + 1}`}
                  hint={JARGON_HINTS[key]}
                  keyboardType={key === 'tempo' ? 'default' : 'decimal-pad'}
                  value={values[key] ?? ''}
                  onChangeText={text => {
                    setValues(v => ({ ...v, [key]: text }))
                    const { valid, value } = canonicalizeFieldValue(key, text, unit)
                    if (!valid) return
                    const next = { ...draft.current, [key]: value }
                    draft.current = next
                    persist(next, completed)
                  }}
                />
              </View>
            ))}
          </Row>
        </>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// The rest chip: persistent countdown, pulse at zero, tap = skip.

function RestChip({
  rest,
  resting,
  onSkip,
  onAdjust,
}: {
  rest: number
  resting: boolean
  onSkip: () => void
  onAdjust: (deltaS: number) => void
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const pulse = useRef(new Animated.Value(1)).current
  const atZero = resting && rest <= 0
  // T-IMPL-B (rest polish): one haptic at the moment the timer lands on zero —
  // the countdown is visible, so the buzz fires ONCE on the transition, not
  // per second while the chip pulses.
  const wasAtZero = useRef(false)
  useEffect(() => {
    if (atZero && !wasAtZero.current) void hapticWarning()
    wasAtZero.current = atZero
  }, [atZero])

  useEffect(() => {
    if (!atZero || reduced) {
      pulse.setValue(1)
      return
    }
    // "Pulses at zero" (Ch. 8.5): a quiet scale loop until the user dismisses.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 600, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: false }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [atZero, reduced, pulse])

  if (!resting) return null

  return (
    <Animated.View
      style={[styles.restChip, { backgroundColor: t.bgElevated, borderColor: t.border, transform: [{ scale: pulse }] }, elevationStyle('medium', t.isDark)]}
    >
      <Icon name="clock" size={16} color={atZero ? t.affirm : t.textMuted} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={atZero ? 'Rest complete — tap to dismiss' : `Skip rest, ${rest} seconds remaining`}
        onPress={onSkip}
        hitSlop={space.xs}
        style={styles.restChipCount}
      >
        <Text style={[type.monoData, { color: atZero ? t.affirm : t.text }]}>{restClockLabel(rest)}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Shorten rest by 15 seconds" onPress={() => onAdjust(-15)} hitSlop={space.sm} style={styles.restChipButton}>
        <Icon name="minus" size={14} color={t.text} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Extend rest by 15 seconds" onPress={() => onAdjust(15)} hitSlop={space.sm} style={styles.restChipButton}>
        <Icon name="plus" size={14} color={t.text} />
      </Pressable>
    </Animated.View>
  )
}

// ---------------------------------------------------------------------------
// Plate calculator as a bottom sheet (Ch. 8.5). Same domain calls as the
// equipment screen (listEquipment + calculatePlates); invoked from the
// exercise menu's Tools group with the last set's load prefilled.

function PlateSheet({ open, onClose, initialTarget }: { open: boolean; onClose: () => void; initialTarget: string }) {
  const t = useTheme()
  const [target, setTarget] = useState(initialTarget)
  const [items, setItems] = useState<Equipment[]>([])
  const [selectedBarId, setSelectedBarId] = useState<number | null>(null)
  const [pair, setPair] = useState(false)

  useEffect(() => {
    if (!open) return
    setTarget(initialTarget)
    void (async () => {
      try {
        const h = await db()
        const list = await listEquipment(h)
        setItems(list)
        const bar = list.find(i => ['barbell', 'ez_bar', 'trap_bar', 'dumbbell'].includes(i.kind))
        setSelectedBarId(bar?.id ?? null)
        setPair(bar?.kind === 'dumbbell')
      } catch {
        // Equipment inventory unreadable: the sheet still opens with the
        // default 20 kg bar assumption (same fallback as the screen).
      }
    })()
  }, [open, initialTarget])

  const bars = items.filter(i => ['barbell', 'dumbbell', 'ez_bar', 'trap_bar'].includes(i.kind))
  const selectedBar = items.find(i => i.id === selectedBarId) ?? bars[0] ?? { weight_kg: 20, count: 1, kind: 'barbell', name: 'Standard Barbell' }
  const plates = items.filter(i => i.kind === 'plate').map(p => ({ weight_kg: p.weight_kg, count: p.count }))

  const targetNum = Number(target)
  let calcResult: { lower: ReturnType<typeof calculatePlates>['lower']; upper: ReturnType<typeof calculatePlates>['upper']; exact: ReturnType<typeof calculatePlates>['exact'] } | null = null
  let calcError = ''
  if (Number.isFinite(targetNum) && targetNum > 0) {
    try {
      calcResult = calculatePlates(targetNum, { weight_kg: selectedBar.weight_kg, count: selectedBar.count }, plates, pair ? 2 : 1)
    } catch (err) {
      calcError = err instanceof Error ? err.message : String(err)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Plate helper" accessibleTitle="Plate calculator">
      <Field label="Target load (kg)" keyboardType="decimal-pad" value={target} onChangeText={setTarget} placeholder="e.g. 80" />
      {bars.length > 0 && (
        <Row>
          {bars.map(b => (
            <Button
              key={b.id}
              label={`${b.name} (${b.weight_kg}kg)`}
              selected={b.id === selectedBarId}
              onPress={() => {
                setSelectedBarId(b.id)
                setPair(b.kind === 'dumbbell')
              }}
            />
          ))}
        </Row>
      )}
      {selectedBar.kind === 'dumbbell' && (
        <Row>
          <Button label={pair ? 'Pair (2 handles)' : 'Single (1 handle)'} selected={pair} onPress={() => setPair(!pair)} />
        </Row>
      )}
      {!!calcError && <Label>{calcError}</Label>}
      {calcResult && (
        <View style={{ gap: space.sm }}>
          {calcResult.exact ? (
            <View style={[styles.plateResult, { backgroundColor: t.affirmTint }]}>
              <Label>Exact match: {calcResult.exact.load_kg} kg</Label>
              <Label muted>Per side: {formatPlates(calcResult.exact.per_side)}</Label>
              <Label muted>Total plates: {calcResult.exact.total_plates}</Label>
            </View>
          ) : (
            <>
              <Label muted>No exact plate combination for {targetNum} kg.</Label>
              {calcResult.lower && (
                <View style={[styles.plateResult, { backgroundColor: t.uncertainTint }]}>
                  <Label>Nearest lower: {calcResult.lower.load_kg} kg ({calcResult.lower.delta_kg} kg)</Label>
                  <Label muted>Per side: {formatPlates(calcResult.lower.per_side)}</Label>
                </View>
              )}
              {calcResult.upper && (
                <View style={[styles.plateResult, { backgroundColor: t.proteinTint }]}>
                  <Label>Nearest upper: {calcResult.upper.load_kg} kg (+{calcResult.upper.delta_kg} kg)</Label>
                  <Label muted>Per side: {formatPlates(calcResult.upper.per_side)}</Label>
                </View>
              )}
            </>
          )}
        </View>
      )}
      <Label muted>Calculated offline from your equipment inventory.</Label>
    </Sheet>
  )
}

function formatPlates(plates: Array<{ weight_kg: number; count: number }>): string {
  if (!plates.length) return 'None (bare bar)'
  return plates.map(p => `${p.count}× ${p.weight_kg}kg`).join(', ')
}

// ---------------------------------------------------------------------------

function SavedText({ label, initial, save }: { label: string; initial: string; save: (v: string) => Promise<void> }) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState('')
  const queue = useRef(Promise.resolve())
  useEffect(() => { setValue(initial) }, [initial])
  return (
    <>
      <Field label={label} value={value} onChangeText={v => { setValue(v); queue.current = queue.current.then(() => save(v)).catch(e => setError(friendlySetValueError(e))) }} />
      {!!error && <Label>{error}</Label>}
    </>
  )
}

const styles = StyleSheet.create({
  circuitGroup: {
    borderRadius: radius.xl,
    padding: space.xs + 2,
    gap: space.xs + 2,
  },
  exerciseCard: {
    padding: space.md,
    gap: space.xs + 2,
    borderRadius: radius.lg,
    borderWidth: 1,
    // Colors resolved at render (theme-aware elevated surface).
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TAP_TARGET,
  },
  overflowButton: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  setRow: {
    borderRadius: radius.md,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 2,
  },
  setRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: MIN_TAP_TARGET,
  },
  cellInput: {
    flex: 1,
    minHeight: MIN_TAP_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
  },
  checkButton: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    borderRadius: radius.pill,
    borderWidth: 1,
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
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
  },
  chipLayer: {
    position: 'absolute',
    bottom: space.xl,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  restChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  restChipCount: { paddingHorizontal: space.xs, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  restChipButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionCard: {
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.sm,
  },
  plateResult: { padding: space.md, borderRadius: radius.md, gap: 4 },
})
