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
import { confirmDialog } from '../src/ui/alert-web'
import { setRoutineEditorDirty } from '../src/ui/editor-dirty'
import { useWebDirtyGuard } from '../src/ui/web-dirty-guard'
import { ChipRow } from '../src/components/ChipRow'
import { Screen, Card, Label, Button, Field, Row, useAction } from '../src/components/Screen'
import { ItemRow } from '../src/components/ItemRow'
import { Empty } from '../src/components/Empty'
import { getFieldLabels } from '../src/data/workout-load'
import { useTheme } from '../src/theme/ThemeProvider'
import { space } from '../src/theme/tokens'

const PROGRESSION_KINDS = ['double', 'fixed', 'percentage', 'rir', 'manual'] as const

/** A11Y P2-10: chips announce human labels, not the engine's raw enums.
    Keyed by the FULL schema kind union — routines loaded from storage can
    carry kind 'program' (the engine leaves progression to the program), and
    the summary line must show a human word, not undefined. The editor's own
    chip row still offers only PROGRESSION_KINDS. */
const PROGRESSION_LABELS: Record<ProgressionRule['kind'], string> = {
  double: 'Double',
  fixed: 'Fixed',
  percentage: 'Percentage',
  rir: 'RIR',
  manual: 'Manual',
  program: 'Program',
}

const SUPERSET_GROUPS = ['none', 'A', 'B', 'C'] as const

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

/**
 * T4-b #5: the editor's dirty fingerprint — exactly the two pieces of state
 * the editor edits. Captured at every editor entry; every exit path compares
 * it against the live state and runs the shared "Discard changes?"
 * confirmDialog when it differs (§8.3: dirty forms warn before destructive
 * exit). Local input DRAFTS (see drafts below) deliberately stay out: an
 * uncommitted draft is not editor data — its invalid text is rejected by
 * design, never silently saved.
 */
function editorFingerprint(name: string, exercises: ReadonlyArray<unknown>): string {
  return JSON.stringify([name, exercises])
}

/** Key-map copy without one key (draft bookkeeping). */
function dropKey(map: Record<string, string>, key: string): Record<string, string> {
  if (!(key in map)) return map
  const next = { ...map }
  delete next[key]
  return next
}

/** Draft keys are prefixed by exercise_id — dropping one exercise's drafts
    must not leave a stale invalid draft blocking Save for the whole form. */
function dropKeysWithPrefix(map: Record<string, string>, prefix: string): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) if (!k.startsWith(prefix)) next[k] = v
  return next
}

/**
 * T4-b #6: parse a planned set-field draft (§8.3 — intermediate text like ""
 * or "1." must never explode into NaN state). "" clears the field (null);
 * anything else must be a finite non-negative number (whole for reps).
 */
