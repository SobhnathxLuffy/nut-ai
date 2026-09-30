vi.mock('../credentials', () => ({ loadCredential: vi.fn(() => 'fake-key') }))
import { describe, expect, it, vi } from 'vitest'
import { buildOpenAIRequest } from '@nutai/prompt'
import {
  createSseDeltaParser,
  extractFullCompletion,
  runAssistantChatApiStream,
  runLabelScan,
  runScan,
  runScanWithFallback,
  runWebLookup,
} from './client'
import { loadCredential } from '../credentials'
import { withBaseUrl } from '../base-url'

/**
 * The cloud client against scripted responses: envelope extraction for every
 * provider, the structural-400 fallback, and the defensive JSON fishing that
 * the tool-using calls need. No network — every byte is scripted.
 */

type Call = { url: string; body: any }

function scripted(responses: Array<{ status: number; body: string }>) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body } as Response
  })
  return { calls, impl: impl as unknown as typeof fetch }
}

const SCAN_REQ = (jsonSchema: unknown = { type: 'object' }) => ({
  provider: 'anthropic' as const,
  model: 'claude-haiku-4-5-20251001',
  credential: { kind: 'api_key' as const, value: 'sk' },
  imagesBase64: ['AAAA'],
  localSignalsBlock: '',
  jsonSchema,
})

describe('runScan envelope extraction', () => {
  it('anthropic: parses the JSON out of content[0].text and keeps REAL token counts', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          content: [{ type: 'text', text: '{"is_food":true}' }],
          usage: { input_tokens: 1200, output_tokens: 340 },
        }),
      },
    ])
    const r = await runScan(SCAN_REQ(), impl)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.raw).toEqual({ is_food: true })
      expect(r.value.inputTokens).toBe(1200)
      expect(r.value.outputTokens).toBe(340)
      // Cost is arithmetic from the catalog price, never an estimate.
      expect(r.value.costUsd).toBeCloseTo((1200 * 1 + 340 * 5) / 1_000_000, 8)
    }
  })

  it('openai: choices[0].message.content', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: '{"x":1}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      },
    ])
    const r = await runScan({ ...SCAN_REQ(), provider: 'openai' }, impl)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.raw).toEqual({ x: 1 })
  })

  it('gemini: candidates[0].content.parts[0].text', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"y":2}' }] } }],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 },
        }),
      },
    ])
    const r = await runScan({ ...SCAN_REQ(), provider: 'google' }, impl)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.raw).toEqual({ y: 2 })
  })

  it('names the six failure states from status codes', async () => {
    for (const [status, kind] of [
      [401, 'key-invalid'],
      [402, 'quota-exhausted'],
      [404, 'model-unavailable'],
      [429, 'error-retryable'],
      [500, 'error-retryable'],
    ] as const) {
      const { impl } = scripted([{ status, body: '{}' }])
      const r = await runScan(SCAN_REQ(), impl)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.kind, `status ${status}`).toBe(kind)
    }
  })
})

describe('runScanWithFallback', () => {
  it('retries a structural 400 once with NO structured output', async () => {
    const { calls, impl } = scripted([
      { status: 400, body: '{"error":"schema not supported"}' },
      {
        status: 200,
        body: JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], usage: {} }),
      },
    ])
    const r = await runScanWithFallback(SCAN_REQ(), impl)
    expect(r.ok).toBe(true)
    expect(r.usedSchemaFallback).toBe(true)
    expect(calls).toHaveLength(2)
    // First request carried the schema; the retry must NOT.
    expect(JSON.stringify(calls[0]!.body)).toContain('output_config')
    expect(JSON.stringify(calls[1]!.body)).not.toContain('output_config')
  })

  it('does NOT retry auth failures — a 401 is not a dialect problem', async () => {
    const { calls, impl } = scripted([{ status: 401, body: '{}' }])
    const r = await runScanWithFallback(SCAN_REQ(), impl)
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('does not loop: a 400 on the schema-free retry reports the ORIGINAL error', async () => {
    const { calls, impl } = scripted([
      { status: 400, body: '{"error":"first"}' },
      { status: 400, body: '{"error":"second"}' },
    ])
    const r = await runScanWithFallback(SCAN_REQ(), impl)
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(2)
  })
})

