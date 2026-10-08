import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, View } from 'react-native'
import { RoutineInput, TRACKING_FIELDS, type ProgressionRule, type SetValues, type RoutineInput as RoutineInputType } from '@nutai/core-schema'
import {
  listRoutines,
  saveRoutine,
  launchRoutine,
  listExercises,
  getExercise,
  performanceHistory,
  defaultSetsFor,
  typeDefaultSets,
  deleteRoutine,
  type Routine,
  type Exercise,
} from '@nutai/training'
import type { WeightUnit } from '@nutai/analytics'
import { db, localDate } from '../src/data/repo'
import { consumePendingRoutineExercises } from '../src/data/routine-draft'
import { readWeightUnit } from '../src/data/weight-units'
import { confirmDialog } from '../src/ui/alert-web'
import { setRoutineEditorDirty } from '../src/ui/editor-dirty'
import { useWebDirtyGuard } from '../src/ui/web-dirty-guard'
import { ChipRow } from '../src/components/ChipRow'
import { Screen, Card, Label, Button, Field, Row, useAction } from '../src/components/Screen'
import { ItemRow } from '../src/components/ItemRow'
import { Empty } from '../src/components/Empty'
import { Sheet } from '../src/components/Sheet'
import {
  JARGON_HINTS,
  PROGRESSION_KIND_HINTS,
  PROGRESSION_KIND_LABELS,
  canonicalizeFieldValue,
  formatLoadForDisplay,
  getFieldLabels,
} from '../src/data/workout-load'
import { useTheme } from '../src/theme/ThemeProvider'
import { space } from '../src/theme/tokens'

const PROGRESSION_KINDS = ['double', 'fixed', 'percentage', 'rir', 'manual'] as const

const SUPERSET_GROUPS = ['none', 'A', 'B', 'C'] as const

/** The SetValues fields one planned-set row edits (the tracked numeric keys). */
type SetFieldKey = 'load_kg' | 'reps' | 'duration_s' | 'distance_m' | 'assistance_kg'

/**
 * One editor block. `uid` is a LOCAL instance id: it keys React reconciliation
 * across reorder/duplicate and namespaces the input drafts
 * (`${exercise_id}:u${uid}:…`), so a DUPLICATED block no longer fights its
 * original over the same draft keys. It is stripped before save and ignored
 * by the dirty fingerprint — stored routines never see it.
 */
type EditorBlock = {
  uid: number
  exercise_id: number
  group: string | null
  sets: SetValues[]
  rule: ProgressionRule
  rest_seconds: number | null
}

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
 * the editor edits (local `uid`s zeroed: they are view bookkeeping, never
 * stored data). Captured at every editor entry; every exit path compares it
 * against the live state and runs the shared "Discard changes?" confirmDialog
 * when it differs (§8.3: dirty forms warn before destructive exit). Local
 * input DRAFTS (see drafts below) deliberately stay out: an uncommitted draft
 * is not editor data — its invalid text is rejected by design, never silently
 * saved.
 */
