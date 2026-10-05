import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * T5-b release-conditional locks for the four training-surface screens
 * (routines / programs / workout / search) — the fixes from audit batch
 * T4-b + the T4-c a11y items:
 *
 *   T4-b #1  destructive deletes (routine, program) confirm via confirmDialog
 *   T4-b #4  workout planned_json parses per row behind a guard
 *   T4-b #5  the routine editor warns before a dirty exit (all exit paths)
 *   T4-b #6  planned inputs keep invalid text visible; Save blocks; NaN-safe
 *   T4-b #8  search parses user exercise rows per column; library survives
 *   P1-4/P2-10/P2-11 exercise-name / human / weekday context in a11y labels
 *
 * The RN screens cannot mount in this plain-node environment (the same
 * constraint set-table.test.ts / routines-screen.test.ts document), so the
 * locks are structural source sweeps PLUS real behavioral tests of the pure
 * module-level helpers: the helper source is extracted, transpiled with the
 * repo's own TypeScript compiler, and executed — the guard behavior itself
 * is verified, not just its text.
 */

const here = dirname(fileURLToPath(import.meta.url))
const routines = readFileSync(join(here, '../../app/routines.tsx'), 'utf8')
const programs = readFileSync(join(here, '../../app/programs.tsx'), 'utf8')
const workout = readFileSync(join(here, '../../app/workout.tsx'), 'utf8')
const search = readFileSync(join(here, '../../app/search.tsx'), 'utf8')

/** Slice a module-level `function NAME(...)` declaration out of screen source. */
function functionSource(source: string, name: string): string {
  // Locate the declaration via the TypeScript AST: a naive first-`{` brace
  // match truncates functions whose return-type annotation contains braces
  // (e.g. parseSetFieldDraft returns `{ value } | { error }`), which transpiles
  // to nothing and fails as "name is not defined".
  const sf = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body) {
      return source.slice(statement.getStart(sf), statement.end)
    }
  }
  throw new Error(`module-level function not found: function ${name}(`)
}

