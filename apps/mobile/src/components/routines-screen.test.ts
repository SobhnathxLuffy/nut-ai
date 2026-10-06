import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * Task 2-c regression locks for /routines (the "Create Routine" / "New
 * Routine" screen — the same screen under two titles) and for the shared
 * Screen busy slot.
 *
 * JITTER (T1-b root cause, here as a permanent lock): /routines' focus-effect
 * callback depended on `handleAddExercise`, whose useCallback deps were
 * `[exercises]`; refresh() unconditionally setRoutines/setExercises with FRESH
 * arrays, so every refresh re-created handleAddExercise → the focus callback
 * identity changed → expo-router's useFocusEffect re-fired the effect WHILE
 * FOCUSED (its effect deps are `[effect, navigation]` — verified in
 * node_modules/expo-router/build/react-navigation/core/useFocusEffect.js) →
 * refresh again → a sustained refresh loop whose visible carriers were the
 * busy ActivityIndicator toggling inside the gap-based scroll content plus a
 * full-list re-render per cycle. Differential: train/programs/workout screens
 * use stable-deps refresh and never jittered.
 *
 * The RN screen cannot mount in this plain-node environment (the same
 * constraint set-table.test.ts / Screen.header.test.ts document), so the locks
 * are structural source sweeps plus a semantic simulation of the exact
 * useFocusEffect re-fire rule. Runtime behavior on device is separately
 * flagged NOT TESTED in the Task 2-c report.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '../../app/routines.tsx'), 'utf8')
const screenSource = readFileSync(join(here, './Screen.tsx'), 'utf8')

/** Balanced-paren slice: the full argument list of the call after `marker`. */
function argsOf(haystack: string, marker: string): string {
  const start = haystack.indexOf(marker)
  expect(start, `marker not found: ${marker}`).toBeGreaterThan(-1)
  const open = haystack.indexOf('(', start)
  let depth = 0
  for (let i = open; i < haystack.length; i++) {
    if (haystack[i] === '(') depth++
    else if (haystack[i] === ')') {
      depth--
      if (depth === 0) return haystack.slice(open + 1, i)
    }
  }
  throw new Error(`unbalanced parens after ${marker}`)
}

/** The trailing useCallback dependency array of a balanced-args slice. */
function depsOf(args: string): string {
  const match = args.match(/\[([^\]]*)\]\s*\)?\s*,?\s*$/)
  expect(match, 'deps array not found at end of block').not.toBeNull()
  return match![1].replace(/\s/g, '')
}

describe('routines.tsx jitter locks (T1-b root cause, Task 2-c)', () => {
  const focusDeps = depsOf(argsOf(source, 'useFocusEffect('))

  it('the focus-effect dependency list is exactly the two stable identities', () => {
    // No state-array-dependent callback may ride in these deps: any dep whose
    // identity changes per refresh re-fires useFocusEffect while focused.
    expect(focusDeps).toBe('refresh,handleAddExercise')
  })

  it('handleAddExercise has an empty dep array — stable identity across refreshes', () => {
    // The bug: its deps were [exercises] and refresh() setExercises fresh
    // arrays every run. Empty deps keep the focus callback identity fixed.
    expect(depsOf(argsOf(source, 'const handleAddExercise = useCallback('))).toBe('')
  })

  it('refresh() fingerprints rows BEFORE setState — no identity churn from a refired refresh', () => {
    const refreshBody = argsOf(source, 'const refresh = useCallback(')
    expect(refreshBody).toContain('rowsFingerprint')
    expect(refreshBody.indexOf('rowsFingerprint')).toBeLessThan(refreshBody.indexOf('setRoutines'))
    expect(refreshBody.indexOf('rowsFingerprint')).toBeLessThan(refreshBody.indexOf('setExercises'))
    // refresh itself stays stable: only the route param rides in its deps.
    expect(depsOf(refreshBody)).toBe('params.id')
  })
})