function editorFingerprint(name: string, exercises: ReadonlyArray<unknown>): string {
  return JSON.stringify([name, exercises.map((e) => ({ ...(e as object), uid: 0 }))])
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

/** Draft fingerprint for ONE block — the memo comparator of the editor row
    (PERF mandate): a keystroke in another block's field re-renders nothing
    here. Only that block's draft keys participate. */
function blockDraftFingerprint(map: Record<string, string>, prefix: string): string {
  let out = ''
  for (const k in map) if (k.startsWith(prefix)) out += `${k}=${map[k]};`
  return out
}

/**
 * Task 12-b M2: the pure core of the pending-exercise merge (the one
 * setSelectedExercises update inside handleAddExercise, so BOTH editor
 * entries — create and edit — share it). Appends a picker id only when it is
 * not already in the editor (dedupe); a duplicate returns the SAME array (no
 * re-render churn — the T1-b lesson); existing rows pass through by
 * reference, and the planned-set draft maps live OUTSIDE this array, so a
 * merge can never disturb an in-progress edit's planned values.
 */
function withPendingExercise<T extends { exercise_id: number }>(
  prev: Array<T>,
  exerciseId: number,
  addRow: () => T,
): Array<T> {
  if (prev.some((se) => se.exercise_id === exerciseId)) return prev
  return [...prev, addRow()]
}

/**
 * T4-b #6: parse a planned set-field draft (§8.3 — intermediate text like ""
 * or "1." must never explode into NaN state). "" clears the field (null);
 * anything else must be a finite non-negative number (whole for reps).
 * T-IMPL-B C: load/assistance drafts are typed in the USER'S unit — the same
 * canonicalizeFieldValue conversion the live workout screen uses (storage
 * stays kg; display/entry conversion only). kg (the default) is identity, so
 * the parser contract is unchanged for kg users and tests.
 */
function parseSetFieldDraft(key: SetFieldKey, text: string, unit: WeightUnit = 'kg'): { value: number | null } | { error: string } {
  if (text.trim() === '') return { value: null }
  const { valid, value } = canonicalizeFieldValue(key, text, unit)
  if (!valid || typeof value !== 'number') return { error: 'Enter a number of 0 or more' }
  if (key === 'reps' && !Number.isInteger(value)) return { error: 'Reps must be a whole number' }
  return { value }
}

/** Committed-value display in the user's unit (T-IMPL-B C) — kg storage,
    converted readout, exactly like the live screen's previous column. */
function displaySetField(key: SetFieldKey, value: number | null, unit: WeightUnit): string {
  if (value == null) return ''
  return key === 'load_kg' || key === 'assistance_kg' ? formatLoadForDisplay(value, unit) : String(value)
}

export default function RoutinesScreen() {
  const params = useLocalSearchParams<{ id?: string; addExerciseId?: string }>()
  const [routines, setRoutines] = useState<Routine[]>([])
  const [routineCounts, setRoutineCounts] = useState<Record<number, number>>({})
  const [exercises, setExercises] = useState<Exercise[]>([])
  // T-IMPL-B C: the profile unit — labels and input conversion follow it the
  // same way the live workout screen does (readWeightUnit); storage stays kg.
  const [unit, setUnit] = useState<WeightUnit>('kg')

  // Creation/Edit mode
  const [editing, setEditing] = useState(false)
  const [editId, setEditId] = useState<number | null>(params.id ? Number(params.id) : null)
  const [name, setName] = useState('')
  const [selectedExercises, setSelectedExercises] = useState<EditorBlock[]>([])
  const initialLoadedRef = useRef(false)

  // T-IMPL-B B3/T11: local block instance ids + the collapsed set.
  const uidRef = useRef(1)
  const nextUid = () => uidRef.current++
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  // T4-b #6: LOCAL input drafts for the planned numeric/tempo fields, keyed
  // `${exercise_id}:u${uid}:${slot}:${field}` so removing an exercise cannot
  // re-point a draft at another row and duplicated instances stay
  // independent. The input value is `drafts[k] ?? committed`, so the native
  // TextInput ALWAYS shows exactly what the user typed — native text and
  // state can no longer diverge. A draft that parses commits into
  // selectedExercises immediately; an invalid one stays visible with a Field
  // error and blocks Save (nothing silently vanishes at save time).
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [invalidDrafts, setInvalidDrafts] = useState<Record<string, string>>({})

  // T-IMPL-B B1: the in-editor exercise picker sheet (no more
  // leave-the-editor round-trip through the generic search screen).
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerMuscle, setPickerMuscle] = useState('')
  const [pickerEquipment, setPickerEquipment] = useState('')
  const [pickerRecents, setPickerRecents] = useState<number[]>([])

  // T4-b #5: dirty tracking — see editorFingerprint.
  const [baseline, setBaseline] = useState(() => editorFingerprint('', []))
  const dirty = editing && editorFingerprint(name, selectedExercises) !== baseline
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  // Task 12-b M2: the focus effect must know the editor's mode without
  // depending on it (state deps here would re-fire the effect mid-focus — the
  // T1-b jitter class the locks forbid). Same render-body sync as dirtyRef.
  const editModeRef = useRef({ editing: false, editId: null as number | null })
  editModeRef.current = { editing, editId }
  // Render-synced refs: the memoized editor rows' handlers read THESE instead
  // of closing over state, so their behavior can never go stale even though
  // the memo comparator ignores their identities.
  const blocksRef = useRef(selectedExercises)
  blocksRef.current = selectedExercises
  const unitRef = useRef(unit)
  unitRef.current = unit
  const invalidRef = useRef(invalidDrafts)
  invalidRef.current = invalidDrafts
  const exercisesRef = useRef(exercises)
  exercisesRef.current = exercises
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
    setCollapsed(new Set())
    setPickerOpen(false)
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
    const [rList, eList, nextUnit] = await Promise.all([listRoutines(h), listExercises(h), readWeightUnit(h)])
    // T1-b: setState only when the rows actually changed — a refired refresh
    // (focus re-run, useAction's trailing refresh) no longer re-renders the
    // whole list with fresh array identities.
    const rFp = rowsFingerprint(rList)
    const eFp = rowsFingerprint(eList)
    if (rFp !== rowsRef.current.routines) {
      rowsRef.current.routines = rFp
      setRoutines(rList)
      // PERF mandate: the saved-list exercise counts parse ONCE per load into
      // state, never JSON.parse inside the render loop.
      const counts: Record<number, number> = {}
      for (const r of rList) {
        try {
          counts[r.id] = RoutineInput.parse(JSON.parse(r.definition_json)).exercises.length
        } catch {
          counts[r.id] = 0
        }
      }
      setRoutineCounts(counts)
    }
    if (eFp !== rowsRef.current.exercises) {
      rowsRef.current.exercises = eFp
      setExercises(eList)
    }
    setUnit(nextUnit)

    if (params.id && !initialLoadedRef.current) {
      initialLoadedRef.current = true
      const target = rList.find((r) => r.id === Number(params.id))
      if (target) openRoutine(target)
    }
  }, [params.id])

  /** Open the editor on an existing routine — the shared entry path for the
      deep link and the list rows; captures the dirty baseline (T4-b #5).
      T-IMPL-B T11: blocks start collapsed when there are many — the
      15-controls-per-exercise wall the owner reported becomes name + summary
      rows, one tap to expand. */
  const openRoutine = (r: Routine) => {
    setEditId(r.id)
    setName(r.name)
    try {
      const parsed = RoutineInput.parse(JSON.parse(r.definition_json))
      const withUids: EditorBlock[] = parsed.exercises.map((e) => ({ ...e, uid: nextUid(), rest_seconds: e.rest_seconds ?? null }))
      setBaseline(editorFingerprint(r.name, withUids))
      setSelectedExercises(withUids)
      setCollapsed(withUids.length > 3 ? new Set(withUids.map((b) => b.uid)) : new Set())
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
    setCollapsed(new Set())
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

      const defaultRule: ProgressionRule = {
        kind: 'double',
        increment: 2.5,
        min_reps: 8,
        max_reps: 12,
        target_rir: 2,
      }

      // T-IMPL-B B2: the 20 kg × 10 table lives in ONE shared helper
      // (@nutai/training defaultSetsFor) — a new block seeds from the user's
      // LAST completed session of the exercise, falling back to the type
      // table only when it was never logged.
      const history = await performanceHistory(h)
      const sets = defaultSetsFor(ex, history)
      const uid = uidRef.current++
      setSelectedExercises((prev) => withPendingExercise(prev, exerciseId, () => ({
        uid,
        exercise_id: exerciseId,
        group: null,
        sets,
        rule: defaultRule,
        rest_seconds: null,
      })))
      // A just-added block expands so its seeded values are visible at once.
      setCollapsed((prev) => {
        const next = new Set(prev)
        next.delete(uid)
        return next
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
          if (editModeRef.current.editing && editModeRef.current.editId != null) {
            // Task 12-b M2: returning from the multi-select picker while the
            // editor is open on an EXISTING routine must MERGE the picks —
            // the clean-slate startCreate reset here used to wipe the loaded
            // routine, its planned-set drafts and editId, so Save created a
            // NEW routine instead of updating. handleAddExercise appends only
            // NEW unique ids (see withPendingExercise) and never touches
            // drafts or the baseline, so existing rows + planned values
            // survive and the appended rows read as unsaved work for every
            // dirty guard (§8.3).
            for (const id of pending) {
              await handleAddExercise(id)
            }
          } else {
            // T4-b #5: a pending-add opens the editor on a CLEAN slate — the
            // baseline is captured BEFORE the adds land, so the added exercises
            // correctly count as unsaved work for the dirty guard.
            startCreate()
            for (const id of pending) {
              await handleAddExercise(id)
            }
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
      exercises: selectedExercises.map(({ uid: _uid, ...rest }) => rest),
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
    setCollapsed(new Set())
    initialLoadedRef.current = false
  }

  const handleLaunch = async (id: number) => {
    const h = await db()
    const workoutId = await launchRoutine(h, id, localDate(Date.now()))
    router.push({ pathname: '/workout', params: { id: workoutId } } as never)
  }

  // ------------------------------------------------------------------
  // Editor mutations — every one is closure-safe (render-synced refs +
  // functional state updates only), which is what lets the memoized editor
  // row below skip re-renders without ever going stale.

  // Task 2-c: the schema-backed planned controls. All commits are pure
  // setSelectedExercises updates — nothing writes until Save (which rides
  // action.run's busy guard), so rapid taps cannot duplicate writes (§8.3).
  // T4-b #6: the handlers write the RAW text into the local draft first (the
  // input shows exactly what the user typed); only PARSED values reach the
  // editor state, and a rejected value shows a Field error + blocks Save
  // instead of silently vanishing between the field and the save.
  const updateSetField = (exKey: string, uid: number, si: number, key: SetFieldKey, text: string) => {
    const k = `${exKey}:${si}:${key}`
    setDrafts((d) => ({ ...d, [k]: text }))
    const parsed = parseSetFieldDraft(key, text, unitRef.current)
    if ('error' in parsed) {
      setInvalidDrafts((v) => ({ ...v, [k]: parsed.error }))
      return
    }
    setInvalidDrafts((v) => dropKey(v, k))
    setSelectedExercises((prev) => prev.map((se) => {
      if (se.uid !== uid) return se
      const sets = [...se.sets]
      sets[si] = withSetField(sets[si]!, key, parsed.value)
      return { ...se, sets }
    }))
  }

  const updatePlannedExtra = (exKey: string, uid: number, key: 'rir' | 'rpe' | 'tempo', text: string) => {
    const k = `${exKey}:extra:${key}`
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
    setSelectedExercises((prev) => prev.map((se) => (
      se.uid !== uid ? se : { ...se, sets: se.sets.map((s) => withPlannedExtra(s, key, value)) }
    )))
  }

  // T-IMPL-B I: the per-exercise rest default the live session honours.
  const updateRestSeconds = (exKey: string, uid: number, text: string) => {
    const k = `${exKey}:extra:rest`
    setDrafts((d) => ({ ...d, [k]: text }))
    let error: string | null = null
    let value: number | null = null
    if (text.trim() !== '') {
      const n = Number(text)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 600) error = 'Rest runs 0–600 seconds'
      else value = n
    }
    if (error !== null) {
      const message = error
      setInvalidDrafts((v) => ({ ...v, [k]: message }))
      return
    }
    setInvalidDrafts((v) => dropKey(v, k))
    setSelectedExercises((prev) => prev.map((se) => (se.uid !== uid ? se : { ...se, rest_seconds: value })))
  }

  // Rule fields share the same draft discipline; "" never commits — on blur
  // the draft is dropped and the field snaps back to the committed rule value
  // (rules are required, so clearing is a revert, not a silent loss).
  const updateRuleField = (exKey: string, uid: number, key: 'min_reps' | 'max_reps' | 'increment' | 'target_rir', text: string) => {
    const k = `${exKey}:rule:${key}`
    setDrafts((d) => ({ ...d, [k]: text }))
    if (text.trim() === '') {
      setInvalidDrafts((v) => dropKey(v, k))
      return
    }
    // T-IMPL-B C: the increment is a kg-stored value typed in the user's unit
    // (percentage increments stay raw numbers) — same conversion as the live
    // screen.
    let n: number | null = null
    let error: string | null = null
    if (key === 'increment') {
      const isPercent = blocksRef.current.find((b) => b.uid === uid)?.rule.kind === 'percentage'
      if (isPercent) {
        const parsed = Number(text)
        if (!Number.isFinite(parsed) || parsed < 0) error = 'Enter a number of 0 or more'
        else n = parsed
      } else {
        const parsed = canonicalizeFieldValue('load_kg', text, unitRef.current)
        if (!parsed.valid || typeof parsed.value !== 'number') error = 'Enter a number of 0 or more'
        else n = parsed.value
      }
    } else {
      const parsed = Number(text)
      if (!Number.isFinite(parsed)) error = 'Enter a number'
      else if ((key === 'min_reps' || key === 'max_reps') && (!Number.isInteger(parsed) || parsed < 1)) error = 'Whole number of 1 or more'
      else if (key === 'target_rir' && (parsed < 0 || parsed > 10)) error = 'RIR runs 0–10'
      else n = parsed
    }
    if (error !== null || n === null) {
      const message = error ?? 'Enter a number'
      setInvalidDrafts((v) => ({ ...v, [k]: message }))
      return
    }
    setInvalidDrafts((v) => dropKey(v, k))
    setSelectedExercises((prev) => prev.map((se) => (
      se.uid !== uid ? se : { ...se, rule: { ...se.rule, [key]: n } }
    )))
  }

  /** T4-b #6 blur: drop the local draft so the field snaps back to the last
      committed value (the result.tsx P2-5 snap pattern). An INVALID draft
      deliberately STAYS in the input with its error and keeps Save blocked —
      a rejected value can no longer silently vanish. Reads the invalid map
      through its render-synced ref, so the memoized rows can hold any
      identity of this helper without going stale. */
  const settleDraft = (k: string) => {
    if (invalidRef.current[k] !== undefined) return
    setDrafts((d) => (d[k] === undefined ? d : dropKey(d, k)))
  }

  const updateSupersetGroup = (uid: number, group: string | null) => {
    setSelectedExercises((prev) => prev.map((se) => (se.uid !== uid ? se : { ...se, group })))
  }

  // T-IMPL-B A4: kind chips named by outcome — the switch itself stays a pure
  // state update (values like increment/target_rir carry over untouched).
  const updateRuleKind = (uid: number, kind: ProgressionRule['kind']) => {
    setSelectedExercises((prev) => prev.map((se) => (se.uid !== uid ? se : { ...se, rule: { ...se.rule, kind } })))
  }

  const handleAddSet = (index: number) => {
    setSelectedExercises((prev) => {
      const current = prev[index]
      if (!current) return prev
      const lastSet = current.sets[current.sets.length - 1] ?? typeDefaultSets(
        exercisesRef.current.find((e) => e.id === current.exercise_id)?.tracking_type ?? 'weight_reps',
      )[0]!
      const next = [...prev]
      next[index] = { ...current, sets: [...current.sets, { ...lastSet }] }
      return next
    })
  }

  const handleMoveBlock = (uid: number, delta: number) => {
    setSelectedExercises((prev) => {
      const index = prev.findIndex((b) => b.uid === uid)
      const target = index + delta
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const moved = next.splice(index, 1)[0]!
      next.splice(target, 0, moved)
      return next
    })
  }

  const handleDuplicateBlock = (uid: number) => {
    const newUid = uidRef.current++
    setSelectedExercises((prev) => {
      const index = prev.findIndex((b) => b.uid === uid)
      if (index < 0) return prev
      const source = prev[index]!
      const copy: EditorBlock = { ...source, sets: source.sets.map((s) => ({ ...s })), uid: newUid }
      const next = [...prev]
      next.splice(index + 1, 0, copy)
      return next
    })
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(newUid)
      return next
    })
  }

  const handleRemoveExercise = (index: number) => {
    const removed = blocksRef.current[index]
    setSelectedExercises((prev) => prev.filter((_, i) => i !== index))
    if (removed) {
      // Drafts are keyed by exercise_id — drop them with the row (and with
      // any duplicate of the same exercise), or a stale invalid draft could
      // keep blocking Save with no visible field.
      setDrafts((d) => dropKeysWithPrefix(d, `${removed.exercise_id}:`))
      setInvalidDrafts((v) => dropKeysWithPrefix(v, `${removed.exercise_id}:`))
    }
  }

  const toggleCollapse = (uid: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const handleDeleteRoutine = async (id: number) => {
    // T-IMPL-B D: the engine cascade (packages/training deleteRoutine) strips
    // the routine from every program schedule in the same undoable action —
    // the dialog's promise is now true, and Train can no longer render a
    // "Today: Routine" card whose launch throws 'Routine not found'.
    const h = await db()
    await deleteRoutine(h, id)
    await refresh()
  }

  // ------------------------------------------------------------------
  // The in-editor exercise picker (T-IMPL-B B1): recents rail + search +
  // muscle/equipment chips, in a Sheet — the editor keeps its place, drafts
  // and dirty state while exercises land. The generic /search screen keeps
  // its other consumers.
  const openPicker = async () => {
    setPickerQuery('')
    setPickerMuscle('')
    setPickerEquipment('')
    setPickerOpen(true)
    try {
      const h = await db()
      const perf = await performanceHistory(h)
      const latestAt = new Map<number, number>()
      for (const row of perf) {
        const prevAt = latestAt.get(row.exercise_id) ?? 0
        if (row.at > prevAt) latestAt.set(row.exercise_id, row.at)
      }
      setPickerRecents([...latestAt.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id))
    } catch {
      setPickerRecents([])
    }
  }

  const muscleOptions = useMemo(
    () => [...new Set(exercises.flatMap((e) => e.primary_muscles))].sort().slice(0, 16),
    [exercises],
  )
  const equipmentOptions = useMemo(
    () => [...new Set(exercises.flatMap((e) => e.equipment))].sort().slice(0, 16),
    [exercises],
  )
  const recentsExercises = useMemo(
    () => pickerRecents.map((id) => exercises.find((e) => e.id === id)).filter((e): e is Exercise => !!e).slice(0, 8),
    [pickerRecents, exercises],
  )
  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    return exercises
      .filter((e) => (pickerMuscle ? e.primary_muscles.includes(pickerMuscle) : true))
      .filter((e) => (pickerEquipment ? e.equipment.includes(pickerEquipment) : true))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q)) : true))
      .slice(0, 30)
  }, [exercises, pickerQuery, pickerMuscle, pickerEquipment])

  return (
    <View style={{ flex: 1 }}>
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
            {selectedExercises.map((se, idx) => (
              <RoutineBlock
                key={se.uid}
                se={se}
                index={idx}
                isFirst={idx === 0}
                isLast={idx === selectedExercises.length - 1}
                unit={unit}
                drafts={drafts}
                invalidDrafts={invalidDrafts}
                exercises={exercises}
                collapsed={collapsed.has(se.uid)}
                onToggleCollapse={toggleCollapse}
                onMove={handleMoveBlock}
                onDuplicate={handleDuplicateBlock}
                onRemove={handleRemoveExercise}
                onAddSet={handleAddSet}
                onUpdateSetField={updateSetField}
                onUpdatePlannedExtra={updatePlannedExtra}
                onUpdateRestSeconds={updateRestSeconds}
                onUpdateRuleField={updateRuleField}
                onSettleDraft={settleDraft}
                onUpdateSupersetGroup={updateSupersetGroup}
                onUpdateRuleKind={updateRuleKind}
              />
            ))}

            <Button
              label="+ Add exercises"
              selected
              onPress={() => void action.run(openPicker)}
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
          // PERF: counts parsed once per load in refresh() — never JSON.parse
          // inside this render loop.
          const count = routineCounts[r.id] ?? 0
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

      {/* The in-editor exercise picker sheet (T-IMPL-B B1). */}
      <Sheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add exercises"
        accessibleTitle="Add exercises to the routine"
      >
        {!pickerQuery && recentsExercises.length > 0 && (
          <>
            <Label muted>Recent</Label>
            <View accessibilityRole="radiogroup" accessibilityLabel="Recently performed exercises">
              <ChipRow
                items={recentsExercises}
                keyOf={(e) => String(e.id)}
                label={(e) => e.name}
                a11yLabel={(e) => `Add recent exercise ${e.name}`}
                isActive={() => false}
                onPress={(e) => void handleAddExercise(e.id)}
              />
            </View>
          </>
        )}
        <Field label="Search exercises or aliases" value={pickerQuery} onChangeText={setPickerQuery} autoCorrect={false} />
        {muscleOptions.length > 0 && (
          <>
            <Label muted>Muscle</Label>
            <View accessibilityRole="radiogroup" accessibilityLabel="Filter by muscle">
              <ChipRow
                items={muscleOptions}
                keyOf={(m) => m}
                label={(m) => m}
                a11yLabel={(m) => `Filter muscle ${m}`}
                isActive={(m) => m === pickerMuscle}
                onPress={(m) => setPickerMuscle((cur) => (cur === m ? '' : m))}
              />
            </View>
          </>
        )}
        {equipmentOptions.length > 0 && (
          <>
            <Label muted>Equipment</Label>
            <View accessibilityRole="radiogroup" accessibilityLabel="Filter by equipment">
              <ChipRow
                items={equipmentOptions}
                keyOf={(eq) => eq}
                label={(eq) => eq}
                a11yLabel={(eq) => `Filter equipment ${eq}`}
                isActive={(eq) => eq === pickerEquipment}
                onPress={(eq) => setPickerEquipment((cur) => (cur === eq ? '' : eq))}
              />
            </View>
          </>
        )}
        <Label muted>
          {pickerResults.length} exercise{pickerResults.length === 1 ? '' : 's'} available
        </Label>
        {pickerResults.map((e) => {
          const added = selectedExercises.some((se) => se.exercise_id === e.id)
          return (
            <ItemRow
              key={e.id}
              icon="dumbbell"
              label={e.name}
              value={`${e.primary_muscles.join(', ')} · ${e.equipment.join(', ') || 'bodyweight'}${added ? ' · added' : ''}`}
              onPress={() => void handleAddExercise(e.id)}
              accessibilityLabel={`Add exercise ${e.name}`}
            />
          )
        })}
        {!pickerResults.length && <Label muted>No matching exercise. Adjust the filters, or create a custom one from the Train tab's Exercise library.</Label>}
        <Button label="Done" selected onPress={() => setPickerOpen(false)} />
      </Sheet>
    </View>
  )
}

