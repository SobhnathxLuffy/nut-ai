import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