describe('runWebLookup JSON fishing', () => {
  it('anthropic: takes the LAST text block — tool blocks interleave before it', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          content: [
            { type: 'text', text: 'Searching…' },
            { type: 'server_tool_use', name: 'web_search' },
            { type: 'web_search_tool_result', content: [] },
            { type: 'text', text: '```json\n{"found":true,"source_url":"https://x.com","question":null,"options":[]}\n```' },
          ],
        }),
      },
    ])
    const r = await runWebLookup('anthropic', { model: 'm', itemName: 'x', brand: null }, { kind: 'api_key', value: 'k' }, impl)
    expect(r.ok).toBe(true)
    expect((r.raw as any).found).toBe(true)
  })

  it('openai Responses API: finds the message item in output[]', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          output: [
            { type: 'web_search_call' },
            { type: 'message', content: [{ type: 'output_text', text: '{"found":false,"source_url":null,"question":null,"options":[]}' }] },
          ],
        }),
      },
    ])
    const r = await runWebLookup('openai', { model: 'm', itemName: 'x', brand: null }, { kind: 'api_key', value: 'k' }, impl)
    expect(r.ok).toBe(true)
    expect((r.raw as any).found).toBe(false)
  })

  it('prose with no JSON object is schema-violation, not a crash and not offline', async () => {
    const { impl } = scripted([
      { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: 'I could not find anything.' }] }) },
    ])
    const r = await runWebLookup('anthropic', { model: 'm', itemName: 'x', brand: null }, { kind: 'api_key', value: 'k' }, impl)
    expect(r.ok).toBe(false)
    expect(r.error?.kind).toBe('schema-violation')
  })
})

describe('runLabelScan', () => {
  it('openai label scans use chat completions, not the Responses API', async () => {
    const { calls, impl } = scripted([
      { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"product_name":null}' } }] }) },
    ])
    const r = await runLabelScan('openai', { model: 'm', imageBase64: 'AAAA' }, { kind: 'api_key', value: 'k' }, impl)
    expect(r.ok).toBe(true)
    expect(calls[0]!.url).toContain('/v1/chat/completions')
  })
})

