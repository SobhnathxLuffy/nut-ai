vi.mock('../credentials', () => ({
  loadCredential: vi.fn(async (_) => ({ kind: 'api_key', value: 'fake-key' })),
}))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSseDeltaParser, extractFullCompletion, runAssistantChatApiStream } from './client'
import { loadCredential } from '../credentials'
import {
  PLAIN_STREAM_EXPECTED,
  PLAIN_STREAM_SSE,
  REASONING_STREAM_DELTAS,
  REASONING_STREAM_EXPECTED,
  REASONING_FULL_BODY,
  REASONING_STREAM_SSE,
} from './fixtures/reasoning-stream'

/**
 * O9 (Wave 5B) — the synthetic reasoning_content fixture, driven through the
 * REAL Path A machinery (no parser changes; this file pins current behavior).
 *
 * The fixture is a full DeepSeek/Qwen/GLM-dialect thinking reply: multi-chunk
 * reasoning_content interleaved with content deltas, a role-only opener, a
 * finish_reason + usage closer, and [DONE]. Three layers must agree:
 *   1. createSseDeltaParser (the public parser surface) splits the lanes and
 *      ignores role/finish/usage/[DONE] as deltas
 *   2. runAssistantChatApiStream reassembles text + reasoning and hands the
 *      assistant exactly the delta shape its patchStream consumes
 *      ({ text? } | { reasoning? }) plus the final outcome lanes
 *   3. providers that never send reasoning_content degrade to today's
 *      behavior — empty reasoning lane, no error
 */

/** Minimal XHR stand-in: the stream code only needs open/headers/responseText/events. */
class FakeXhr {
  status = 200
  responseText = ''
  responseType: string | undefined
  onprogress: (() => void) | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  aborts = 0
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn()
  abort() {
    this.aborts++
    this.onabort?.()
  }
}

/** Feed a full responseText to the stream in progressively-growing chunks. */
async function streamFixture(body: string) {
  vi.mocked(loadCredential).mockResolvedValue({ kind: 'api_key', value: 'sk-reasoning' } as never)
  const xhr = new FakeXhr()
  const deltas: Array<{ text?: string; reasoning?: string }> = []
  const done = runAssistantChatApiStream(
    { provider: 'openai', model: 'deepseek-reasoner', systemPrompt: 'sys', userPrompt: 'usr' },
    { onDelta: (d) => deltas.push(d) },
    () => xhr as unknown as XMLHttpRequest,
  )
  await vi.waitFor(() => {
    if (typeof xhr.onprogress !== 'function') throw new Error('xhr not wired yet')
  })
  // Grow responseText in awkward sizes (mid-JSON splits included); each
  // onprogress hands the parser only the NEW bytes.
  for (const end of [31, 97, 160, 260, 340, body.length]) {
    xhr.responseText = body.slice(0, end)
    xhr.onprogress!()
  }
  xhr.onload!()
  return { outcome: await done, deltas }
}

describe('reasoning_content fixture through the real SSE parser (O9, Wave 5B)', () => {
  beforeEach(() => {
    vi.mocked(loadCredential).mockResolvedValue({ kind: 'api_key', value: 'sk-reasoning' } as never)
  })

  it('splits the lanes in arrival order; role/finish/usage/[DONE] are not deltas', () => {
    const parse = createSseDeltaParser('openai')
    const deltas = parse(REASONING_STREAM_SSE)
    expect(deltas).toEqual(REASONING_STREAM_DELTAS)
    // Exactly one lane per delta — the shape assistant.tsx's patchStream
    // appends by (a delta never carries both lanes).
    for (const d of deltas) expect(Object.keys(d)).toHaveLength(1)
  })

  it('reassembles identically when the wire arrives in arbitrary chunk slices', () => {
    const parse = createSseDeltaParser('openai')
    let text = ''
    let reasoning = ''
    // 7 bytes at a time: every boundary, including mid-JSON and mid-delta.
    for (let i = 0; i < REASONING_STREAM_SSE.length; i += 7) {
      for (const d of parse(REASONING_STREAM_SSE.slice(i, i + 7))) {
        text += d.text ?? ''
        reasoning += d.reasoning ?? ''
      }
    }
    expect(text).toBe(REASONING_STREAM_EXPECTED.text)
    expect(reasoning).toBe(REASONING_STREAM_EXPECTED.reasoning)
  })

  it('runAssistantChatApiStream reassembles both lanes and emits the assistant delta shape', async () => {
    const { outcome, deltas } = await streamFixture(REASONING_STREAM_SSE)
    expect(outcome.ok).toBe(true)
    expect(outcome.text).toBe(REASONING_STREAM_EXPECTED.text)
    expect(outcome.reasoning).toBe(REASONING_STREAM_EXPECTED.reasoning)
    // The onDelta sequence is exactly what patchStream consumes, and the
    // outcome carries the joined reasoning assistant.tsx renders behind
    // toggleReasoning (stream.reasoning || m.reasoning).
    expect(deltas).toEqual(REASONING_STREAM_DELTAS)
  })

  it('degradation: a provider that never sends reasoning_content behaves as today', async () => {
    const parse = createSseDeltaParser('openai')
    const deltas = parse(PLAIN_STREAM_SSE)
    expect(deltas.every(d => d.reasoning === undefined)).toBe(true)
    let text = ''
    let reasoning = ''
    for (const d of deltas) {
      text += d.text ?? ''
      reasoning += d.reasoning ?? ''
    }
    expect(text).toBe(PLAIN_STREAM_EXPECTED.text)
    expect(reasoning).toBe('')

    const { outcome } = await streamFixture(PLAIN_STREAM_SSE)
    expect(outcome.ok).toBe(true)
    expect(outcome.text).toBe(PLAIN_STREAM_EXPECTED.text)
    expect(outcome.reasoning).toBe('')
  })

  it('the same reply as a non-streamed body (usage on the envelope) still yields both lanes', async () => {
    // Gateway ignored stream:true: reasoning_content rides the message.
    const d = extractFullCompletion('openai', JSON.parse(REASONING_FULL_BODY))
    expect(d).toEqual(REASONING_STREAM_EXPECTED)

    const { outcome, deltas } = await streamFixture(REASONING_FULL_BODY)
    expect(outcome.ok).toBe(true)
    expect(outcome.text).toBe(REASONING_STREAM_EXPECTED.text)
    expect(outcome.reasoning).toBe(REASONING_STREAM_EXPECTED.reasoning)
    // settleFromFullBody emits one text delta then one reasoning delta.
    expect(deltas).toEqual([
      { text: REASONING_STREAM_EXPECTED.text },
      { reasoning: REASONING_STREAM_EXPECTED.reasoning },
    ])
  })
})
