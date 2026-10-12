/**
 * Bulk JSON import for routines & programs (owner request, 2026-10-12).
 *
 * The app creates routines/programs one at a time in their editors; a user
 * arriving from a spreadsheet, a coach's plan or a previous install had no
 * way to bring a SET of them in at once. This module owns the whole pipeline:
 *
 *   1. `parseTrainingImportJson` — JSON.parse + envelope shape (strict format
 *      tag so a backup file pasted here fails loudly, not weirdly).
 *   2. `buildTrainingImportPlan` — resolves exercises by NAME (ids are
 *      install-dependent; names are the stable contract), validates every
 *      set against the exercise's real tracking type via the ENGINE's own
 *      validateSet, and resolves program schedule references. Pure: it takes
 *      catalogs in, so the node test suite can exercise every path.
 *   3. `executeTrainingImport` — writes through saveRoutine/saveProgram so
 *      every import rides the same zod gates, transactions and undo ledger
 *      as a hand-made row. One failed item never aborts the batch; its
 *      error lands in the result.
 *
 * The module stays NODE-PURE (no react-native, no expo-sqlite, no repo.ts):
 * DbAdapter is a type-only import and the writers come from @nutai/training.
 */
import {
  ProgramInput,
  ProgressionRule,
  SetValues,
  validateSet,
  type TrackingType,
} from '@nutai/core-schema'
import type { DbAdapter } from '@nutai/db-adapter'
import { saveProgram, saveRoutine, weekdayToCycleDay } from '@nutai/training'

export const TRAINING_IMPORT_FORMAT = 'nutai.training-import'
export const TRAINING_IMPORT_VERSION = 1

/** Hard sane caps for one file (the editors cap routines at 100 exercises). */
const MAX_ROUTINES = 100
const MAX_PROGRAMS = 100
const MAX_EXERCISES_PER_ROUTINE = 100

/** What the plan builder needs to know about the exercise catalog. */
export interface ExerciseCatalogEntry {
  id: number
  name: string
  aliases: readonly string[]
  tracking_type: TrackingType
}

export interface RoutineCatalogEntry {
  id: number
  name: string
}

export interface TrainingImportContext {
  exercises: readonly ExerciseCatalogEntry[]
  existingRoutines: readonly RoutineCatalogEntry[]
}

/** Raw (already JSON-parsed) routine entry from the file. */
interface RawRoutine {
  name: unknown
  exercises: unknown
}

interface RawProgram {
  name: unknown
  start_date: unknown
  weeks: unknown
  schedule: unknown
}

export interface ParsedTrainingImport {
  routines: RawRoutine[]
  programs: RawProgram[]
}

export type TrainingImportParseResult =
  | { ok: false; error: string }
  | { ok: true; parsed: ParsedTrainingImport }

export interface PlannedRoutine {
  name: string
  input: unknown
}

/** One resolved schedule entry: a routine from this file, or an existing one. */
export type PlannedScheduleEntry =
  | { day: number; kind: 'file'; routineName: string }
  | { day: number; kind: 'existing'; routineId: number }

export interface PlannedProgram {
  name: string
  startDate: string
  weeks: number
  schedule: PlannedScheduleEntry[]
}

/** A per-item problem that did NOT block the plan (the item is dropped). */
export interface ImportProblem {
  ref: string
  message: string
}

export interface TrainingImportPlan {
  routines: PlannedRoutine[]
  programs: PlannedProgram[]
  problems: ImportProblem[]
}

// ---------------------------------------------------------------------------
// 1. Parse
// ---------------------------------------------------------------------------