describe('withBaseUrl — OpenAI-compatible reseller override', () => {
  it('rewrites the official OpenAI prefix onto the custom base', () => {
    expect(withBaseUrl('https://api.openai.com/v1/chat/completions', 'https://aicredits.in/v1')).toBe(
      'https://aicredits.in/v1/chat/completions',
    )
    expect(withBaseUrl('https://api.openai.com/v1/models/gpt-4o-mini', 'https://proxy.example/v1')).toBe(
      'https://proxy.example/v1/models/gpt-4o-mini',
    )
  })

  it('normalizes full-endpoint pastes and trailing slashes', () => {
    expect(withBaseUrl('https://api.openai.com/v1/chat/completions', 'https://aicredits.in/v1/')).toBe(
      'https://aicredits.in/v1/chat/completions',
    )
    expect(
      withBaseUrl('https://api.openai.com/v1/chat/completions', 'https://aicredits.in/v1/chat/completions'),
    ).toBe('https://aicredits.in/v1/chat/completions')
  })

  it('leaves official URLs and non-OpenAI endpoints untouched', () => {
    expect(withBaseUrl('https://api.openai.com/v1/chat/completions', null)).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
    expect(withBaseUrl('https://api.openai.com/v1/chat/completions', '   ')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
    // Anthropic/Gemini dialects pass through — the override is OpenAI-only.
    expect(withBaseUrl('https://api.anthropic.com/v1/messages', 'https://aicredits.in/v1')).toBe(
      'https://api.anthropic.com/v1/messages',
    )
    expect(
      withBaseUrl('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent', 'https://x/v1'),
    ).toBe('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent')
  })

  it('routes the scan call to the reseller base when baseUrl is set', async () => {
    const calls: Array<{ url: string }> = []
    const impl = (async (url: string) => {
      calls.push({ url })
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"is_food":false,"refusal_reason":"nope","items":[]}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    await runScan(
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        credential: { kind: 'api_key', value: 'k' },
        imagesBase64: ['AAAA'],
        localSignalsBlock: '',
        jsonSchema: null,
        baseUrl: 'https://aicredits.in/v1',
      },
      impl,
    )
    expect(calls[0]!.url).toBe('https://aicredits.in/v1/chat/completions')
  })
})

describe('wire-schema sanitation and the instruction-contract fallback', () => {
  const SCHEMA = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: false,
    required: ['schema_version', 'refusal_reason'],
    properties: {
      schema_version: { type: 'string', enum: ['1.0.0'] },
      refusal_reason: { type: ['string', 'null'] },
      container: {
        anyOf: [
          { type: 'object', properties: { type: { type: 'string' }, fill_fraction: { type: 'number' } }, required: ['type', 'fill_fraction'], additionalProperties: false },
          { type: 'null' },
        ],
      },
    },
  }

  it('sanitizes the wire schema in the OpenAI body — nullable unions 400 on Go gateways', () => {
    const built = buildOpenAIRequest(
      { model: 'gpt-4o-mini', imagesBase64: ['AAAA'], localSignalsBlock: '', jsonSchema: SCHEMA },
      'k',
    ).body as any
    const wire = built.response_format.json_schema.schema
    expect(wire.$schema).toBeUndefined()
    expect(wire.properties.refusal_reason).toEqual({ type: 'string' })
    expect(wire.properties.container.type).toBe('object')
    expect(wire.required).toEqual(['schema_version', 'refusal_reason'])
    expect(built.response_format.json_schema.strict).toBe(true)
  })

  it('the structural-400 retry ships the schema as instruction text, not structured output', async () => {
    const { calls, impl } = scripted([
      { status: 400, body: '{"error":{"message":"cannot unmarshal array into Go struct field"}}' },
      {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: '{"schema_version":"1.0.0","refusal_reason":null}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      },
    ])
    const res = await runScanWithFallback(
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        credential: { kind: 'api_key', value: 'k' },
        imagesBase64: ['AAAA'],
        localSignalsBlock: '',
        jsonSchema: SCHEMA,
      },
      impl,
    )
    expect(res.ok).toBe(true)
    expect((res as any).usedSchemaFallback).toBe(true)
    expect(calls).toHaveLength(2)
    const second = calls[1]!.body
    expect(second.response_format).toEqual({ type: 'json_object' })
    const userText = second.messages.find((m: any) => m.role === 'user').content[0].text
    expect(userText).toContain('OUTPUT CONTRACT')
    expect(userText).toContain('refusal_reason')
    expect(userText).toContain('"schema_version"')
  })

  it('a 400 whose body merely echoes our refusal_reason field is NOT a content refusal', async () => {
    const { impl } = scripted([
      { status: 400, body: '{"error":{"message":"Invalid schema: Definition.properties.refusal_reason.type"}}' },
    ])
    const res = await runScan(
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        credential: { kind: 'api_key', value: 'k' },
        imagesBase64: ['AAAA'],
        localSignalsBlock: '',
        jsonSchema: null,
      },
      impl,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('error-retryable')
  })

  it('unparseable model content is a shape failure, not "offline"', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: 'not json at all {' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      },
    ])
    const res = await runScan(
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        credential: { kind: 'api_key', value: 'k' },
        imagesBase64: ['AAAA'],
        localSignalsBlock: '',
        jsonSchema: null,
      },
      impl,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('schema-violation')
      expect(res.error.message).toContain('unexpected shape')
    }
  })
})