describe('the jitter mechanism, simulated (expo-router useFocusEffect re-fire rule)', () => {
  /**
   * Exact semantics of useFocusEffect (node_modules/expo-router/build/
   * react-navigation/core/useFocusEffect.js): the inner React.useEffect has
   * deps `[effect, navigation]`, so a changed effect identity re-runs the
   * effect — and while the screen stays focused the callback fires again.
   * The simulation feeds it the dep arrays the two code shapes produce and
   * counts how often the effect (the refresh) runs while focused.
   */
  function simulateFocused(makeEffectDeps: () => unknown[], cycles = 25): number {
    let last: unknown[] | null = null
    let runs = 0
    for (let i = 0; i < cycles; i++) {
      const deps = makeEffectDeps()
      if (last && deps.every((d, j) => Object.is(d, last![j]))) break
      last = deps
      runs++
    }
    return runs
  }

  it('BEFORE the fix: a dep-side callback recreated per refresh re-fires focus on every cycle', () => {
    // Old shape: refresh was stable, but handleAddExercise had deps
    // [exercises] and refresh() setExercises with a FRESH array each run —
    // so each run produced a new handleAddExercise identity.
    let exercises: Array<{ id: number }> = []
    const runs = simulateFocused(() => {
      const refresh = (): void => { exercises = [...exercises] } // fresh identity of the STATE each run
      void refresh
      const handleAddExercise = { boundExercises: exercises } // recreated: deps [exercises]
      return [refresh, handleAddExercise]
    })
    expect(runs).toBe(25) // the sustained loop — 25 simulated refires, unbounded
  })

  it('AFTER the fix: stable identities fire the focus effect exactly once', () => {
    // New shape: handleAddExercise deps [] (never recreated), refresh deps
    // [params.id] (route primitive — useCallback-stable while focused), plus
    // the fingerprint so a refired refresh cannot churn list identities.
    const stableRefresh = (): void => {}
    const stableHandleAdd = { boundExercises: null }
    const runs = simulateFocused(() => [stableRefresh, stableHandleAdd])
    expect(runs).toBe(1)
  })
})

describe('Screen.tsx busy feedback slot (T1-b amplifier, Task 2-c)', () => {
  it('the busy spinner mounts inside a fixed-height slot — busy toggling cannot shift scroll content', () => {
    const feedback = screenSource.slice(screenSource.indexOf('feedback: ('))
    expect(feedback, 'feedback must keep rendering the spinner + error pair').toContain('busy && <ActivityIndicator')
    // The slot: a constant-height View wrapping the spinner, so mount/unmount
    // of the ActivityIndicator can never change the scroll content's layout.
    expect(screenSource).toMatch(/const FEEDBACK_SLOT_HEIGHT = \d+/)
    const slot = feedback.slice(feedback.indexOf('height: FEEDBACK_SLOT_HEIGHT'), feedback.indexOf('{!!error'))
    expect(slot).toContain('busy && <ActivityIndicator')
  })

  it('the error block still renders its Retry affordance', () => {
    const feedback = screenSource.slice(screenSource.indexOf('feedback: ('))
    expect(feedback).toContain('label="Retry"')
  })
})

describe('the routine editor exposes the schema-backed controls (Task 2-c)', () => {
  it('per-set planned values render through TRACKING_FIELDS and write back into sets', () => {
    expect(source).toContain('TRACKING_FIELDS[')
    expect(source).toContain('updateSetField')
  })

  it('planned RIR/RPE/tempo exist (per-exercise scope) and persist into every set', () => {
    expect(source).toContain('updatePlannedExtra')
  })

  it('superset grouping writes exercises[].group (launched as superset_group_id)', () => {
    expect(source).toContain('updateSupersetGroup')
    expect(source).toContain('Superset group:')
  })

  it('progression increment/target_rir are exposed beyond the kind===double gate', () => {
    expect(source).toContain("Target RIR")
    expect(source).toContain("'Increment (%)'")
    // fixed / percentage / rir reach the increment field:
    expect(source).toMatch(/kind === 'fixed' \|\| se\.rule\.kind === 'percentage' \|\| se\.rule\.kind === 'rir'/)
  })
})

describe('T5-fix2 — dirty-editor exits outside the screen tree (review SHOULD-FIX #1)', () => {
  it('"Launch workout" routes through confirmDiscardThen like every other exit', () => {
    // The saved-routine rows stay interactive BELOW the live editor; the
    // launch button used to navigate unguarded, silently discarding unsaved
    // planned-set work (§8.3). The guard is confirmDiscardThen itself, so a
    // clean editor (closed or untouched) still launches with no dialog.
    const launchAt = source.indexOf('label="Launch workout"')
    expect(launchAt).toBeGreaterThan(-1)
    const launch = source.slice(launchAt, source.indexOf('/>', launchAt))
    expect(launch).toContain('onPress={() => confirmDiscardThen(() => void action.run(() => handleLaunch(r.id)))}')
  })

  it('the editor publishes its dirty state for the notification/deep-link router', () => {
    // src/notifications/handler.ts consults isRoutineEditorDirty() before
    // router.navigate — the seam lives in src/ui/editor-dirty.ts (see its
    // header). The publish must mirror the SAME `dirty` the local exits use.
    expect(source).toContain("from '../src/ui/editor-dirty'")
    expect(source).toMatch(/setRoutineEditorDirty\(dirty\)/)
    // Unmount clears the flag: a dismissed editor can never leave it stuck
    // true (which would block every future deep link).
    expect(source).toMatch(/useEffect\(\(\) => \(\) => setRoutineEditorDirty\(false\), \[\]\)/)
  })
})