export function parseTrainingImportJson(raw: string): TrainingImportParseResult {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: `That is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'The import must be a JSON object with "routines" and/or "programs" arrays.' }
  }
  const envelope = value as Record<string, unknown>
  if (envelope.format !== TRAINING_IMPORT_FORMAT) {
    return {
      ok: false,
      error: `Missing "format": "${TRAINING_IMPORT_FORMAT}". This keeps a full-backup file from being imported here by mistake.`,
    }
  }
  if (envelope.version !== TRAINING_IMPORT_VERSION) {
    return { ok: false, error: `Unsupported "version": ${JSON.stringify(envelope.version)} — this app imports version ${TRAINING_IMPORT_VERSION}.` }
  }
  const routines = envelope.routines ?? []
  const programs = envelope.programs ?? []
  if (!Array.isArray(routines) || !Array.isArray(programs)) {
    return { ok: false, error: '"routines" and "programs" must be arrays (they may be empty).' }
  }
  if (routines.length === 0 && programs.length === 0) {
    return { ok: false, error: 'Nothing to import: both "routines" and "programs" are empty.' }
  }
  if (routines.length > MAX_ROUTINES) {
    return { ok: false, error: `Too many routines in one file (${routines.length}) — the cap is ${MAX_ROUTINES}. Split the file.` }
  }
  if (programs.length > MAX_PROGRAMS) {
    return { ok: false, error: `Too many programs in one file (${programs.length}) — the cap is ${MAX_PROGRAMS}. Split the file.` }
  }
  return { ok: true, parsed: { routines: routines as RawRoutine[], programs: programs as RawProgram[] } }
}

// ---------------------------------------------------------------------------
// 2. Plan (pure resolution + validation)
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** 'Mon' / 'Monday' / 'mon' → the calendar weekday index (0 = Sunday), or null. */
export function weekdayIndexFromText(value: string): number | null {
  const norm = value.trim().toLowerCase()
  if (norm.length < 3) return null
  const found = WEEKDAY_NAMES.findIndex((name) => name.startsWith(norm))
  return found === -1 ? null : found
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolveExerciseRef(
  ref: unknown,
  catalog: TrainingImportContext,
): { ok: true; entry: ExerciseCatalogEntry } | { ok: false; message: string } {
  if (typeof ref === 'number' && Number.isInteger(ref) && ref > 0) {
    const byId = catalog.exercises.find((e) => e.id === ref)
    return byId
      ? { ok: true, entry: byId }
      : { ok: false, message: `No exercise with id ${ref}. Prefer names — ids are install-dependent.` }
  }
  const name = nonEmptyString(ref)
  if (!name) return { ok: false, message: 'Each exercise needs a "exercise" name (or a numeric "exercise_id").' }
  const lower = name.toLowerCase()
  const byName = catalog.exercises.find((e) => e.name.toLowerCase() === lower)
  if (byName) return { ok: true, entry: byName }
  const byAlias = catalog.exercises.find((e) => e.aliases.some((a) => a.toLowerCase() === lower))
  if (byAlias) return { ok: true, entry: byAlias }
  return {
    ok: false,
    message: `Exercise "${name}" is not in the library. Check the spelling against the Train tab's Exercise library, or create it as a custom exercise first.`,
  }
}

/**
 * One planned set. Only the fields the tracking type needs are required;
 * bodyweight/assisted sets may omit the added-weight field (it defaults to
 * 0 — bodyweight, no assistance), everything else must be stated.
 */
function normalizeSet(rawSet: unknown, trackingType: TrackingType, exerciseName: string, setIndex: number): unknown {
  if (typeof rawSet !== 'object' || rawSet === null || Array.isArray(rawSet)) {
    throw new Error(`set ${setIndex + 1} must be an object like {"load_kg": 60, "reps": 8}`)
  }
  const candidate: Record<string, unknown> = { ...(rawSet as Record<string, unknown>) }
  if (trackingType === 'bodyweight_reps' && candidate.load_kg === undefined) candidate.load_kg = 0
  if (trackingType === 'assisted' && candidate.assistance_kg === undefined) candidate.assistance_kg = 0
  // The engine's own gate — identical to the editor's save path, so the
  // import can never write a set the editor would reject.
  validateSet(trackingType, SetValues.parse(candidate), true)
  return candidate
}