describe('runWebLookup on a reseller base URL', () => {
  it('openai + custom base uses chat completions (NOT the Responses API) and parses the chat envelope', async () => {
    const { calls, impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: '{"found":true,"source_url":null,"question":null,"options":[{"label":"Maggi Masala","serving_g":70,"serving_desc":null,"calories_kcal":310,"protein_g":9,"carbs_g":45,"fat_g":11,"fiber_g":2,"sodium_mg":800}]}' } }],
        }),
      },
    ])
    const r = await runWebLookup(
      'openai',
      { model: 'gpt-4o-mini', itemName: 'Maggi noodles', brand: null },
      { kind: 'api_key', value: 'k' },
      impl,
      30_000,
      'https://aicredits.in/v1',
    )
    expect(r.ok).toBe(true)
    expect((r.raw as any).found).toBe(true)
    expect(calls[0]!.url).toBe('https://aicredits.in/v1/chat/completions')
    // The no-search-tool caveat must be attached so the model cannot
    // hallucinate a source URL.
    expect(calls[0]!.body.messages[0].content).toContain('NO live search tool')
    expect(calls[0]!.body.response_format).toEqual({ type: 'json_object' })
  })

  it('openai WITHOUT a base URL keeps the official Responses API with the search tool', async () => {
    const { calls, impl } = scripted([
      { status: 200, body: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"found":false,"source_url":null,"question":null,"options":[]}' }] }] }) },
    ])
    await runWebLookup('openai', { model: 'm', itemName: 'x', brand: null }, { kind: 'api_key', value: 'k' }, impl)
    expect(calls[0]!.url).toContain('/v1/responses')
    expect(calls[0]!.body.tools).toEqual([{ type: 'web_search' }])
  })
})

describe('createSseDeltaParser', () => {
  it('openai: content and reasoning_content deltas survive arbitrary chunk splits', () => {
    const parse = createSseDeltaParser('openai')
    const stream =
      'data: {"choices":[{"delta":{"reasoning_content":"thinking ha"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n' +
      'data: {"choices":[{"delta":{"reasoning":"more thought"}}]}\n' +
      'data: [DONE]\n'
    // Feed in awkward slices.
    let text = ''
    let reasoning = ''
    for (const c of [stream.slice(0, 37), stream.slice(37, 90), stream.slice(90)]) {
      for (const d of parse(c)) {
        text += d.text ?? ''
        reasoning += d.reasoning ?? ''
      }
    }
    expect(reasoning).toBe('thinking hamore thought')
    expect(text).toBe('Hello')
  })

  it('anthropic: text_delta and thinking_delta land in separate lanes', () => {
    const parse = createSseDeltaParser('anthropic')
    const deltas = parse(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n' +
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
    )
    expect(deltas).toEqual([{ reasoning: 'hmm' }, { text: 'Hi' }])
  })

  it('google: thought-flagged parts go to reasoning, plain parts to text', () => {
    const parse = createSseDeltaParser('google')
    const deltas = parse(
      'data: {"candidates":[{"content":{"parts":[{"text":"deep thought","thought":true}]}}]}\n\n' +
        'data: {"candidates":[{"content":{"parts":[{"text":"Answer"}]}}]}\n\n',
    )
    expect(deltas).toEqual([{ reasoning: 'deep thought' }, { text: 'Answer' }])
  })
})

describe('extractFullCompletion — gateways that ignore stream:true', () => {
  it('openai: pulls text AND reasoning_content out of a plain completion body', () => {
    const d = extractFullCompletion('openai', {
      choices: [{ message: { content: 'Answer here', reasoning_content: 'thought chain' } }],
    })
    expect(d).toEqual({ text: 'Answer here', reasoning: 'thought chain' })
  })

  it('anthropic: concatenates text and thinking blocks', () => {
    const d = extractFullCompletion('anthropic', {
      content: [
        { type: 'thinking', thinking: 'plan' },
        { type: 'text', text: 'Part 1' },
        { type: 'text', text: ' + Part 2' },
      ],
    })
    expect(d).toEqual({ text: 'Part 1 + Part 2', reasoning: 'plan' })
  })
})

// ---------------------------------------------------------------------------
// runAssistantChatApiStream — the XHR transport (P1-2 double-append, P1-3 stall)
// ---------------------------------------------------------------------------

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

const STREAM_BODY = JSON.stringify({
  choices: [{ message: { content: 'Hello', reasoning_content: 'why' } }],
  usage: { prompt_tokens: 10, completion_tokens: 4 },
})

async function setupStream() {
  vi.mocked(loadCredential).mockResolvedValue({ kind: 'api_key', value: 'sk-stream' } as never)
  return new FakeXhr()
}

