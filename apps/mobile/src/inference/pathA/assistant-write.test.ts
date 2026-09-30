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

  it('Given "log 2 rotis", then a meal proposal uses Food Review-compatible payload.', async () => {
    const mockExecute = vi.fn(async () => '{"tool_name": "propose_meal", "arguments": {"name": "Lunch", "ingredients": [{"name": "Roti", "grams": 80}]}}')

    const result = await runAssistantChat('log 2 rotis', mockExecute)

    expect(result.toolCard).toBeDefined()
    expect(result.toolCard?.tool_name).toBe('propose_meal')
    expect(result.toolCard?.data.name).toBe('Lunch')
    expect(result.toolCard?.data.ingredients[0].name).toBe('Roti')
  })

  it('Given "remove the roti", then a structured correction is PROPOSED for confirmation, never applied.', async () => {
    const mockExecute = vi.fn(async () => JSON.stringify({
      tool_name: 'correct_logged_meal',
      arguments: {
        operations: [{ type: 'remove_item', id: 'm1i2' }],
        clarification_needed: null,
      },
    }))

    const result = await runAssistantChat('remove the roti', mockExecute)

    expect(result.toolCard).toBeDefined()
    expect(result.toolCard?.tool_name).toBe('correct_logged_meal')
    expect(result.toolCard?.data.operations[0]).toEqual({ type: 'remove_item', id: 'm1i2' })
    // AIP-004: the card carries the proposal only — applying it is the
    // confirmation UI's job through the operation log, never this loop's.
    expect(result.text).toBeUndefined()
  })

  it('one malformed operation does not sink the valid ones (per-op validation).', async () => {
    const mockExecute = vi.fn(async () => JSON.stringify({
      tool_name: 'correct_logged_meal',
      arguments: {
        operations: [
          { type: 'update_quantity', id: 'm1i1', grams: 80, qualitative_size: null },
          { type: 'explode' },
        ],
        clarification_needed: null,
      },
    }))

    const result = await runAssistantChat('make it 2 rotis not 3', mockExecute)

    expect(result.toolCard).toBeDefined()
    expect(result.toolCard?.data.operations).toHaveLength(1)
    expect(result.toolCard?.data.operations[0].type).toBe('update_quantity')
  })

  it('an empty, unclarified correction degrades to an honest clarification prompt.', async () => {
    const mockExecute = vi.fn(async () => JSON.stringify({
      tool_name: 'correct_logged_meal',
      arguments: { operations: [], clarification_needed: null },
    }))

    const result = await runAssistantChat('fix my lunch', mockExecute)

    expect(result.toolCard).toBeDefined()
    expect(result.toolCard?.data.operations).toHaveLength(0)
    expect(typeof result.toolCard?.data.clarification_needed).toBe('string')
  })

  it('conversation history is replayed to the provider with the context block.', async () => {
    const mockExecute = vi.fn(async (_system: string, user: string, history?: { role: string; content: string }[]) => {
      expect(history).toEqual([{ role: 'user', content: 'hi' }])
      expect(user).toContain('[TODAY IN THE USER')
      expect(user).toContain('[USER MESSAGE]')
      expect(user).toContain('what did I eat')
      return 'plain answer'
    })

    const result = await runAssistantChat('what did I eat today?', mockExecute, [{ role: 'user', content: 'hi' }])
    expect(result.text).toBe('plain answer')
  })
})