export function buildTrainingImportPlan(parsed: ParsedTrainingImport, catalog: TrainingImportContext): TrainingImportPlan {
  const problems: ImportProblem[] = []
  const routines: PlannedRoutine[] = []
  const plannedRoutineNames = new Set<string>()

  for (const [index, raw] of parsed.routines.entries()) {
    const ref = `Routine ${index + 1}`
    try {
      const name = nonEmptyString(raw.name)
      if (!name) throw new Error('needs a "name"')
      if (plannedRoutineNames.has(name.toLowerCase())) throw new Error(`the name "${name}" appears twice in this file`)
      if (!Array.isArray(raw.exercises) || raw.exercises.length === 0) throw new Error('needs at least one exercise in "exercises"')
      if (raw.exercises.length > MAX_EXERCISES_PER_ROUTINE) throw new Error(`has ${raw.exercises.length} exercises — the cap is ${MAX_EXERCISES_PER_ROUTINE}`)

      const exercises = raw.exercises.map((rawEx, exIndex) => {
        if (typeof rawEx !== 'object' || rawEx === null || Array.isArray(rawEx)) {
          throw new Error(`exercise ${exIndex + 1} must be an object`)
        }
        const ex = rawEx as Record<string, unknown>
        const resolved = resolveExerciseRef(ex.exercise ?? ex.exercise_id, catalog)
        if (!resolved.ok) throw new Error(resolved.message)
        if (!Array.isArray(ex.sets) || ex.sets.length === 0) {
          throw new Error(`"${resolved.entry.name}" needs at least one set in "sets"`)
        }
        if (ex.sets.length > 100) throw new Error(`"${resolved.entry.name}" has ${ex.sets.length} sets — the cap is 100`)
        const sets = ex.sets.map((s, setIndex) => normalizeSet(s, resolved.entry.tracking_type, resolved.entry.name, setIndex))
        const ruleRaw = ex.rule ?? { kind: 'double' }
        const rule = ProgressionRule.parse(ruleRaw)
        let group: string | null = null
        if (ex.group != null) {
          const g = nonEmptyString(ex.group)
          if (!g) throw new Error(`"${resolved.entry.name}" has an empty "group" — use a letter like "A" or null`)
          group = g
        }
        let restSeconds: number | null | undefined
        if (ex.rest_seconds != null) {
          const r = ex.rest_seconds
          if (typeof r !== 'number' || !Number.isInteger(r) || r < 0 || r > 600) {
            throw new Error(`"${resolved.entry.name}" rest_seconds must be a whole number 0–600`)
          }
          restSeconds = r
        }
        return { exercise_id: resolved.entry.id, group, sets, rule, ...(restSeconds !== undefined ? { rest_seconds: restSeconds } : {}) }
      })

      plannedRoutineNames.add(name.toLowerCase())
      routines.push({ name, input: { name, exercises } })
    } catch (e) {
      problems.push({ ref, message: e instanceof Error ? e.message : String(e) })
    }
  }

  const programs: PlannedProgram[] = []
  const plannedProgramNames = new Set<string>()

  for (const [index, raw] of parsed.programs.entries()) {
    const ref = `Program ${index + 1}`
    try {
      const name = nonEmptyString(raw.name)
      if (!name) throw new Error('needs a "name"')
      if (plannedProgramNames.has(name.toLowerCase())) throw new Error(`the name "${name}" appears twice in this file`)
      if (typeof raw.start_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.start_date)) {
        throw new Error('needs "start_date" as YYYY-MM-DD (the day Week 1 Day 0 falls on)')
      }
      if (typeof raw.weeks !== 'number' || !Number.isInteger(raw.weeks) || raw.weeks < 1 || raw.weeks > 104) {
        throw new Error('needs "weeks" as a whole number 1–104')
      }
      if (!Array.isArray(raw.schedule) || raw.schedule.length === 0) {
        throw new Error('needs at least one entry in "schedule"')
      }
      if (raw.schedule.length > 7) throw new Error('"schedule" has more than 7 entries — one routine per day of the week')

      const schedule: PlannedScheduleEntry[] = raw.schedule.map((rawEntry, dayIndex) => {
        if (typeof rawEntry !== 'object' || rawEntry === null || Array.isArray(rawEntry)) {
          throw new Error(`schedule entry ${dayIndex + 1} must be an object like {"day": "Mon", "routine": "Push Day A"}`)
        }
        const entry = rawEntry as Record<string, unknown>
        // "day" speaks BOTH languages the app speaks: a weekday string
        // ("Mon") means the calendar weekday, converted against start_date
        // exactly like the programs editor; a number 0–6 is the stored
        // cycle day (0 = the start date itself).
        let cycleDay: number
        if (typeof entry.day === 'string') {
          const weekday = weekdayIndexFromText(entry.day)
          if (weekday === null) throw new Error(`schedule entry ${dayIndex + 1}: "day" must be a weekday like "Mon"`)
          cycleDay = weekdayToCycleDay(weekday, raw.start_date as string)
        } else if (typeof entry.day === 'number' && Number.isInteger(entry.day) && entry.day >= 0 && entry.day <= 6) {
          cycleDay = entry.day
        } else {
          throw new Error(`schedule entry ${dayIndex + 1}: "day" must be a weekday name ("Mon") or a cycle day 0–6`)
        }
        // "routine": a name from THIS file (routines resolve in file order),
        // a name of an existing routine, or a numeric routine_id.
        if (typeof entry.routine === 'number' && Number.isInteger(entry.routine) && entry.routine > 0) {
          const exists = catalog.existingRoutines.some((r) => r.id === entry.routine)
          if (!exists) throw new Error(`schedule entry ${dayIndex + 1}: no existing routine with id ${entry.routine}`)
          return { day: cycleDay, kind: 'existing' as const, routineId: entry.routine }
        }
        const routineName = nonEmptyString(entry.routine)
        if (!routineName) throw new Error(`schedule entry ${dayIndex + 1}: needs "routine" (a routine name or id)`)
        const lower = routineName.toLowerCase()
        const inFile = plannedRoutineNames.has(lower) || parsed.routines.some((r) => nonEmptyString(r.name)?.toLowerCase() === lower)
        if (inFile) return { day: cycleDay, kind: 'file' as const, routineName }
        const existing = catalog.existingRoutines.find((r) => r.name.toLowerCase() === lower)
        if (existing) return { day: cycleDay, kind: 'existing' as const, routineId: existing.id }
        throw new Error(`schedule entry ${dayIndex + 1}: routine "${routineName}" is neither in this file nor among your existing routines`)
      })

      // Uniqueness across the resolved cycle days (the engine's own refine
      // checks the same thing; failing here gives a friendlier ref).
      const seenDays = new Set<number>()
      for (const s of schedule) {
        if (seenDays.has(s.day)) throw new Error('two schedule entries land on the same day — one routine per day')
        seenDays.add(s.day)
      }

      plannedProgramNames.add(name.toLowerCase())
      programs.push({ name, startDate: raw.start_date, weeks: raw.weeks, schedule })
    } catch (e) {
      problems.push({ ref, message: e instanceof Error ? e.message : String(e) })
    }
  }

  return { routines, programs, problems }
}