describe('runAssistantChatApiStream', () => {
  it('non-SSE plain JSON body arrives in chunks and parses ONCE — no double-append', async () => {
    const xhr = await setupStream()
    const deltas: Array<{ text?: string; reasoning?: string }> = []
    const done = runAssistantChatApiStream(
      { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'sys', userPrompt: 'usr' },
      { onDelta: (d) => deltas.push(d) },
      () => xhr as unknown as XMLHttpRequest,
    )
    // The stream fn awaits the credential before wiring the XHR — let it run.
    await vi.waitFor(() => {
      if (typeof xhr.onprogress !== 'function') throw new Error('xhr not wired yet')
    })

    // The gateway ignored stream:true and sent a plain body in two TCP chunks.
    xhr.responseText = STREAM_BODY.slice(0, 12)
    xhr.onprogress!()
    xhr.responseText = STREAM_BODY
    xhr.onprogress!()
    xhr.onload!()

    const outcome = await done
    expect(outcome.ok).toBe(true)
    expect(outcome.text).toBe('Hello')
    expect(outcome.reasoning).toBe('why')
    // Exactly one full-content delta fires (from settleFromFullBody) — a
    // duplicated body would have failed JSON.parse before this point.
    expect(deltas).toEqual([{ text: 'Hello' }, { reasoning: 'why' }])
  })

  it('SSE chunks still stream through the delta parser untouched', async () => {
    const xhr = await setupStream()
    const deltas: Array<{ text?: string; reasoning?: string }> = []
    const done = runAssistantChatApiStream(
      { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'sys', userPrompt: 'usr' },
      { onDelta: (d) => deltas.push(d) },
      () => xhr as unknown as XMLHttpRequest,
    )
    // The stream fn awaits the credential before wiring the XHR — let it run.
    await vi.waitFor(() => {
      if (typeof xhr.onprogress !== 'function') throw new Error('xhr not wired yet')
    })

    xhr.responseText = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'
    xhr.onprogress!()
    xhr.onload!()

    const outcome = await done
    expect(outcome.ok).toBe(true)
    expect(outcome.text).toBe('Hi')
    expect(deltas).toEqual([{ text: 'Hi' }])
  })

  it('stall guard aborts a mid-stream silence and keeps the partial text', async () => {
    vi.useFakeTimers()
    try {
      const xhr = await setupStream()
      const done = runAssistantChatApiStream(
        { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'sys', userPrompt: 'usr', stallTimeoutMs: 20 },
        {},
        () => xhr as unknown as XMLHttpRequest,
      )
      // Drain the credential-load microtasks WITHOUT advancing fake timers —
      // advancing here would fire the stall guard before the first chunk.
      await vi.advanceTimersByTimeAsync(0)
      if (typeof xhr.onprogress !== 'function') throw new Error('xhr not wired yet')

      xhr.responseText = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
      xhr.onprogress!() // re-arms the guard; then the gateway goes silent
      await vi.advanceTimersByTimeAsync(20)

      const outcome = await done
      expect(outcome.ok).toBe(false)
      expect(outcome.partial).toBe(true)
      expect(outcome.text).toBe('partial')
      expect(outcome.error?.message).toBe('The answer stalled partway through.')
      expect(xhr.aborts).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stall guard reports a silent gateway before the first byte', async () => {
    vi.useFakeTimers()
    try {
      const xhr = await setupStream()
      const done = runAssistantChatApiStream(
        { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'sys', userPrompt: 'usr', stallTimeoutMs: 20 },
        {},
        () => xhr as unknown as XMLHttpRequest,
      )
      // Drain the credential-load microtasks WITHOUT advancing fake timers —
      // advancing here would fire the stall guard before the first chunk.
      await vi.advanceTimersByTimeAsync(0)
      if (typeof xhr.onprogress !== 'function') throw new Error('xhr not wired yet')

      await vi.advanceTimersByTimeAsync(20)

      const outcome = await done
      expect(outcome.ok).toBe(false)
      expect(outcome.partial).toBe(false)
      expect(outcome.error?.message).toBe('The model did not start answering in time.')
    } finally {
      vi.useRealTimers()
    }
  })
})
