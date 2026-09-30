import { AssistantToolCallZ, type AssistantToolCall } from '@nutai/core-schema'
import { CorrectionOperationZ, SetValues, TRACKING_FIELDS, type RoutineInput, type TrackingType } from '@nutai/core-schema'
import { ASSISTANT_SYSTEM_PROMPT } from '@nutai/prompt'
import { listExercises, saveRoutine } from '@nutai/training'
import { db, dayTotals, getDayStatus, mealsForDay, currentGoal } from '../../data/repo'
import { localDate, getThisWeek, getLastWeek } from '../../data/date-utils'
import { dateOffset } from '../../data/shortcuts'
import type { ChatTurn } from './client'

// A lightweight chat execution loop
export type AssistantReply = { text?: string; toolCard?: AssistantToolCall & { data: any } }

/**
 * The prompt half of one chat turn: system prompt + today-context + user text.
 * Split out of runAssistantChat so the UI can drive its own STREAMING call and
 * still share the exact same prompt assembly.
 */
export async function buildAssistantTurn(
  text: string,
  now: number = Date.now(),
): Promise<{ system: string; user: string }> {
  // Today's log/goals ride along with every message — the model must never
  // answer "what did I eat" from memory when the app's own data is one block away.
  const context = await buildTodayContext(now)
  return {
    system: ASSISTANT_SYSTEM_PROMPT,
    user: context ? `${context}\n\n[USER MESSAGE]\n${text}` : text,
  }
}

/**
 * The reply half of one chat turn: a tool call JSON is executed against local
 * data and becomes a card; anything else is the visible answer text.
 */
export async function parseAssistantReply(responseText: string): Promise<AssistantReply> {
  try {
    const jsonStr = extractJson(responseText)
    if (jsonStr) {
      const parsed = AssistantToolCallZ.safeParse(JSON.parse(jsonStr))
      if (parsed.success) {
        const data = await executeToolLocally(parsed.data)
        return { toolCard: { ...parsed.data, data } }
      }
    }
  } catch (e) {
    console.error('Error', e)
    // If it's not valid JSON or something else, fall through
  }
  return { text: responseText.trim() }
}

export async function runAssistantChat(
  text: string,
  executeApi: (system: string, user: string, history?: ChatTurn[]) => Promise<string>,
  history: ChatTurn[] = []
): Promise<AssistantReply> {
  // First, we call the API to see if it wants to use a tool or answer text.
  const { system, user } = await buildAssistantTurn(text)
  const responseText = await executeApi(system, user, history)
  return parseAssistantReply(responseText)
}

function extractJson(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end >= start) {
    return text.slice(start, end + 1)
  }
  return null
}

async function executeToolLocally(tool: AssistantToolCall): Promise<any> {
  if (tool.tool_name === 'get_last_workout') {
    const h = await db()
    const rows = await h.all(
      `SELECT w.id, w.name, w.local_date, w.started_at, w.finished_at, w.status
       FROM workouts w
       JOIN workout_exercises we ON we.workout_id = w.id
       JOIN exercises e ON we.exercise_id = e.id
       WHERE e.name LIKE ? AND w.deleted_at IS NULL
       ORDER BY w.local_date DESC, w.started_at DESC LIMIT 1`,
      ['%' + tool.arguments.exercise_name + '%']
    )
    if (rows.length === 0) return null
    return rows[0]
  }

  if (tool.tool_name === 'propose_meal') {
    return {
      type: 'meal_proposal',
      name: tool.arguments.name,
      ingredients: tool.arguments.ingredients
    }
  }

  if (tool.tool_name === 'propose_workout_routine') {
    return {
      type: 'routine_proposal',
      name: tool.arguments.name,
      exercises: tool.arguments.exercises
    }
  }

  if (tool.tool_name === 'correct_logged_meal') {
    // AIP-004: the model PROPOSES operations; only the user's confirmation
    // applies them. Invalid-shaped operations are dropped here rather than at
    // apply time, so the confirmation card never promises something the app
    // cannot do.
    const rawOps = Array.isArray(tool.arguments.operations) ? tool.arguments.operations : []
    const operations = rawOps.filter((op: unknown) => CorrectionOperationZ.safeParse(op).success)
    const clarification = typeof tool.arguments.clarification_needed === 'string'
      ? tool.arguments.clarification_needed
      : null
    if (operations.length === 0 && !clarification) {
      return {
        type: 'logged_meal_correction',
        operations: [],
        clarification_needed: 'I could not match that to today\'s log. Try naming the food exactly as it appears in your log.',
      }
    }
    return { type: 'logged_meal_correction', operations, clarification_needed: clarification }
  }

  if (tool.tool_name === 'get_nutrition_summary') {
    const dates = resolveTimeframe(tool.arguments.timeframe)
    let protein = 0, carbs = 0, fat = 0, kcal = 0
    const excludedDays = []

    for (const d of dates) {
      const status = await getDayStatus(d)
      if (status?.completion === 'fasting') {
        excludedDays.push(d)
        continue
      }
      const totals = await dayTotals(d)
      protein += totals.protein_g
      carbs += totals.carbs_g
      fat += totals.fat_g
      kcal += totals.kcal
    }

    return {
      timeframe: tool.arguments.timeframe,
      dates,
      excludedDays,
      totals: { protein, carbs, fat, kcal }
    }
  }
}

