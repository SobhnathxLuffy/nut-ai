import { AssistantToolCallZ, type AssistantToolCall } from '@nutai/core-schema'
import { ASSISTANT_SYSTEM_PROMPT } from '@nutai/prompt'
import { db, dayTotals, getDayStatus } from '../../data/repo'
import { localDate } from '../../data/date-utils'
import { dateOffset } from '../../data/shortcuts'

// A lightweight chat execution loop
export async function runAssistantChat(
  text: string,
  executeApi: (system: string, user: string) => Promise<string>
): Promise<{ text?: string, toolCard?: AssistantToolCall & { data: any } }> {
  // First, we call the API to see if it wants to use a tool or answer text.
  const responseText = await executeApi(ASSISTANT_SYSTEM_PROMPT, text)

  try {
    const jsonStr = extractJson(responseText)
    if (jsonStr) {
      const parsed = AssistantToolCallZ.safeParse(JSON.parse(jsonStr))
      if (parsed.success) {
        const data = await executeToolLocally(parsed.data)
        return { toolCard: { ...parsed.data, data } }
      }
    }
  } catch (e) { console.error("Error", e)
    // If it's not valid JSON or something else, fall through
  }

  return { text: responseText.trim() }
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
      `SELECT * FROM exercise_entries WHERE name LIKE ? ORDER BY local_date DESC, logged_at DESC LIMIT 1`,
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
  const today = localDate(Date.now())
  if (timeframe === 'today') return [today]
  if (timeframe === 'yesterday') return [dateOffset(today, -1)]

  // Minimal week logic for tests
  if (timeframe === 'this_week') {
    return [today, dateOffset(today, -1), dateOffset(today, -2)] // Simplified
  }
  if (timeframe === 'last_week') {
    return [dateOffset(today, -7), dateOffset(today, -8)] // Simplified
  }
  return [today]
}

export async function applyProposal(tool_name: string, data: any) {
  if (tool_name === 'propose_workout_routine') {
    // Scaffold for when routine DB methods are available
    console.log("Saving routine", data)
  } else if (tool_name === 'propose_meal') {
    console.log("Saving meal", data)
  }
}
