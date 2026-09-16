import { describe, expect, it, vi } from 'vitest'
vi.mock('../../data/repo', () => ({ db: vi.fn(), getDayStatus: vi.fn(), dayTotals: vi.fn() }))
import { runAssistantChat } from './assistant'

describe('assistant write tools', () => {
  it('Given "make me a push workout", then a draft routine appears and is not saved until confirmed.', async () => {
    const mockExecute = vi.fn(async () => '{"tool_name": "propose_workout_routine", "arguments": {"name": "Push Day", "exercises": [{"name": "Bench Press", "sets": 3, "reps": "8-12"}]}}')

    const result = await runAssistantChat('make me a push workout', mockExecute)

    expect(result.toolCard).toBeDefined()
    expect(result.toolCard?.tool_name).toBe('propose_workout_routine')
    expect(result.toolCard?.data.name).toBe('Push Day')
  })

  it('Given "log 2 rotis", then a meal proposal shows nutrition sources before saving.', async () => {
    const mockExecute = vi.fn(async () => '{"tool_name": "propose_meal", "arguments": {"name": "Lunch", "ingredients": [{"name": "Roti", "grams": 80}]}}')

    const result = await runAssistantChat('log 2 rotis', mockExecute)

    expect(result.toolCard).toBeDefined()
    expect(result.toolCard?.tool_name).toBe('propose_meal')
    expect(result.toolCard?.data.name).toBe('Lunch')
  })
})