// ---------------------------------------------------------------------------
// 3. Execute (db-bound)
// ---------------------------------------------------------------------------

export interface TrainingImportResult {
  routinesImported: number
  programsImported: number
  /** Per-item failures that happened at write time (zod, missing row, ...). */
  errors: string[]
}

/**
 * Writes the plan through saveRoutine/saveProgram — the SAME writers the
 * editors use, so zod gates, transactions and the undo ledger all apply.
 * Routine ids land before programs resolve their file references; a routine
 * that failed to write drops only the programs that referenced it.
 */
export async function executeTrainingImport(
  handle: DbAdapter,
  plan: TrainingImportPlan,
  now = Date.now(),
): Promise<TrainingImportResult> {
  const result: TrainingImportResult = { routinesImported: 0, programsImported: 0, errors: [] }
  const writtenIds = new Map<string, number>()

  for (const routine of plan.routines) {
    try {
      const id = await saveRoutine(handle, routine.input, undefined, now)
      writtenIds.set(routine.name.toLowerCase(), id)
      result.routinesImported++
    } catch (e) {
      result.errors.push(`Routine "${routine.name}": ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  for (const program of plan.programs) {
    try {
      const schedule: Array<{ day: number; routine_id: number }> = []
      let dropped = false
      for (const entry of program.schedule) {
        if (entry.kind === 'existing') {
          schedule.push({ day: entry.day, routine_id: entry.routineId })
          continue
        }
        const id = writtenIds.get(entry.routineName.toLowerCase())
        if (id == null) {
          result.errors.push(
            `Program "${program.name}" was not imported: its routine "${entry.routineName}" failed above.`,
          )
          dropped = true
          break
        }
        schedule.push({ day: entry.day, routine_id: id })
      }
      if (dropped) continue
      await saveProgram(
        handle,
        ProgramInput.parse({ name: program.name, start_date: program.startDate, weeks: program.weeks, schedule }),
        undefined,
        now,
      )
      result.programsImported++
    } catch (e) {
      result.errors.push(`Program "${program.name}": ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}
