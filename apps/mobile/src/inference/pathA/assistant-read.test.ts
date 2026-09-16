import { describe, expect, it, vi } from 'vitest'
import { runAssistantChat } from './assistant'

vi.mock('../../data/repo', () => ({
  db: vi.fn(async () => ({
    all: vi.fn(async () => [{ name: 'bench press', kcal: 300 }])
  })),
  logExercise: vi.fn(),
  dayTotals: vi.fn(async () => ({ protein_g: 100, carbs_g: 200, fat_g: 50, kcal: 2000 })),
  getDayStatus: vi.fn(async (date) => ({ completion: date.includes('01') ? 'fasting' : 'complete' })),
}))

describe('assistant read tools', () => {
  it('Given "what was my last bench press?", then the assistant returns a structured workout card.', async () => {
    const mockExecute = vi.fn(async () => '{"tool_name": "get_last_workout", "arguments": {"exercise_name": "bench press"}}')

    const result = await runAssistantChat('what was my last bench press?', mockExecute)

    expect(result.toolCard).toBeDefined()
    expect(result.toolCard?.tool_name).toBe('get_last_workout')
    expect(result.toolCard?.data.name).toBe('bench press')
  })

  it('Given "how much protein last week?", then excluded days are shown.', async () => {
    // Just mock the provider response
    const mockExecute = vi.fn(async () => '{"tool_name": "get_nutrition_summary", "arguments": {"timeframe": "last_week"}}')

    const result = await runAssistantChat('how much protein last week?', mockExecute)

    expect(result.toolCard).toBeDefined()
    expect(result.toolCard?.tool_name).toBe('get_nutrition_summary')
    expect(result.toolCard?.data.excludedDays).toBeDefined()
  })
})