// ---------------------------------------------------------------------------
// One editor block, memoized (PERF mandate): a keystroke in another block's
// field re-renders nothing here. The comparator checks the block object
// identity, its OWN drafts/invalid-drafts (fingerprinted by key prefix), the
// unit and the collapse flag. Every callback the block receives is
// closure-safe by construction (render-synced refs + functional state
// updates), so ignoring their identity in the comparator can never serve
// stale state.
const RoutineBlock = memo(function RoutineBlock({
  se,
  index,
  isFirst,
  isLast,
  unit,
  drafts,
  invalidDrafts,
  exercises,
  collapsed,
  onToggleCollapse,
  onMove,
  onDuplicate,
  onRemove,
  onAddSet,
  onUpdateSetField,
  onUpdatePlannedExtra,
  onUpdateRestSeconds,
  onUpdateRuleField,
  onSettleDraft,
  onUpdateSupersetGroup,
  onUpdateRuleKind,
}: {
  se: EditorBlock
  index: number
  isFirst: boolean
  isLast: boolean
  unit: WeightUnit
  drafts: Record<string, string>
  invalidDrafts: Record<string, string>
  exercises: Exercise[]
  collapsed: boolean
  onToggleCollapse: (uid: number) => void
  onMove: (uid: number, delta: number) => void
  onDuplicate: (uid: number) => void
  onRemove: (index: number) => void
  onAddSet: (index: number) => void
  onUpdateSetField: (exKey: string, uid: number, si: number, key: SetFieldKey, text: string) => void
  onUpdatePlannedExtra: (exKey: string, uid: number, key: 'rir' | 'rpe' | 'tempo', text: string) => void
  onUpdateRestSeconds: (exKey: string, uid: number, text: string) => void
  onUpdateRuleField: (exKey: string, uid: number, key: 'min_reps' | 'max_reps' | 'increment' | 'target_rir', text: string) => void
  onSettleDraft: (k: string) => void
  onUpdateSupersetGroup: (uid: number, group: string | null) => void
  onUpdateRuleKind: (uid: number, kind: ProgressionRule['kind']) => void
}) {
  const t = useTheme()
  const exInfo = exercises.find((e) => e.id === se.exercise_id)
  // A11Y P1-4: every per-exercise control prefixes the exercise name — with N
  // exercises identical labels would leave a screen-reader user unable to
  // tell which exercise/set a control belonged to.
  const exName = exInfo?.name ?? `Exercise #${se.exercise_id}`
  const exKey = `${se.exercise_id}:u${se.uid}`
  // Task 2-c: per-set planned inputs follow the exercise's tracked fields
  // (TRACKING_FIELDS values are always tracked numeric keys).
  const tracked = (exInfo
    ? TRACKING_FIELDS[exInfo.tracking_type]
    : ['load_kg', 'reps']) as readonly SetFieldKey[]
  // T-IMPL-B C: the editor labels loads in the USER'S unit (was hard-coded
  // kg — silent 2.2× planning errors for lb users).
  const fieldLabels = getFieldLabels(unit)
  const incrementDisplay = se.rule.kind === 'percentage'
    ? String(se.rule.increment)
    : displaySetField('load_kg', se.rule.increment, unit)

  return (
    <View style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: t.rowRaised }}>
      {/* T-IMPL-B T11: the collapsed row IS the block — name + sets summary;
          one tap expands the full control stack below. */}
      <ItemRow
        icon={collapsed ? 'dumbbell' : 'dot6'}
        label={exName}
        value={`${se.sets.length} planned set${se.sets.length === 1 ? '' : 's'} · ${PROGRESSION_KIND_LABELS[se.rule.kind] ?? se.rule.kind}`}
        onPress={() => onToggleCollapse(se.uid)}
        accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${exName} — ${se.sets.length} planned sets, ${PROGRESSION_KIND_LABELS[se.rule.kind] ?? se.rule.kind}`}
      />

      <Row>
        {/* T-IMPL-B B3: reorder (up/down) and duplicate — the editor's block
            list is no longer remove-only. */}
        <Button
          label="Up"
          disabled={isFirst}
          onPress={() => onMove(se.uid, -1)}
          accessibilityLabel={`Move ${exName} up`}
        />
        <Button
          label="Down"
          disabled={isLast}
          onPress={() => onMove(se.uid, 1)}
          accessibilityLabel={`Move ${exName} down`}
        />
        <Button
          label="Duplicate"
          onPress={() => onDuplicate(se.uid)}
          accessibilityLabel={`Duplicate ${exName}`}
        />
        <Button
          label="Remove"
          onPress={() => onRemove(index)}
          accessibilityLabel={`Remove ${exName}`}
        />
      </Row>

      {!collapsed && (
        <>
          <Label muted>Progression Rule:</Label>
          {/* A11Y P2-10: the sanctioned ChipRow primitive replaces the
              hand-rolled Button row — T-IMPL-B A4: chips named by what they DO
              ("Reps first, then weight"), not the engine taxonomy. The dead
              'program' kind stays schema-only; the editor never offers it. */}
          <View accessibilityRole="radiogroup" accessibilityLabel={`${exName} — progression rule`}>
            <ChipRow
              items={PROGRESSION_KINDS}
              keyOf={(k) => k}
              label={(k) => PROGRESSION_KIND_LABELS[k]}
              a11yLabel={(k) => `${exName} — progression ${PROGRESSION_KIND_LABELS[k]}`}
              isActive={(k) => se.rule.kind === k}
              onPress={(k) => onUpdateRuleKind(se.uid, k)}
            />
          </View>
          {/* T-IMPL-B E2: the selected kind explains itself in one sentence,
              right where it was chosen — never a glossary screen. */}
          <Label muted>{PROGRESSION_KIND_HINTS[se.rule.kind]}</Label>

          {se.rule.kind === 'double' && (
            <Row>
              <View style={{ flex: 1 }}>
                <Field
                  label={`${exName} — Min Reps`}
                  keyboardType="number-pad"
                  error={invalidDrafts[`${exKey}:rule:min_reps`]}
                  value={drafts[`${exKey}:rule:min_reps`] ?? String(se.rule.min_reps)}
                  onChangeText={(text) => onUpdateRuleField(exKey, se.uid, 'min_reps', text)}
                  onBlur={() => onSettleDraft(`${exKey}:rule:min_reps`)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={`${exName} — Max Reps`}
                  keyboardType="number-pad"
                  error={invalidDrafts[`${exKey}:rule:max_reps`]}
                  value={drafts[`${exKey}:rule:max_reps`] ?? String(se.rule.max_reps)}
                  onChangeText={(text) => onUpdateRuleField(exKey, se.uid, 'max_reps', text)}
                  onBlur={() => onSettleDraft(`${exKey}:rule:max_reps`)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={`${exName} — Increment (${unit})`}
                  keyboardType="decimal-pad"
                  error={invalidDrafts[`${exKey}:rule:increment`]}
                  value={drafts[`${exKey}:rule:increment`] ?? incrementDisplay}
                  onChangeText={(text) => onUpdateRuleField(exKey, se.uid, 'increment', text)}
                  onBlur={() => onSettleDraft(`${exKey}:rule:increment`)}
                />
              </View>
            </Row>
          )}

          {/* Task 2-c: increment/target_rir are schema fields the editor
              never exposed (they previously rendered only under the
              double gate). fixed/percentage step by increment, rir
              escalates when the last set's RIR reaches target_rir. */}
          {se.rule.kind === 'fixed' || se.rule.kind === 'percentage' || se.rule.kind === 'rir' ? (
            <Row>
              <View style={{ flex: 1 }}>
                <Field
                  label={`${exName} — ${se.rule.kind === 'percentage' ? 'Increment (%)' : `Increment (${unit})`}`}
                  keyboardType="decimal-pad"
                  error={invalidDrafts[`${exKey}:rule:increment`]}
                  value={drafts[`${exKey}:rule:increment`] ?? incrementDisplay}
                  onChangeText={(text) => onUpdateRuleField(exKey, se.uid, 'increment', text)}
                  onBlur={() => onSettleDraft(`${exKey}:rule:increment`)}
                />
              </View>
              {se.rule.kind === 'rir' && (
                <View style={{ flex: 1 }}>
                  <Field
                    label={`${exName} — Target RIR (0-10)`}
                    hint={JARGON_HINTS.rir}
                    keyboardType="decimal-pad"
                    error={invalidDrafts[`${exKey}:rule:target_rir`]}
                    value={drafts[`${exKey}:rule:target_rir`] ?? String(se.rule.target_rir)}
                    onChangeText={(text) => onUpdateRuleField(exKey, se.uid, 'target_rir', text)}
                    onBlur={() => onSettleDraft(`${exKey}:rule:target_rir`)}
                  />
                </View>
              )}
            </Row>
          ) : null}

          {/* Task 2-c: planned RIR/RPE/tempo (SetValues.rir/rpe/tempo).
              Scope choice: ONE value per exercise, written into every
              planned set — per-set RIR planning here would triple the
              inputs; the live workout already edits RIR per set. Every
              jargon label carries its one-line explainer (T-IMPL-B E2). */}
          <Row>
            {(['rir', 'rpe'] as const).map((key) => (
              <View key={key} style={{ flex: 1, minWidth: 90 }}>
                <Field
                  label={`${exName} — Planned ${fieldLabels[key]}`}
                  hint={JARGON_HINTS[key]}
                  keyboardType="decimal-pad"
                  error={invalidDrafts[`${exKey}:extra:${key}`]}
                  value={drafts[`${exKey}:extra:${key}`] ?? (se.sets[0]?.[key] == null ? '' : String(se.sets[0]![key]))}
                  onChangeText={(text) => onUpdatePlannedExtra(exKey, se.uid, key, text)}
                  onBlur={() => onSettleDraft(`${exKey}:extra:${key}`)}
                />
              </View>
            ))}
            <View style={{ flex: 1, minWidth: 130 }}>
              <Field
                label={`${exName} — Planned tempo (e.g. 3-1-2-0)`}
                hint={JARGON_HINTS.tempo}
                error={invalidDrafts[`${exKey}:extra:tempo`]}
                value={drafts[`${exKey}:extra:tempo`] ?? (se.sets[0]?.tempo ?? '')}
                onChangeText={(text) => onUpdatePlannedExtra(exKey, se.uid, 'tempo', text)}
                onBlur={() => onSettleDraft(`${exKey}:extra:tempo`)}
              />
            </View>
          </Row>

          {/* T-IMPL-B I: the per-exercise rest default — the live session
              starts THIS timer after the exercise's sets complete. */}
          <Row>
            <View style={{ flex: 1 }}>
              <Field
                label={`${exName} — Rest after set (seconds)`}
                hint="The rest timer runs this long after the exercise's sets (blank = your usual rest)."
                keyboardType="number-pad"
                error={invalidDrafts[`${exKey}:extra:rest`]}
                value={drafts[`${exKey}:extra:rest`] ?? (se.rest_seconds == null ? '' : String(se.rest_seconds))}
                onChangeText={(text) => onUpdateRestSeconds(exKey, se.uid, text)}
                onBlur={() => onSettleDraft(`${exKey}:extra:rest`)}
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
              onPress={(g) => onUpdateSupersetGroup(se.uid, g === 'none' ? null : g)}
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
                    error={invalidDrafts[`${exKey}:${si}:${key}`]}
                    value={drafts[`${exKey}:${si}:${key}`] ?? displaySetField(key, set[key], unit)}
                    onChangeText={(text) => onUpdateSetField(exKey, se.uid, si, key, text)}
                    onBlur={() => onSettleDraft(`${exKey}:${si}:${key}`)}
                  />
                </View>
              ))}
            </Row>
          ))}

          <Row>
            <Button label={`Add Set (${se.sets.length + 1}, same as last)`} onPress={() => onAddSet(index)} />
          </Row>
        </>
      )}
    </View>
  )
}, (a, b) =>
  a.se === b.se &&
  a.index === b.index &&
  a.isFirst === b.isFirst &&
  a.isLast === b.isLast &&
  a.unit === b.unit &&
  a.collapsed === b.collapsed &&
  a.exercises === b.exercises &&
  blockDraftFingerprint(a.drafts, `${a.se.exercise_id}:u${a.se.uid}:`) === blockDraftFingerprint(b.drafts, `${b.se.exercise_id}:u${b.se.uid}:`) &&
  blockDraftFingerprint(a.invalidDrafts, `${a.se.exercise_id}:u${a.se.uid}:`) === blockDraftFingerprint(b.invalidDrafts, `${b.se.exercise_id}:u${b.se.uid}:`),
)
