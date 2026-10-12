import { describe, expect, it } from 'vitest'
import { EXERCISE_LIBRARY } from '@nutai/training'
import {
  TRAINING_IMPORT_FORMAT,
  buildTrainingImportPlan,
  executeTrainingImport,
  parseTrainingImportJson,
  weekdayIndexFromText,
  type ExerciseCatalogEntry,
  type TrainingImportContext,
} from './training-import'
import { TRAINING_IMPORT_EXAMPLE } from './training-import-example'

/** A slim catalog straight from the real library (the ids the seeder assigns:
 * index + 1 — but the plan builder resolves by NAME, so ids only matter for
 * the executor, which uses whatever the catalog carries). */
function catalog(names: string[]): TrainingImportContext {
  const entries: ExerciseCatalogEntry[] = names.map((name, i) => {
    const lib = EXERCISE_LIBRARY.find((e) => e.name === name)
    if (!lib) throw new Error(`fixture drift: "${name}" left the library`)
    return { id: i + 1, name: lib.name, aliases: lib.aliases, tracking_type: lib.tracking_type }
  })
  return { exercises: entries, existingRoutines: [{ id: 99, name: 'Old Full Body' }] }
}

const CTX = catalog([
  'Barbell Bench Press',
  'Cable Triceps Pushdown',
  'Bodyweight Push-up',
  'Barbell Bent Over Row',
  'Machine Lat Pulldown',
  'Plank',
  'Running',
])

function planFromJson(raw: string, ctx: TrainingImportContext = CTX) {
  const parsed = parseTrainingImportJson(raw)
  if (!parsed.ok) throw new Error(parsed.error)
  return buildTrainingImportPlan(parsed.parsed, ctx)
}

const ROUTINE = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: TRAINING_IMPORT_FORMAT,
    version: 1,
    routines: [
      {
        name: 'Push Day',
        exercises: [{ exercise: 'Barbell Bench Press', sets: [{ load_kg: 60, reps: 8 }] }],
        ...overrides,
      },
    ],
    programs: [],
  })