function resolveTimeframe(timeframe: 'today' | 'yesterday' | 'this_week' | 'last_week'): string[] {
  const now = Date.now()
  const today = localDate(now)
  if (timeframe === 'today') return [today]
  if (timeframe === 'yesterday') return [dateOffset(today, -1)]

  if (timeframe === 'this_week') return getThisWeek(now)
  if (timeframe === 'last_week') return getLastWeek(now)
  return [today]
}

/** Tolerates both real rejections and bare-vi-fn mocks returning undefined. */
async function safe<T>(fn: () => T | Promise<T> | undefined): Promise<T | null> {
  try {
    return ((await Promise.resolve(fn())) as T) ?? null
  } catch {
    return null
  }
}

/**
 * The today-context block appended to every user message: what is logged,
 * against which targets, and the EXACT item ids the correct_logged_meal tool
 * needs. Every read is individually guarded — a context failure degrades to
 * "no context", never to a failed chat.
 */
export async function buildTodayContext(now: number = Date.now()): Promise<string> {
  try {
    const date = localDate(now)
    const [totals, goal, meals, status] = await Promise.all([
      safe(() => dayTotals(date)),
      safe(() => currentGoal()),
      safe(() => mealsForDay(date)),
      safe(() => getDayStatus(date)),
    ])

    const lines: string[] = []
    lines.push(`[TODAY IN THE USER'S APP — ${date}]`)
    if (status?.completion === 'fasting') {
      lines.push('Day status: fasting.')
    } else if (totals && totals.mealCount > 0) {
      lines.push(
        `Logged so far: ${totals.mealCount} meal(s), ${Math.round(totals.kcal)} kcal, ` +
        `protein ${Math.round(totals.protein_g)} g, carbs ${Math.round(totals.carbs_g)} g, fat ${Math.round(totals.fat_g)} g.`
      )
      const logged = (meals ?? []).filter((m) => m.items.length > 0)
      if (logged.length > 0) {
        lines.push(
          'Logged items (use these EXACT ids with the correct_logged_meal tool if the user asks to change them):'
        )
        for (const meal of logged) {
          for (const item of meal.items) {
            lines.push(
              `- [ID m${meal.id}i${item.id}] ${item.displayName}, ${Math.round(item.grams)} g, ~${item.energyKcal} kcal (${meal.slot ?? 'meal'})`
            )
          }
        }
      }
    } else {
      lines.push('Nothing logged yet today.')
    }
    if (goal) {
      lines.push(
        `Daily targets: ${Math.round(goal.targetKcal)} kcal, protein ${Math.round(goal.protein_g)} g, ` +
        `carbs ${Math.round(goal.carbs_g)} g, fat ${Math.round(goal.fat_g)} g.`
      )
    }
    lines.push('[END TODAY CONTEXT]')
    return lines.join('\n')
  } catch {
    return ''
  }
}

export interface ProposalApplyResult {
  ok: boolean
  routineId?: number
  skippedExercises?: string[]
}

const num = (v: any): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * Build one planned set for an exercise's tracking type from an
 * assistant-provided spec. Returns null when the tracking type requires a
 * number the proposal did not provide (e.g. distance) — the app never invents
 * a number the model did not give us.
 */
