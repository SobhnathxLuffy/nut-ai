/**
 * O9 (Wave 5B) — synthetic `reasoning_content` stream fixture.
 *
 * A recorded-shape (hand-built, no network) OpenAI-compatible SSE transcript
 * in the DeepSeek/Qwen/GLM thinking-model dialect the Path A chat stream
 * actually consumes: multi-chunk `reasoning_content` deltas INTERLEAVED with
 * `content` deltas, a role-only first chunk, a `finish_reason` + `usage` final
 * chunk, and `[DONE]`. Before this fixture existed, every reasoning_content
 * test inlined its own two-line stream — nothing exercised a full
 * reasoning-heavy reply end to end through the real parser.
 *
 * Both strings are byte-stable: the deltas are JSON.stringify'd at module
 * load, so the wire form can never drift from the JSON the parser parses.
 */

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}`

/**
 * The reasoning-heavy reply. Delta order is deliberately interleaved (reasoning
 * bursts both before and after visible text started) — lane separation must
 * hold, not just "reasoning first, then answer".
 */
export const REASONING_STREAM_SSE =
  sse({ choices: [{ delta: { role: 'assistant', content: '' } }] }) + '\n\n' +
  sse({ choices: [{ delta: { reasoning_content: 'Okay, the user asks' } }] }) + '\n\n' +
  sse({ choices: [{ delta: { reasoning_content: ' for a high-protein lunch.' } }] }) + '\n\n' +
  sse({ choices: [{ delta: { content: 'Try ' } }] }) + '\n\n' +
  sse({ choices: [{ delta: { reasoning_content: ' Keep it under 600 kcal.' } }] }) + '\n\n' +
  sse({ choices: [{ delta: { content: 'grilled ' } }] }) + '\n\n' +
  sse({ choices: [{ delta: { content: 'chicken with rice.' } }] }) + '\n\n' +
  sse({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 42 } }) + '\n\n' +
  'data: [DONE]\n\n'

/** Expected reassembly of the lanes (what runXhrStream accumulates). */
export const REASONING_STREAM_EXPECTED = {
  reasoning: 'Okay, the user asks for a high-protein lunch. Keep it under 600 kcal.',
  text: 'Try grilled chicken with rice.',
}

/** The deltas the parser must emit, in arrival order, one lane per delta. */
export const REASONING_STREAM_DELTAS: Array<{ text?: string; reasoning?: string }> = [
  { reasoning: 'Okay, the user asks' },
  { reasoning: ' for a high-protein lunch.' },
  { text: 'Try ' },
  { reasoning: ' Keep it under 600 kcal.' },
  { text: 'grilled ' },
  { text: 'chicken with rice.' },
]

/**
 * Degradation twin: the SAME wire shape from a provider/model that never sends
 * reasoning_content (plain gpt-4o-mini class). The reasoning lane must simply
 * stay empty — no error, no synthetic thinking text, behavior identical to
 * pre-reasoning days.
 */
export const PLAIN_STREAM_SSE =
  sse({ choices: [{ delta: { role: 'assistant', content: '' } }] }) + '\n\n' +
  sse({ choices: [{ delta: { content: 'Try ' } }] }) + '\n\n' +
  sse({ choices: [{ delta: { content: 'grilled ' } }] }) + '\n\n' +
  sse({ choices: [{ delta: { content: 'chicken with rice.' } }] }) + '\n\n' +
  sse({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 42 } }) + '\n\n' +
  'data: [DONE]\n\n'

export const PLAIN_STREAM_EXPECTED = {
  reasoning: '',
  text: 'Try grilled chicken with rice.',
}

/**
 * The same reply as a NON-streamed completion body — the shape a gateway that
 * ignores stream:true returns (reasoning_content rides the message, usage on
 * the envelope). Used to pin the full-body extraction path alongside the
 * stream path.
 */
export const REASONING_FULL_BODY = JSON.stringify({
  choices: [{ message: { role: 'assistant', content: REASONING_STREAM_EXPECTED.text, reasoning_content: REASONING_STREAM_EXPECTED.reasoning }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 42 },
})