describe('parseTrainingImportJson', () => {
  it('accepts a well-formed envelope', () => {
    const result = parseTrainingImportJson(ROUTINE())
    expect(result.ok).toBe(true)
  })

  it('rejects invalid JSON with the parse error', () => {
    const result = parseTrainingImportJson('{oops')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('not valid JSON')
  })

  it('rejects non-objects and missing/mistyped arrays', () => {
    expect(parseTrainingImportJson('[]').ok).toBe(false)
    expect(parseTrainingImportJson('"hi"').ok).toBe(false)
    const noArrays = parseTrainingImportJson(JSON.stringify({ format: TRAINING_IMPORT_FORMAT, version: 1, routines: 3 }))
    expect(noArrays.ok).toBe(false)
  })

  it('rejects files without the format tag — a backup must never import here', () => {
    const result = parseTrainingImportJson(JSON.stringify({ routines: [], programs: [] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('format')
  })

  it('rejects wrong versions and empty files', () => {
    expect(parseTrainingImportJson(JSON.stringify({ format: TRAINING_IMPORT_FORMAT, version: 99, routines: [], programs: [] })).ok).toBe(false)
    const empty = parseTrainingImportJson(JSON.stringify({ format: TRAINING_IMPORT_FORMAT, version: 1, routines: [], programs: [] }))
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error).toContain('Nothing to import')
  })
})

describe('weekdayIndexFromText', () => {
  it('accepts short and long names, case-insensitive', () => {
    expect(weekdayIndexFromText('Mon')).toBe(1)
    expect(weekdayIndexFromText('monday')).toBe(1)
    expect(weekdayIndexFromText('SUN')).toBe(0)
    expect(weekdayIndexFromText('Thu')).toBe(4)
  })

  it('rejects non-weekdays', () => {
    expect(weekdayIndexFromText('Mars')).toBe(null)
    expect(weekdayIndexFromText('')).toBe(null)
  })
})

describe('buildTrainingImportPlan — routines', () => {
  it('builds the shipped example end-to-end: 2 routines + 1 program, zero problems', () => {
    const plan = planFromJson(TRAINING_IMPORT_EXAMPLE)
    expect(plan.routines).toHaveLength(2)
    expect(plan.programs).toHaveLength(1)
    expect(plan.problems).toEqual([])
    const push = plan.routines[0]!
    expect(push.name).toBe('Push Day A')
    const exercises = (push.input as { exercises: Array<Record<string, unknown>> }).exercises
    expect(exercises).toHaveLength(3)
    // The default rule kind fills in when "rule" is omitted.
    expect((exercises[1]!.rule as { kind: string }).kind).toBe('double')
    // The superset group travels.
    expect(exercises[1]!.group).toBe('A')
    expect(exercises[2]!.rest_seconds).toBe(60)
  })

  it('resolves exercises by ALIAS too', () => {
    const plan = planFromJson(ROUTINE({ exercises: [{ exercise: 'bench', sets: [{ load_kg: 40, reps: 5 }] }] }))
    expect(plan.problems).toEqual([])
    expect(plan.routines[0]!.input).toMatchObject({ exercises: [{ exercise_id: 1 }] })
  })

  it('defaults bodyweight sets to load_kg 0 when omitted', () => {
    const plan = planFromJson(
      JSON.stringify({
        format: TRAINING_IMPORT_FORMAT,
        version: 1,
        routines: [{ name: 'BW', exercises: [{ exercise: 'Bodyweight Push-up', sets: [{ reps: 20 }] }] }],
        programs: [],
      }),
    )
    expect(plan.problems).toEqual([])
    const sets = (plan.routines[0]!.input as { exercises: Array<{ sets: Array<Record<string, unknown>> }> }).exercises[0]!.sets
    expect(sets[0]!.load_kg).toBe(0)
    expect(sets[0]!.reps).toBe(20)
  })

  it('reports unknown exercises with a helpful message', () => {
    const plan = planFromJson(ROUTINE({ exercises: [{ exercise: 'Thigh Master', sets: [{ reps: 10 }] }] }))
    expect(plan.routines).toHaveLength(0)
    expect(plan.problems[0]!.message).toContain('Thigh Master')
    expect(plan.problems[0]!.message).toContain('not in the library')
  })

  it('surfaces set validation through the engine (missing reps, incompatible fields)', () => {
    const missingReps = planFromJson(ROUTINE({ exercises: [{ exercise: 'Barbell Bench Press', sets: [{ load_kg: 60 }] }] }))
    expect(missingReps.problems[0]!.message).toContain('reps')
    const incompatible = planFromJson(ROUTINE({ exercises: [{ exercise: 'Plank', sets: [{ load_kg: 10, reps: 3 }] }] }))
    expect(incompatible.problems[0]!.message).toContain('incompatible')
  })

  it('rejects duplicate routine names inside one file', () => {
    const raw = JSON.stringify({
      format: TRAINING_IMPORT_FORMAT,
      version: 1,
      routines: [
        { name: 'Same', exercises: [{ exercise: 'Plank', sets: [{ duration_s: 30 }] }] },
        { name: 'same', exercises: [{ exercise: 'Plank', sets: [{ duration_s: 30 }] }] },
      ],
      programs: [],
    })
    const plan = planFromJson(raw)
    expect(plan.routines).toHaveLength(1)
    expect(plan.problems[0]!.message).toContain('twice')
  })
})

describe('buildTrainingImportPlan — programs', () => {
  const TWO = JSON.stringify({
    format: TRAINING_IMPORT_FORMAT,
    version: 1,
    routines: [
      { name: 'Push', exercises: [{ exercise: 'Barbell Bench Press', sets: [{ load_kg: 60, reps: 8 }] }] },
      { name: 'Pull', exercises: [{ exercise: 'Barbell Bent Over Row', sets: [{ load_kg: 50, reps: 8 }] }] },
    ],
    programs: [],
  })

  it('converts weekday names to cycle days against start_date', () => {
    // 2026-10-12 is a Monday: "Mon" → cycle day 0, "Thu" → cycle day 3.
    const file = JSON.parse(TWO)
    file.programs = [
      {
        name: 'Block',
        start_date: '2026-10-12',
        weeks: 4,
        schedule: [
          { day: 'Mon', routine: 'Push' },
          { day: 'Thu', routine: 'Pull' },
        ],
      },
    ]
    const plan = planFromJson(JSON.stringify(file))
    expect(plan.problems).toEqual([])
    expect(plan.programs[0]!.schedule).toEqual([
      { day: 0, kind: 'file', routineName: 'Push' },
      { day: 3, kind: 'file', routineName: 'Pull' },
    ])
  })

  it('resolves references to EXISTING routines by name', () => {
    const file = JSON.parse(TWO)
    file.routines = []
    file.programs = [{ name: 'Reuse', start_date: '2026-10-12', weeks: 2, schedule: [{ day: 'Tue', routine: 'old full body' }] }]
    const plan = planFromJson(JSON.stringify(file))
    expect(plan.problems).toEqual([])
    expect(plan.programs[0]!.schedule[0]).toEqual({ day: 1, kind: 'existing', routineId: 99 })
  })

  it('accepts numeric cycle days verbatim', () => {
    const file = JSON.parse(TWO)
    file.programs = [{ name: 'Cycles', start_date: '2026-10-12', weeks: 1, schedule: [{ day: 2, routine: 'Push' }] }]
    const plan = planFromJson(JSON.stringify(file))
    expect(plan.programs[0]!.schedule[0]).toMatchObject({ day: 2 })
  })

  it('rejects unknown routine references', () => {
    const file = JSON.parse(TWO)
    file.programs = [{ name: 'Ghost', start_date: '2026-10-12', weeks: 1, schedule: [{ day: 'Mon', routine: 'Legs' }] }]
    const plan = planFromJson(JSON.stringify(file))
    expect(plan.programs).toHaveLength(0)
    expect(plan.problems[0]!.message).toContain('Legs')
  })

  it('rejects two entries on the same day and bad dates', () => {
    const file = JSON.parse(TWO)
    file.programs = [{ name: 'Clash', start_date: '2026-10-12', weeks: 1, schedule: [{ day: 'Mon', routine: 'Push' }, { day: 0, routine: 'Pull' }] }]
    expect(planFromJson(JSON.stringify(file)).problems[0]!.message).toContain('same day')
    const badDate = JSON.parse(TWO)
    badDate.programs = [{ name: 'BadDate', start_date: '12-10-2026', weeks: 1, schedule: [{ day: 'Mon', routine: 'Push' }] }]
    expect(planFromJson(JSON.stringify(badDate)).problems[0]!.message).toContain('YYYY-MM-DD')
  })
})

describe('executeTrainingImport', () => {
  // The writer rides the real saveRoutine/saveProgram against the node
  // DbAdapter (the same harness the training package's own tests use).
  it('writes routines then programs, resolving file references to fresh ids', async () => {
    const { openMemoryDb } = await import('@nutai/db-adapter/node')
    const { migrate } = await import('@nutai/db-adapter')
    const handle = openMemoryDb()
    await migrate(handle, 1000)

    const parsed = parseTrainingImportJson(TRAINING_IMPORT_EXAMPLE)
    if (!parsed.ok) throw new Error(parsed.error)
    // The plan must be built against the REAL seeded catalog, exactly like
    // the screen does (listExercises after boot).
    const { seedExercises } = await import('@nutai/training')
    await seedExercises(handle)
    const rows = await handle.all<{ id: number; name: string; tracking_type: string }>(
      'SELECT id, name, tracking_type FROM exercises WHERE deleted_at IS NULL',
    )
    const realCatalog = {
      exercises: rows.map((r) => ({ id: r.id, name: r.name, aliases: [] as string[], tracking_type: r.tracking_type as never })),
      existingRoutines: [],
    }
    const plan = buildTrainingImportPlan(parsed.parsed, realCatalog)
    expect(plan.problems).toEqual([])

    const result = await executeTrainingImport(handle, plan)
    expect(result.errors).toEqual([])
    expect(result.routinesImported).toBe(2)
    expect(result.programsImported).toBe(1)

    const routines = await handle.all<{ name: string }>("SELECT name FROM routines WHERE deleted_at IS NULL ORDER BY name")
    expect(routines.map((r) => r.name)).toEqual(['Pull Day A', 'Push Day A'])
    const programRow = await handle.get<{ name: string; definition_json: string }>("SELECT name, definition_json FROM programs WHERE deleted_at IS NULL")
    if (!programRow) throw new Error('program row missing')
    expect(programRow.name).toBe('Autumn Block')
    const program = JSON.parse(programRow.definition_json)
    expect(program.schedule).toHaveLength(2)
    expect(program.schedule[0]!.day).toBe(0)
    // The program's routine_id points at the freshly inserted Push Day A.
    const pushId = (await handle.get<{ id: number }>("SELECT id FROM routines WHERE name='Push Day A'"))!.id
    expect(program.schedule[0]!.routine_id).toBe(pushId)
  })
})

describe('import wiring (source sweeps — the RN screen cannot mount in node)', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { dirname, join } = require('node:path') as typeof import('node:path')
  const { fileURLToPath } = require('node:url') as typeof import('node:url')
  const here = dirname(fileURLToPath(import.meta.url))
  const read = (...parts: string[]) => readFileSync(join(here, ...parts), 'utf8')

  it('the screen runs the full pipeline and writes through the engine', () => {
    const screen = read('..', '..', 'app', 'import-training.tsx')
    expect(screen).toContain('parseTrainingImportJson(raw)')
    expect(screen).toContain('buildTrainingImportPlan(parsed.parsed, catalog)')
    expect(screen).toContain('executeTrainingImport(handle, plan)')
    expect(screen).toContain('TRAINING_IMPORT_EXAMPLE')
  })

  it('the example constant is exactly what the parser accepts', () => {
    const result = parseTrainingImportJson(TRAINING_IMPORT_EXAMPLE)
    expect(result.ok).toBe(true)
  })

  it('both entry points route to /import-training', () => {
    expect(read('..', '..', 'app', 'settings-data.tsx')).toContain("'/import-training'")
    expect(read('..', '..', 'app', '(tabs)', 'train.tsx')).toContain("'/import-training'")
  })
})