function plannedSetFor(type: TrackingType, spec: any): SetValues | null {
  const fields = TRACKING_FIELDS[type]
  const distance = num(spec?.distance_m)
  if (fields.includes('distance_m') && !(distance !== null && distance > 0)) return null
  const set: Record<string, number | string | null> = {
    load_kg: null, reps: null, duration_s: null, distance_m: null,
    assistance_kg: null, rir: null, rpe: null, tempo: null,
  }
  // saveRoutine validates sets with completed=true, so load-bearing fields
  // must be non-null; load fields accept 0 as "user will decide".
  if (fields.includes('reps')) set.reps = num(spec?.reps) ?? 10
  if (fields.includes('load_kg')) set.load_kg = num(spec?.load_kg ?? spec?.weight_kg) ?? 0
  if (fields.includes('duration_s')) set.duration_s = num(spec?.duration_s) ?? 600
  if (fields.includes('distance_m')) set.distance_m = distance
  if (fields.includes('assistance_kg')) set.assistance_kg = num(spec?.assistance_kg) ?? 0
  return SetValues.parse(set)
}

/**
 * WEB-008 fix: applying a proposal used to be a console.log stub — the UI
 * flipped the routine card to "Saved" while nothing was written anywhere (a
 * false save, the exact class of bug the P0 list exists for). The proposal is
 * now matched against the user's exercise library, validated through
 * RoutineInput + saveRoutine (every planned set is checked against the
 * exercise's tracking type) and PERSISTED to the user DB. Failures throw so
 * the UI shows the real state instead of a fake success.
 */
export async function applyProposal(tool_name: string, data: any): Promise<ProposalApplyResult> {
  if (tool_name === 'propose_workout_routine') {
    const h = await db()
    const catalog = await listExercises(h)
    const byName = new Map(catalog.map((e) => [e.name.toLowerCase(), e]))
    const exercises: RoutineInput['exercises'] = []
    const skipped: string[] = []
    const proposals = Array.isArray(data?.exercises) ? data.exercises : []

    for (const raw of proposals) {
      const name = typeof raw === 'string' ? raw : raw?.name
      const match = name ? byName.get(String(name).trim().toLowerCase()) : undefined
      if (!match) {
        if (name) skipped.push(String(name))
        continue
      }

      // The model may express sets as a count ("sets": 3), a list of set
      // objects, or neither. "8-12" style rep ranges resolve to the lower
      // bound — the honest, achievable end of what the model said.
      const template = typeof raw === 'object' && raw !== null ? raw : {}
      const repsFromRange = typeof template.reps === 'string'
        ? Number(template.reps.match(/\d+/)?.[0] ?? NaN)
        : NaN
      const spec: any = {
        ...template,
        sets: undefined,
        reps: typeof template.reps === 'number'
          ? template.reps
          : Number.isFinite(repsFromRange) ? repsFromRange : undefined,
      }
      const setList = Array.isArray(template.sets) && template.sets.length > 0
        ? template.sets
        : null
      const count = typeof template.sets === 'number' && Number.isFinite(template.sets) && template.sets > 0
        ? Math.min(Math.floor(template.sets), 100)
        : setList ? setList.length : 3

      const sets: SetValues[] = []
      for (let s = 0; s < count; s++) {
        const item = setList ? setList[Math.min(s, setList.length - 1)] : {}
        const built = plannedSetFor(match.tracking_type, { ...spec, ...(typeof item === 'object' && item !== null ? item : {}) })
        if (!built) break
        sets.push(built)
      }
      if (sets.length === 0) {
        skipped.push(String(name))
        continue
      }
      exercises.push({
        exercise_id: match.id,
        group: null,
        sets,
        // ProgressionRule defaults (2.5kg increments, 8-12 reps, RIR 2) with a
        // manual start — the user adjusts progression when editing the routine.
        rule: { kind: 'manual', increment: 2.5, min_reps: 8, max_reps: 12, target_rir: 2 },
      })
    }

    if (exercises.length === 0) {
      throw new Error(
        skipped.length > 0
          ? `No exercises in your library match: ${skipped.join(', ')}`
          : 'The proposal contained no exercises from your library'
      )
    }

    const name = typeof data?.name === 'string' && data.name.trim()
      ? data.name.trim().slice(0, 120)
      : 'Assistant Routine'
    const routineId = await saveRoutine(h, { name, exercises })
    return skipped.length > 0
      ? { ok: true, routineId, skippedExercises: skipped }
      : { ok: true, routineId }
  }
  if (tool_name === 'propose_meal') {
    // Meal proposals are confirmed through the food-review flow
    // (resolveMealProposal -> /food-review), never saved here.
    throw new Error('Confirm the meal through the food review screen')
  }
  throw new Error(`Unsupported proposal type: ${tool_name}`)
}

export const assistantGlobalStatus: Record<string, string> = {};