/** Transpile an extracted TS helper and hand back the real callable. */
function evalHelper<T>(source: string, name: string, deps: Record<string, unknown> = {}): T {
  const js = ts.transpileModule(functionSource(source, name), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText
  const factory = new Function(...Object.keys(deps), `${js}; return ${name};`)
  return factory(...Object.values(deps)) as T
}

describe('T4-b #1 — destructive deletes go through the ONE confirmDialog helper', () => {
  it('Delete routine confirms before the soft delete (no undo exists — no undo promised)', () => {
    expect(routines).toContain("import { confirmDialog } from '../src/ui/alert-web'")
    expect(routines).toContain("title: 'Delete this routine?'")
    const confirm = routines.slice(routines.indexOf('title: \'Delete this routine?\''))
    expect(confirm.indexOf('destructive: true')).toBeGreaterThan(-1)
    expect(confirm.indexOf('onConfirm: () => void action.run(() => handleDeleteRoutine(r.id))')).toBeGreaterThan(-1)
    expect(confirm.slice(0, confirm.indexOf('onConfirm'))).not.toContain('Undo')
  })

  it('Delete program confirms before the soft delete', () => {
    expect(programs).toContain("import { confirmDialog } from '../src/ui/alert-web'")
    expect(programs).toContain("title: 'Delete this program?'")
    const confirm = programs.slice(programs.indexOf('title: \'Delete this program?\''))
    expect(confirm.indexOf('destructive: true')).toBeGreaterThan(-1)
    expect(confirm.indexOf('onConfirm: () => void action.run(() => handleDelete(p.id))')).toBeGreaterThan(-1)
  })
})

describe('T4-b #5 — the routine editor warns before a dirty exit', () => {
  it('the shared guarded exit exists and is destructive-flagged', () => {
    expect(routines).toContain('confirmDiscardThen')
    expect(routines).toContain("title: 'Discard changes?'")
    const confirm = routines.slice(routines.indexOf('title: \'Discard changes?\''))
    expect(confirm.indexOf('confirmLabel')).toBeLessThan(confirm.indexOf('onConfirm'))
    expect(confirm.indexOf('destructive: true')).toBeGreaterThan(-1)
  })

  it('every exit path routes through the guard: hardware back, Cancel, header close, row switch', () => {
    // Hardware back (the effect body):
    const backHandler = routines.slice(routines.indexOf("BackHandler.addEventListener('hardwareBackPress'"))
    expect(backHandler.slice(0, backHandler.indexOf('}, [editing]'))).toContain('confirmDiscardThen(closeEditor)')
    // Cancel:
    expect(routines).toContain('<Button label="Cancel" onPress={exitEditor} />')
    // Header: while editing the plain chevron is replaced by the guarded close
    // (Screen owns its own router.back() onPress and cannot be intercepted).
    expect(routines).toContain('back={!editing}')
    expect(routines).toContain("label: 'Close routine editor'")
    // Row switches:
    expect(routines).toContain('onPress={() => confirmDiscardThen(() => openRoutine(r))}')
  })

  it('the dirty baseline is captured at every editor entry (open + create + deep link)', () => {
    expect(routines).toContain('function editorFingerprint(')
    expect(routines).toContain('setBaseline(editorFingerprint(r.name, parsed.exercises))')
    expect(routines).toContain('setBaseline(editorFingerprint(\'\', []))')
    // The web leave-guard now tracks dirty, not merely "editing".
    expect(routines).toContain('useWebDirtyGuard(dirty)')
  })

  it('behavioral: the fingerprint changes exactly when editor state changes', () => {
    const fingerprint = evalHelper<(name: string, exercises: ReadonlyArray<unknown>) => string>(routines, 'editorFingerprint')
    const baseline = fingerprint('Push A', [{ exercise_id: 1, sets: [{ reps: 10 }] }])
    expect(fingerprint('Push A', [{ exercise_id: 1, sets: [{ reps: 10 }] }])).toBe(baseline)
    expect(fingerprint('Push A', [{ exercise_id: 1, sets: [{ reps: 12 }] }])).not.toBe(baseline)
    expect(fingerprint('Push B', [{ exercise_id: 1, sets: [{ reps: 10 }] }])).not.toBe(baseline)
  })
})

describe('T4-b #6 — planned inputs never silently drop a rejected value', () => {
  it('behavioral: the set-field draft parser (§8.3 — intermediates never explode into NaN)', () => {
    // The runtime shape is the {value} | {error} union; the flattened optional
    // error keeps the truthy `.error` assertions honest to typecheck too.
    const parse = evalHelper<(key: string, text: string) => { value: number | null; error?: string }>(routines, 'parseSetFieldDraft')
    expect(parse('load_kg', '60')).toEqual({ value: 60 })
    expect(parse('load_kg', '')).toEqual({ value: null }) // clearing is a commit, not an error
    expect(parse('reps', '8')).toEqual({ value: 8 })
    // '1.' parses whole (Number('1.') === 1): no NaN can appear, the raw draft
    // stays visible until blur settles it back to the committed 1 — no error,
    // exactly the documented parseSetFieldDraft contract (routines.tsx).
    expect(parse('reps', '1.')).toEqual({ value: 1 })
    expect(parse('reps', '8.5').error).toBeTruthy() // reps stay whole
    expect(parse('load_kg', '-2').error).toBeTruthy()
    expect(parse('load_kg', 'abc').error).toBeTruthy() // Number → NaN, rejected, no state write
    expect(parse('load_kg', '.').error).toBeTruthy()
  })

  it('the raw draft is always what the input shows; invalid drafts stay visible with a Field error', () => {
    // Draft-first values (the input renders the user's text, not the state's):
    expect(routines).toContain('value={drafts[')
    // Field error slot wired from the invalid-draft map:
    expect(routines).toContain('error={invalidDrafts[')
    // Blur settles valid drafts (snap back), invalid ones deliberately stay:
    expect(routines).toContain('const settleDraft = (k: string)')
  })

  it('Save is blocked while an invalid draft exists — and the save path re-checks', () => {
    expect(routines).toContain('disabled={action.busy || hasInvalidDrafts}')
    expect(routines).toContain('Fix the highlighted planned values')
    expect(routines).toContain("if (hasInvalidDrafts) throw new Error('Fix the highlighted planned values before saving.')")
  })

  it('removing an exercise drops its drafts — no stale invalid draft blocks Save invisibly', () => {
    expect(routines).toContain('function dropKeysWithPrefix(')
    expect(routines).toContain('dropKeysWithPrefix(d, `${removed.exercise_id}:`)')
  })
})

describe('T4-b #4 — a corrupt planned_json row cannot kill the workout screen', () => {
  const describeSetStub = (s: Record<string, unknown>): string => {
    if (s.reps === 'eight') throw new Error('SetValues.parse rejection (emulated)')
    return '60 kg · 8 reps'
  }

  it('behavioral: the per-row guard parses, and corrupt data renders the honest caption', () => {
    const plannedCaption = evalHelper<(s: { planned_json: string | null; [k: string]: unknown }, unit: string) => string | null>(
      workout,
      'plannedCaption',
      { describeSet: describeSetStub },
    )
    expect(plannedCaption({ planned_json: null }, 'kg')).toBeNull()
    expect(plannedCaption({ planned_json: '', load_kg: 60 }, 'kg')).toBeNull()
    expect(plannedCaption({ planned_json: '{"reps":8}', load_kg: 60 }, 'kg')).toBe('Planned: 60 kg · 8 reps')
    // Truncated JSON (the realistic corruption):
    expect(plannedCaption({ planned_json: '{"reps":', load_kg: 60 }, 'kg')).toBe(
      'Planned data unreadable — this set still logs normally.',
    )
    // JSON that parses but fails set-value validation:
    expect(plannedCaption({ planned_json: '{"reps":"eight"}', load_kg: 60 }, 'kg')).toBe(
      'Planned data unreadable — this set still logs normally.',
    )
  })

  it('structural: the render path consumes only the guarded caption — no unguarded parse left', () => {
    expect(workout).toContain('<Text style={[type.caption, { color: t.textFaint }]}>{plannedText}</Text>')
    const caption = functionSource(workout, 'plannedCaption')
    expect(caption).toContain('try {')
    // The ONLY JSON.parse of planned_json lives inside the guard's try block.
    const first = workout.indexOf('JSON.parse(s.planned_json)')
    expect(first).toBeGreaterThan(-1)
    expect(first).toBeGreaterThan(caption.indexOf('try {') === -1 ? -1 : workout.indexOf('function plannedCaption('))
    expect(first).toBeLessThan(workout.indexOf('export default function WorkoutScreen()'))
    expect(workout.indexOf('JSON.parse(s.planned_json)', first + 1)).toBe(-1)
  })
})

describe('T4-b #8 — a corrupt user exercise row cannot dead-end the exercise library', () => {
  it('behavioral: parseJsonArray degrades every bad column to [] and keeps good data', () => {
    const parseJsonArray = evalHelper<(raw: unknown) => string[]>(search, 'parseJsonArray')
    expect(parseJsonArray('["Bench Press","BP"]')).toEqual(['Bench Press', 'BP'])
    expect(parseJsonArray('[1,2]')).toEqual(['1', '2'])
    expect(parseJsonArray('')).toEqual([])
    expect(parseJsonArray(null)).toEqual([])
    expect(parseJsonArray(undefined)).toEqual([])
    expect(parseJsonArray('{"aliases":')).toEqual([]) // truncated JSON
    expect(parseJsonArray('"just a string"')).toEqual([]) // valid JSON, wrong shape
    expect(parseJsonArray('42')).toEqual([])
    expect(parseJsonArray('null')).toEqual([])
  })

  it('structural: all three user-row JSON columns parse per row — the raw JSON.parse mapping is gone', () => {
    for (const column of ['aliases_json', 'equipment_json', 'primary_muscles_json']) {
      expect(search).toContain(`parseJsonArray(r.${column})`)
      expect(search).not.toContain(`JSON.parse(String(r.${column}`)
    }
  })
})

describe('A11Y P1-4 / P2-10 / P2-11 — exercise and weekday context in labels', () => {
  it('routines: every per-exercise control prefixes the exercise name', () => {
    expect(routines).toContain('const exName = exInfo?.name ?? `Exercise #${se.exercise_id}`')
    expect(routines).toContain('label={`Remove ${exName}`}')
    expect(routines).toContain('label={`${exName} — ${fieldLabels[key]} · set ${si + 1}`}')
    expect(routines).toContain('label={`${exName} — Min Reps`}')
    expect(routines).toContain('label={`${exName} — Max Reps`}')
    expect(routines).toContain("label={`${exName} — ${se.rule.kind === 'percentage' ? 'Increment (%)' : 'Increment (kg)'}`}")
    expect(routines).toContain('label={`${exName} — Target RIR (0-10)`}')
    expect(routines).toContain('label={`${exName} — Planned ${fieldLabels[key]}`}')
    expect(routines).toContain('label={`${exName} — Planned tempo (e.g. 3-1-2-0)`}')
  })

  it('routines: the hand-rolled chip rows became the sanctioned ChipRow with human labels + radiogroup context', () => {
    // P2-10: no raw engine enums as chip labels any more.
    expect(routines).toContain('double: \'Double\'')
    expect(routines).toContain('percentage: \'Percentage\'')
    expect(routines).not.toContain('<Button\n                      key={k}\n                      label={k}')
    // Both chip rows render through ChipRow under a named radiogroup:
    expect(routines.match(/<ChipRow/g)?.length).toBe(2)
    expect(routines).toContain('accessibilityRole="radiogroup" accessibilityLabel={`${exName} — progression rule`}')
    expect(routines).toContain('accessibilityRole="radiogroup" accessibilityLabel={`${exName} — superset group`}')
    expect(routines).toContain('a11yLabel={(k) => `${exName} — progression ${PROGRESSION_LABELS[k]}`}')
    expect(routines).toContain("a11yLabel={(g) => `${exName} — superset ${g === 'none' ? 'none' : `group ${g}`}`}")
  })

  it('programs: weekday chips announce routine AND weekday, under a weekday-named radiogroup', () => {
    expect(programs).toContain("const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const")
    expect(programs).toContain('a11yLabel={(r) => `${r.name} — ${FULL_DAYS[weekday]}`}')
    expect(programs).toContain('accessibilityRole="radiogroup" accessibilityLabel={`${FULL_DAYS[weekday]} — assign a routine`}')
  })
})