function parseSetFieldDraft(key: SetFieldKey, text: string): { value: number | null } | { error: string } {
  if (text.trim() === '') return { value: null }
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0) return { error: 'Enter a number of 0 or more' }
  if (key === 'reps' && !Number.isInteger(n)) return { error: 'Reps must be a whole number' }
  return { value: n }
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

  // T4-b #6: LOCAL input drafts for the planned numeric/tempo fields, keyed
  // `${exercise_id}:${slot}:${field}` so removing an exercise cannot re-point
  // a draft at another row. The input value is `drafts[k] ?? committed`, so
  // the native TextInput ALWAYS shows exactly what the user typed — native
  // text and state can no longer diverge. A draft that parses commits into
  // selectedExercises immediately; an invalid one stays visible with a Field
  // error and blocks Save (nothing silently vanishes at save time).
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [invalidDrafts, setInvalidDrafts] = useState<Record<string, string>>({})

  // T4-b #5: dirty tracking — see editorFingerprint.
  const [baseline, setBaseline] = useState(() => editorFingerprint('', []))
  const dirty = editing && editorFingerprint(name, selectedExercises) !== baseline
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const hasInvalidDrafts = Object.keys(invalidDrafts).length > 0

  // T5-fix2 (review SHOULD-FIX #1): publish the dirty state for the ONE exit
  // outside this screen's tree — notification/deep-link taps route through
  // src/notifications/handler.ts, which consults isRoutineEditorDirty() and
  // runs the same "Discard changes?" confirm before navigating. Same
  // render-body sync as dirtyRef above. The unmount cleanup clears it: a
  // dismissed editor can never leave the flag stuck true (which would block
  // every deep link).
  setRoutineEditorDirty(dirty)
  useEffect(() => () => setRoutineEditorDirty(false), [])

  // P2-15/P3-47 + T4-b #5: reload and tab close get the browser
  // leave-confirmation while the editor holds UNSAVED work (clean editors no
  // longer warn). Browser back cannot be intercepted on expo-router web; see
  // src/ui/web-dirty-guard.ts.
  useWebDirtyGuard(dirty)

  // T4-b #5: the ONE guarded editor exit. Every path that would otherwise
  // silently discard planned-set work (hardware back, header close, Cancel,
  // switching to another routine row) routes through here: clean state exits
  // directly, dirty state gets the shared destructive "Discard changes?"
  // dialog. dirtyRef keeps every handler current between renders.
  const closeEditor = () => {
    setEditing(false)
    initialLoadedRef.current = false
    setDrafts({})
    setInvalidDrafts({})
  }

  const confirmDiscardThen = (next: () => void) => {
    if (!dirtyRef.current) {
      next()
      return
    }
    confirmDialog({
      title: 'Discard changes?',
      message: 'The routine editor has unsaved changes — discarding them cannot be undone.',
      confirmLabel: 'Discard',
      destructive: true,
      onConfirm: next,
    })
  }

  const exitEditor = () => confirmDiscardThen(closeEditor)

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing) {
        confirmDiscardThen(closeEditor)
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
      if (target) openRoutine(target)
    }
  }, [params.id])

  /** Open the editor on an existing routine — the shared entry path for the
      deep link and the list rows; captures the dirty baseline (T4-b #5). */
  const openRoutine = (r: Routine) => {
    setEditId(r.id)
    setName(r.name)
    try {
      const parsed = RoutineInput.parse(JSON.parse(r.definition_json))
      setBaseline(editorFingerprint(r.name, parsed.exercises))
      setSelectedExercises(parsed.exercises)
      setDrafts({})
      setInvalidDrafts({})
      setEditing(true)
    } catch {
      // corrupt definition row: the editor stays closed (unchanged behavior)
    }
  }

  /** Open the editor on a clean slate — the shared entry path for the create
      buttons and the pending-exercises flow; baseline = empty editor. */
  const startCreate = () => {
    setName('')
    setEditId(null)
    setSelectedExercises([])
    setBaseline(editorFingerprint('', []))
    setDrafts({})
    setInvalidDrafts({})
    setEditing(true)
  }

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
          // T4-b #5: a pending-add opens the editor on a CLEAN slate — the
          // baseline is captured BEFORE the adds land, so the added exercises
          // correctly count as unsaved work for the dirty guard.
          startCreate()
          for (const id of pending) {
            await handleAddExercise(id)
          }
        }
      })
    }, [refresh, handleAddExercise]),
  )

  useEffect(() => {
    if (params.addExerciseId) {
      const id = Number(params.addExerciseId)
      if (Number.isInteger(id) && id > 0) {
        if (!dirtyRef.current) setBaseline(editorFingerprint('', []))
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
    if (hasInvalidDrafts) throw new Error('Fix the highlighted planned values before saving.')
    const h = await db()
    await saveRoutine(h, input, editId ?? undefined)
    setEditing(false)
    setEditId(null)
    setName('')
    setSelectedExercises([])
    setDrafts({})
    setInvalidDrafts({})
    initialLoadedRef.current = false
  }

  const handleLaunch = async (id: number) => {
    const h = await db()
    const workoutId = await launchRoutine(h, id, localDate(Date.now()))
    router.push({ pathname: '/workout', params: { id: workoutId } } as never)
  }

  // Task 2-c: the schema-backed planned controls. All commits are pure
  // setSelectedExercises updates — nothing writes until Save (which rides
  // action.run's busy guard), so rapid taps cannot duplicate writes (§8.3).
  // T4-b #6: the handlers write the RAW text into the local draft first (the
  // input shows exactly what the user typed); only PARSED values reach the
  // editor state, and a rejected value shows a Field error + blocks Save
  // instead of silently vanishing between the field and the save.
  const updateSetField = (exId: number, ei: number, si: number, key: SetFieldKey, text: string) => {
    const k = `${exId}:${si}:${key}`
    setDrafts((d) => ({ ...d, [k]: text }))
    const parsed = parseSetFieldDraft(key, text)
    if ('error' in parsed) {
      setInvalidDrafts((v) => ({ ...v, [k]: parsed.error }))
      return
    }
    setInvalidDrafts((v) => dropKey(v, k))
    setSelectedExercises((prev) => prev.map((se, i) => {
      if (i !== ei) return se
      const sets = [...se.sets]
      sets[si] = withSetField(sets[si]!, key, parsed.value)
      return { ...se, sets }
    }))
  }

  const updatePlannedExtra = (ei: number, key: 'rir' | 'rpe' | 'tempo', text: string) => {
    const exId = selectedExercises[ei]?.exercise_id
    if (exId === undefined) return
    const k = `${exId}:extra:${key}`
    setDrafts((d) => ({ ...d, [k]: text }))
    let error: string | null = null
    let value: number | string | null = null
    if (text.trim() !== '') {
      if (key === 'tempo') {
        if (!/^(\d+|X)-(\d+|X)-(\d+|X)-(\d+|X)$/.test(text)) error = 'Use four parts, e.g. 3-1-2-0'
        else value = text
      } else {
        const n = Number(text)
        if (!Number.isFinite(n) || n < 0 || n > 10 || (key === 'rpe' && n < 1)) {
          error = key === 'rpe' ? 'RPE runs 1–10' : 'RIR runs 0–10'
        } else {
          value = n
        }
      }
    }
    if (error !== null) {
      const message = error
      setInvalidDrafts((v) => ({ ...v, [k]: message }))
      return
    }
    setInvalidDrafts((v) => dropKey(v, k))
    setSelectedExercises((prev) => prev.map((se, i) => (
      i !== ei ? se : { ...se, sets: se.sets.map((s) => withPlannedExtra(s, key, value)) }
    )))
  }

  // Rule fields share the same draft discipline; "" never commits — on blur
  // the draft is dropped and the field snaps back to the committed rule value
  // (rules are required, so clearing is a revert, not a silent loss).
  const updateRuleField = (ei: number, key: 'min_reps' | 'max_reps' | 'increment' | 'target_rir', text: string) => {
    const exId = selectedExercises[ei]?.exercise_id
    if (exId === undefined) return
    const k = `${exId}:rule:${key}`
    setDrafts((d) => ({ ...d, [k]: text }))
    if (text.trim() === '') {
      setInvalidDrafts((v) => dropKey(v, k))
      return
    }
    const n = Number(text)
    let error: string | null = null
    if (!Number.isFinite(n)) error = 'Enter a number'
    else if ((key === 'min_reps' || key === 'max_reps') && (!Number.isInteger(n) || n < 1)) error = 'Whole number of 1 or more'
    else if (key === 'increment' && n < 0) error = 'Enter a number of 0 or more'
    else if (key === 'target_rir' && (n < 0 || n > 10)) error = 'RIR runs 0–10'
    if (error !== null) {
      const message = error
      setInvalidDrafts((v) => ({ ...v, [k]: message }))
      return
    }
    setInvalidDrafts((v) => dropKey(v, k))
    setSelectedExercises((prev) => prev.map((se, i) => (
      i !== ei ? se : { ...se, rule: { ...se.rule, [key]: n } }
    )))
  }

  /** T4-b #6 blur: drop the local draft so the field snaps back to the last
      committed value (the result.tsx P2-5 snap pattern). An INVALID draft
      deliberately STAYS in the input with its error and keeps Save blocked —
      a rejected value can no longer silently vanish. */
  const settleDraft = (k: string) => {
    if (drafts[k] === undefined || invalidDrafts[k] !== undefined) return
    setDrafts((d) => dropKey(d, k))
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
    const removed = selectedExercises[index]
    setSelectedExercises(selectedExercises.filter((_, i) => i !== index))
    if (removed) {
      // Drafts are keyed by exercise_id — drop them with the row, or a stale
      // invalid draft could keep blocking Save with no visible field.
      setDrafts((d) => dropKeysWithPrefix(d, `${removed.exercise_id}:`))
      setInvalidDrafts((v) => dropKeysWithPrefix(v, `${removed.exercise_id}:`))
    }
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
    <Screen
      title={editing ? (editId ? 'Edit Routine' : 'New Routine') : 'Routines'}
      back={!editing}
      // T4-b #5: while editing, the header exit is the GUARDED close — the
      // plain chevron hard-routes router.back() inside Screen (its onPress
      // cannot be intercepted) and used to silently discard the editor. The
      // close icon runs the same "Discard changes?" dialog as hardware back
      // and Cancel, with the same outcome (editor closes → list).
      headerActions={editing ? [{ icon: 'close', label: 'Close routine editor', onPress: exitEditor }] : undefined}
    >
      <Label muted>
        A routine is a reusable workout template: pick exercises, plan the sets and progression, then start it any day from the Train tab.
      </Label>
      {action.feedback}

      {!editing && routines.length > 0 && (
        <Button label="Create new routine" selected onPress={startCreate} />
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
            onPress: startCreate,
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
            // A11Y P1-4: every per-exercise control prefixes the exercise
            // name — with N exercises the old labels ("Load (kg) · set 1",
            // "Remove") repeated identically and a screen-reader user could
            // not tell which exercise/set a control belonged to.
            const exName = exInfo?.name ?? `Exercise #${se.exercise_id}`
            // Task 2-c: per-set planned inputs follow the exercise's tracked
            // fields (TRACKING_FIELDS values are always tracked numeric keys).
            const tracked = (exInfo
              ? TRACKING_FIELDS[exInfo.tracking_type]
              : ['load_kg', 'reps']) as readonly SetFieldKey[]
            const fieldLabels = getFieldLabels('kg')
            return (
              <View key={`${se.exercise_id}-${idx}`} style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: t.rowRaised }}>
                <Row>
                  <Label>{exName}</Label>
                  <Button label={`Remove ${exName}`} onPress={() => handleRemoveExercise(idx)} />
                </Row>
                <Label muted>{se.sets.length} planned sets · Progression: {PROGRESSION_LABELS[se.rule.kind]}</Label>

                <Label muted>Progression Rule:</Label>
                {/* A11Y P2-10: the sanctioned ChipRow primitive replaces the
                    hand-rolled Button row — human chip labels instead of raw
                    engine enums, per-chip a11y labels carrying the exercise
                    name, radiogroup semantics around the row. */}
                <View accessibilityRole="radiogroup" accessibilityLabel={`${exName} — progression rule`}>
                  <ChipRow
                    items={PROGRESSION_KINDS}
                    keyOf={(k) => k}
                    label={(k) => PROGRESSION_LABELS[k]}
                    a11yLabel={(k) => `${exName} — progression ${PROGRESSION_LABELS[k]}`}
                    isActive={(k) => se.rule.kind === k}
                    onPress={(k) => {
                      const next = [...selectedExercises]
                      next[idx] = { ...se, rule: { ...se.rule, kind: k } }
                      setSelectedExercises(next)
                    }}
                  />
                </View>

                {se.rule.kind === 'double' && (
                  <Row>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={`${exName} — Min Reps`}
                        keyboardType="number-pad"
                        error={invalidDrafts[`${se.exercise_id}:rule:min_reps`]}
                        value={drafts[`${se.exercise_id}:rule:min_reps`] ?? String(se.rule.min_reps)}
                        onChangeText={(t) => updateRuleField(idx, 'min_reps', t)}
                        onBlur={() => settleDraft(`${se.exercise_id}:rule:min_reps`)}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={`${exName} — Max Reps`}
                        keyboardType="number-pad"
                        error={invalidDrafts[`${se.exercise_id}:rule:max_reps`]}
                        value={drafts[`${se.exercise_id}:rule:max_reps`] ?? String(se.rule.max_reps)}
                        onChangeText={(t) => updateRuleField(idx, 'max_reps', t)}
                        onBlur={() => settleDraft(`${se.exercise_id}:rule:max_reps`)}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label={`${exName} — Increment (kg)`}
                        keyboardType="decimal-pad"
                        error={invalidDrafts[`${se.exercise_id}:rule:increment`]}
                        value={drafts[`${se.exercise_id}:rule:increment`] ?? String(se.rule.increment)}
                        onChangeText={(t) => updateRuleField(idx, 'increment', t)}
                        onBlur={() => settleDraft(`${se.exercise_id}:rule:increment`)}
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
                        label={`${exName} — ${se.rule.kind === 'percentage' ? 'Increment (%)' : 'Increment (kg)'}`}
                        keyboardType="decimal-pad"
                        error={invalidDrafts[`${se.exercise_id}:rule:increment`]}
                        value={drafts[`${se.exercise_id}:rule:increment`] ?? String(se.rule.increment)}
                        onChangeText={(text) => updateRuleField(idx, 'increment', text)}
                        onBlur={() => settleDraft(`${se.exercise_id}:rule:increment`)}
                      />
                    </View>
                    {se.rule.kind === 'rir' && (
                      <View style={{ flex: 1 }}>
                        <Field
                          label={`${exName} — Target RIR (0-10)`}
                          keyboardType="decimal-pad"
                          error={invalidDrafts[`${se.exercise_id}:rule:target_rir`]}
                          value={drafts[`${se.exercise_id}:rule:target_rir`] ?? String(se.rule.target_rir)}
                          onChangeText={(text) => updateRuleField(idx, 'target_rir', text)}
                          onBlur={() => settleDraft(`${se.exercise_id}:rule:target_rir`)}
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
                        label={`${exName} — Planned ${fieldLabels[key]}`}
                        keyboardType="decimal-pad"
                        error={invalidDrafts[`${se.exercise_id}:extra:${key}`]}
                        value={drafts[`${se.exercise_id}:extra:${key}`] ?? (se.sets[0]?.[key] == null ? '' : String(se.sets[0]![key]))}
                        onChangeText={(text) => updatePlannedExtra(idx, key, text)}
                        onBlur={() => settleDraft(`${se.exercise_id}:extra:${key}`)}
                      />
                    </View>
                  ))}
                  <View style={{ flex: 1, minWidth: 130 }}>
                    <Field
                      label={`${exName} — Planned tempo (e.g. 3-1-2-0)`}
                      error={invalidDrafts[`${se.exercise_id}:extra:tempo`]}
                      value={drafts[`${se.exercise_id}:extra:tempo`] ?? (se.sets[0]?.tempo ?? '')}
                      onChangeText={(text) => updatePlannedExtra(idx, 'tempo', text)}
                      onBlur={() => settleDraft(`${se.exercise_id}:extra:tempo`)}
                    />
                  </View>
                </Row>

                {/* Task 2-c: superset grouping (exercises[].group →
                    superset_group_id at launch). Consecutive same-group
                    exercises launch linked as a circuit. */}
                <Label muted>Superset group:</Label>
                {/* A11Y P2-10: same ChipRow dialect as the progression row —
                    "None" instead of the raw "none" enum, per-chip a11y
                    labels carrying the exercise name, radiogroup context. */}
                <View accessibilityRole="radiogroup" accessibilityLabel={`${exName} — superset group`}>
                  <ChipRow
                    items={SUPERSET_GROUPS}
                    keyOf={(g) => g}
                    label={(g) => (g === 'none' ? 'None' : g)}
                    a11yLabel={(g) => `${exName} — superset ${g === 'none' ? 'none' : `group ${g}`}`}
                    isActive={(g) => (se.group ?? 'none') === g}
                    onPress={(g) => updateSupersetGroup(idx, g === 'none' ? null : g)}
                  />
                </View>
                {se.group ? <Label muted>Consecutive exercises sharing a group launch linked as a circuit.</Label> : null}

                {/* Task 2-c: planned values per set (RoutineInput.sets[]). */}
                {se.sets.map((set, si) => (
                  <Row key={si}>
                    {tracked.map((key) => (
                      <View key={key} style={{ flex: 1, minWidth: 90 }}>
                        <Field
                          label={`${exName} — ${fieldLabels[key]} · set ${si + 1}`}
                          keyboardType="decimal-pad"
                          error={invalidDrafts[`${se.exercise_id}:${si}:${key}`]}
                          value={drafts[`${se.exercise_id}:${si}:${key}`] ?? (set[key] == null ? '' : String(set[key]))}
                          onChangeText={(text) => updateSetField(se.exercise_id, idx, si, key, text)}
                          onBlur={() => settleDraft(`${se.exercise_id}:${si}:${key}`)}
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
            <Button label="Save routine" selected disabled={action.busy || hasInvalidDrafts} onPress={() => void action.run(handleSave)} />
            <Button label="Cancel" onPress={exitEditor} />
          </Row>
          {hasInvalidDrafts && (
            // T4-b #6: the invalid drafts stay visible (Field error slot) and
            // Save stays blocked until they parse or are cleared — a rejected
            // value can never silently vanish at save time (§8.3).
            <Label muted>Fix the highlighted planned values — they are not saved until they parse.</Label>
          )}
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
              // T4-b #5: switching rows while the editor holds unsaved work is
              // a silent discard — guarded like every other exit path.
              onPress={() => confirmDiscardThen(() => openRoutine(r))}
              accessibilityLabel={`Edit routine ${r.name}`}
            />
            <Row>
              {/* T5-fix2 (review SHOULD-FIX #1): Launch navigates away while the
                  saved rows stay interactive BELOW the live editor — unguarded,
                  it discarded dirty editor work exactly like every other exit
                  path (§8.3). Clean state (editor closed or untouched) launches
                  directly; only an actually-dirty editor gets the confirm. */}
              <Button
                label="Launch workout"
                selected
                onPress={() => confirmDiscardThen(() => void action.run(() => handleLaunch(r.id)))}
              />
              <Button label="Edit" onPress={() => confirmDiscardThen(() => openRoutine(r))} />
              <Button
                label="Delete"
                onPress={() =>
                  // T4-b #1: destructive confirmation via the ONE shared
                  // helper (the peer pattern: meal-detail, settings-data,
                  // backup restore). This soft delete has no undo, so the
                  // message must not promise one.
                  confirmDialog({
                    title: 'Delete this routine?',
                    message: 'The routine is removed from the Train tab and from programs that schedule it. Workouts you already logged are not affected.',
                    confirmLabel: 'Delete',
                    destructive: true,
                    onConfirm: () => void action.run(() => handleDeleteRoutine(r.id)),
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