/** Slice a module-level `function NAME(...)` declaration out of screen source.
 *  AST-based for the same reason training-surface.test.ts documents: the
 *  generic constraint braces would break a naive first-`{` match. */
function functionSource(src: string, name: string): string {
  const sf = ts.createSourceFile('screen.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body) {
      return src.slice(statement.getStart(sf), statement.end)
    }
  }
  throw new Error(`module-level function not found: function ${name}(`)
}

/** Transpile an extracted TS helper and hand back the real callable. */
function evalHelper<T>(src: string, name: string, deps: Record<string, unknown> = {}): T {
  const js = ts.transpileModule(functionSource(src, name), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText
  const factory = new Function(...Object.keys(deps), `${js}; return ${name};`)
  return factory(...Object.values(deps)) as T
}

describe('Task 12-b M2 — the picker handoff merges into an EDIT in progress', () => {
  /**
   * Bug: confirmMultiSelect always setPendingRoutineExercises, and the focus
   * effect ran startCreate() whenever pending > 0 — even while EDITING an
   * existing routine. The loaded routine, its planned-set drafts and editId
   * were replaced by a clean slate, so Save then created a NEW routine
   * instead of updating the one being edited.
   */
  it('the focus effect branches on the editor mode BEFORE consuming the picks', () => {
    const focus = argsOf(source, 'useFocusEffect(')
    // The mode is read through the render-synced ref (state deps here would
    // re-fire the effect mid-focus — the T1-b jitter class locked above).
    expect(focus).toContain('editModeRef.current.editing && editModeRef.current.editId != null')
    // The ref mirrors the same editing/editId the guarded exits use.
    expect(source).toContain('editModeRef.current = { editing, editId }')
  })

  it('EDIT mode MERGES: no startCreate, adds ride the dedupe-append primitive', () => {
    const focus = argsOf(source, 'useFocusEffect(')
    const merge = focus.slice(focus.indexOf('editModeRef.current.editing'))
    const mergeBody = merge.slice(0, merge.indexOf('} else {'))
    expect(mergeBody).toContain('for (const id of pending)')
    expect(mergeBody).toContain('await handleAddExercise(id)')
    // The exact regression: the edit branch must not reset the editor.
    expect(mergeBody).not.toContain('startCreate()')
  })

  it('CREATE/closed mode keeps the clean-slate entry (T4-b #5 behavior unchanged)', () => {
    const focus = argsOf(source, 'useFocusEffect(')
    const createBranch = focus.slice(focus.indexOf('} else {'))
    expect(createBranch).toContain('startCreate()')
    expect(createBranch).toContain('await handleAddExercise(id)')
  })

  it('behavioral: withPendingExercise dedupes, appends, and preserves existing rows', () => {
    type Row = { exercise_id: number; sets: unknown[] }
    const merge = evalHelper<(prev: Row[], exerciseId: number, addRow: () => Row) => Row[]>(source, 'withPendingExercise')
    const rowA = { exercise_id: 1, sets: [{ reps: 8 }] }
    const rowB = { exercise_id: 2, sets: [{ reps: 12 }] }
    const addRowB = () => ({ exercise_id: 2, sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }] })

    // a new id is appended at the end; the existing row object passes
    // through BY REFERENCE (so a merge cannot disturb its planned values —
    // the draft maps are keyed off exercise_id and live outside the array)
    const merged = merge([rowA], 2, addRowB)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toBe(rowA)
    expect(merged[1]).toEqual(addRowB())

    // a duplicate id is a no-op returning the SAME array (no re-render churn)
    const again = merge([rowA, rowB], 2, addRowB)
    expect(again).toHaveLength(2)
    expect(again).toEqual([rowA, rowB])
  })
})
