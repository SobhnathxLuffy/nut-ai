import { describe, expect, it, vi } from 'vitest'
import { runAssistantChat, parseAssistantReply, proseOutsideToolJson, stripStreamingToolJson } from './assistant'
import { dayTotals, getDayStatus } from '../../data/repo'

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

// ---------------------------------------------------------------------------
// Tool misroute (live browser E2E, Task 3): a nutrition-KNOWLEDGE question
// ("How much protein is in 100g of cooked toor dal?") came back as text PLUS a
// spurious get_nutrition_summary call; parseAssistantReply executed the tool
// and discarded the text, so the user saw TODAY'S LOG totals (0 kcal/0g) as
// the "answer". The text must win; the tool only runs when the reply IS the
// tool call alone.
// ---------------------------------------------------------------------------
describe('assistant tool misroute: text beats a spurious tool call', () => {
  it('Given a reply with real text AND a tool JSON, the text renders and the tool never executes.', async () => {
    vi.mocked(dayTotals).mockClear()
    vi.mocked(getDayStatus).mockClear()
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const reply =
      'Cooked toor dal has about 9–10 g of protein per 100 g (typical value).\n' +
      '{"tool_name": "get_nutrition_summary", "arguments": {"timeframe": "today"}}'

    const result = await parseAssistantReply(reply)

    expect(result.text).toBe('Cooked toor dal has about 9–10 g of protein per 100 g (typical value).')
    expect(result.toolCard).toBeUndefined()
    // The tool was discarded, not executed — today's log was never read.
    expect(dayTotals).not.toHaveBeenCalled()
    expect(getDayStatus).not.toHaveBeenCalled()
    // …and the discard is logged, never silent.
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('discarding tool "get_nutrition_summary"'),
    )
    debug.mockRestore()
  })

  it('Given a reply with ONLY the tool JSON, the tool executes and becomes a card.', async () => {
    vi.mocked(dayTotals).mockClear()
    vi.mocked(getDayStatus).mockClear()

    const result = await parseAssistantReply(
      '{"tool_name": "get_nutrition_summary", "arguments": {"timeframe": "today"}}',
    )

    expect(result.toolCard).toBeDefined()
    expect(result.toolCard?.tool_name).toBe('get_nutrition_summary')
    expect(result.text).toBeUndefined()
    expect(dayTotals).toHaveBeenCalled()
  })

  it('A tool JSON wrapped in markdown fences is still a tool-only reply (fences are not prose).', async () => {
    const result = await parseAssistantReply(
      '```json\n{"tool_name": "get_nutrition_summary", "arguments": {"timeframe": "today"}}\n```',
    )

    expect(result.toolCard).toBeDefined()
    expect(result.toolCard?.tool_name).toBe('get_nutrition_summary')
  })

  it('Preamble text plus a tool call renders the preamble, not an empty tool card.', async () => {
    const mockExecute = vi.fn(
      async () =>
        'Sure — here is your day so far.\n{"tool_name": "get_nutrition_summary", "arguments": {"timeframe": "today"}}',
    )

    const result = await runAssistantChat('how am I doing today?', mockExecute)

    expect(result.text).toBe('Sure — here is your day so far.')
    expect(result.toolCard).toBeUndefined()
  })

  it('Text AFTER the tool JSON is kept too — nothing the model said is lost.', () => {
    const json = '{"tool_name": "get_nutrition_summary", "arguments": {"timeframe": "today"}}'
    const reply = `${json}\nHope that helps!`

    expect(proseOutsideToolJson(reply, json)).toBe('Hope that helps!')
  })

  it('proseOutsideToolJson: fence-only and whitespace-only surroundings mean "tool only".', () => {
    const json = '{"tool_name": "get_last_workout", "arguments": {"exercise_name": "bench press"}}'
    expect(proseOutsideToolJson(json, json)).toBe('')
    expect(proseOutsideToolJson(`\`\`\`json\n${json}\n\`\`\``, json)).toBe('')
    expect(proseOutsideToolJson(`\n  ${json}  \n`, json)).toBe('')
  })

  it('stripStreamingToolJson: raw JSON never pours into a streaming bubble.', () => {
    // Plain prose streams untouched (word-reveal stays).
    expect(stripStreamingToolJson('Toor dal is a great source')).toEqual({
      text: 'Toor dal is a great source',
      toolJson: false,
    })
    // JSON starting at byte 0 (possibly still forming) is fully hidden.
    expect(stripStreamingToolJson('{"tool_na')).toEqual({ text: '', toolJson: true })
    // JSON arriving AFTER prose: the prose keeps streaming, the JSON is cut.
    expect(
      stripStreamingToolJson('Here is your summary: {"tool_name": "get_nutrition_summary", "argu'),
    ).toEqual({ text: 'Here is your summary:', toolJson: true })
    // A completed JSON tail is cut exactly the same way.
    expect(
      stripStreamingToolJson('Done.\n{"tool_name": "get_nutrition_summary", "arguments": {"timeframe": "today"}}'),
    ).toEqual({ text: 'Done.', toolJson: true })
  })
})
