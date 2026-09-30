vi.mock('../credentials', () => ({
  loadCredential: vi.fn(async (_) => ({ kind: 'api_key', value: 'fake-key' })),
}))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifyTransportError,
  extractJsonObject,
  runAssistantChatApi,
  runAssistantChatApiSingle,
  runAssistantChatApiStream,
  runCorrectionIntent,
  runScan,
  serializeBody,
} from './client'
import { loadCredential } from '../credentials'

/**
 * Wave 2 — reseller reliability and honest errors.
 *
 * Every test here is a finding from the QA audit: the transport-error taxonomy
 * (P2-1), fenced JSON on the scan and correction paths (P2-10, P2-3),
 * correction classification by error type (P3-1), the Google key moving to a
 * header (P2-12), the same-provider-only fallback with disclosure (P2-8), and
 * the cancelled stream flag (P2-6). No network — every byte is scripted.
 */

type Call = { url: string; headers: Record<string, string> | undefined; body: any }

function scripted(responses: Array<{ status: number; body: string }>) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init?.headers, body: init?.body ? JSON.parse(init.body) : undefined })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.body,
      // runAssistantChatApiSingle reads resp.json(); every other path reads resp.text().
      json: async () => JSON.parse(r.body),
    } as Response
  })
  return { calls, impl: impl as unknown as typeof fetch }
}

const CORRECTION_INTENT = JSON.stringify({
  operations: [{ type: 'update_quantity', id: 'm1i1', grams: 100 }],
  clarification_needed: null,
})

describe('classifyTransportError — taxonomy by error TYPE (P2-1, P3-1)', () => {
  it('an abort is the may-have-been-billed timeout, never offline', () => {
    const e = new Error('The operation was aborted')
    e.name = 'AbortError'
    const f = classifyTransportError(e)
    expect(f.kind).toBe('timeout-ambiguous')
    expect(f.retryable).toBe(false)
  })

  it('a RangeError is an internal error — ours, not the network\'s, never retryable', () => {
    const e = new RangeError('Invalid string length')
    const f = classifyTransportError(e)
    expect(f.kind).toBe('internal-error')
    expect(f.retryable).toBe(false)
  })

  it('a fetch rejection (TypeError, the RN/web network shape) stays offline', () => {
    const e = new TypeError('Network request failed')
    const f = classifyTransportError(e)
    expect(f.kind).toBe('offline')
    expect(f.retryable).toBe(true)
  })
})

describe('serializeBody — an un-stringifiable payload is internal (P2-1)', () => {
  it('a circular body reads as internal-error instead of escaping into the transport catch', () => {
    const body: Record<string, unknown> = {}
    body.self = body
    const r = serializeBody(body)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('internal-error')
      expect(r.error.retryable).toBe(false)
    }
  })

  it('a normal body serializes', () => {
    expect(serializeBody({ a: 1 })).toEqual({ ok: true, text: '{"a":1}' })
  })
})

describe('extractJsonObject — the one fenced extractor (P2-10)', () => {
  it('parses clean JSON directly', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('recovers a ```json-fenced reply with prose around it', () => {
    const fenced = 'Here is the answer:\n```json\n{"found":true,"options":[]}\n```\nHope that helps!'
    expect(extractJsonObject(fenced)).toEqual({ found: true, options: [] })
  })

  it('returns null for prose with no JSON object', () => {
    expect(extractJsonObject('no json here')).toBeNull()
  })

  it('the SCAN path survives a fenced reply — one fenced reply no longer loses a billed scan (P2-10)', async () => {
    const { impl } = scripted([
      {
        status: 200,
        body: JSON.stringify({
          content: [{ type: 'text', text: '```json\n{"is_food":true,"items":[]}\n```' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    ])
    const r = await runScan(
      {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        credential: { kind: 'api_key', value: 'sk' },
        imagesBase64: ['AAAA'],
        localSignalsBlock: '',
        jsonSchema: { type: 'object' },
      },
      impl,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.raw).toEqual({ is_food: true, items: [] })
  })
})

describe('runCorrectionIntent — timeout, abort, fences, honest parse failures (P2-3, P3-1)', () => {
  beforeEach(() => {
    vi.mocked(loadCredential).mockResolvedValue({ kind: 'api_key', value: 'gkey' } as never)
  })

  const REQ = { provider: 'openai' as const, model: 'gpt-4o-mini', systemPrompt: 'sys', userPrompt: 'usr' }

  it('a fenced reply parses instead of throwing SyntaxError', async () => {
    const { impl } = scripted([
      { status: 200, body: JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${CORRECTION_INTENT}\n\`\`\`` } }] }) },
    ])
    const r = await runCorrectionIntent(REQ, impl)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.intent.operations).toHaveLength(1)
  })

  it('a garbage reply is schema-violation and NOT retryable — the UI offers re-analysis explicitly', async () => {
    const { impl } = scripted([
      { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'I cannot help with that.' } }] }) },
    ])
    const r = await runCorrectionIntent(REQ, impl)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('schema-violation')
      expect(r.error.retryable).toBe(false)
    }
  })

  it('a network rejection is offline — classified by error type, no message sniffing (P3-1)', async () => {
    const impl = vi.fn(async () => {
      throw new TypeError('Network request failed')
    }) as unknown as typeof fetch
    const r = await runCorrectionIntent(REQ, impl)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('offline')
      expect(r.error.retryable).toBe(true)
    }
  })

  it('an aborted correction is timeout-ambiguous, NOT offline', async () => {
    const impl = vi.fn(async () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    }) as unknown as typeof fetch
    const r = await runCorrectionIntent(REQ, impl)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('timeout-ambiguous')
      expect(r.error.retryable).toBe(false)
    }
  })

  it('the Google key travels in the x-goog-api-key header, never the URL (P2-12)', async () => {
    const { calls, impl } = scripted([
      { status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: CORRECTION_INTENT }] } }] }) },
    ])
    const r = await runCorrectionIntent({ ...REQ, provider: 'google', model: 'gemini-2.0-flash-lite' }, impl)
    expect(r.ok).toBe(true)
    expect(calls[0]!.url).not.toContain('key=')
    expect(calls[0]!.headers?.['x-goog-api-key']).toBe('gkey')
  })

  it('a hung gateway cannot freeze the flow: the request carries an abort signal', async () => {
    let seenSignal: AbortSignal | null = null
    const impl = vi.fn(async (_url: any, init: any) => {
      seenSignal = init?.signal ?? null
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: CORRECTION_INTENT } }] }) } as Response
    }) as unknown as typeof fetch
    await runCorrectionIntent(REQ, impl)
    expect(seenSignal).toBeInstanceOf(AbortSignal)
  })
})

describe('runAssistantChatApi — same-provider-only fallback with disclosure (P2-8)', () => {
  beforeEach(() => {
    vi.mocked(loadCredential).mockResolvedValue({ kind: 'api_key', value: 'fake-key' } as never)
  })

  const openai429 = { status: 429, body: JSON.stringify({ error: { message: 'rate limited' } }) }
  const openaiAnswer = (text: string) => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: text } }] }) })
  const anthropicAnswer = (text: string) => ({ status: 200, body: JSON.stringify({ content: [{ type: 'text', text }] }) })

  it('a 429 on the primary falls to the SAME provider\u2019s alternate, tagged answeredVia', async () => {
    const { calls, impl } = scripted([
      openai429,
      openaiAnswer('from gpt-4o-mini'),
    ])
    const r = await runAssistantChatApi(
      { provider: 'openai', model: 'gpt-4o', systemPrompt: 'sys', userPrompt: 'usr' },
      impl,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe('from gpt-4o-mini')
      expect(r.answeredVia).toEqual({ provider: 'openai', model: 'gpt-4o-mini' })
    }
    // No other provider's endpoint was ever touched — no unconsented spend.
    expect(calls.every((c) => c.url.startsWith('https://api.openai.com/'))).toBe(true)
  })

  it('cross-provider fallbacks do NOT run without the explicit opt-in', async () => {
    const { calls, impl } = scripted([openai429, openai429])
    const r = await runAssistantChatApi(
      { provider: 'openai', model: 'gpt-4o', systemPrompt: 'sys', userPrompt: 'usr' },
      impl,
    )
    expect(r.ok).toBe(false)
    expect(calls.every((c) => c.url.startsWith('https://api.openai.com/'))).toBe(true)
  })

  it('with allowCrossProvider the chain reaches the other saved provider and discloses it', async () => {
    const { calls, impl } = scripted([
      openai429,
      openai429,
      anthropicAnswer('from claude'),
    ])
    const r = await runAssistantChatApi(
      { provider: 'openai', model: 'gpt-4o', systemPrompt: 'sys', userPrompt: 'usr', allowCrossProvider: true },
      impl,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe('from claude')
      expect(r.answeredVia?.provider).toBe('anthropic')
    }
    expect(calls.some((c) => c.url.startsWith('https://api.anthropic.com/'))).toBe(true)
  })

  it('the primary model itself is exempt from answeredVia (no disclosure for the configured model)', async () => {
    const { impl } = scripted([openaiAnswer('direct')])
    const r = await runAssistantChatApi(
      { provider: 'openai', model: 'gpt-4o', systemPrompt: 'sys', userPrompt: 'usr', allowCrossProvider: true },
      impl,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.answeredVia).toBeUndefined()
  })

  it('runAssistantChatApiSingle sends the Google key in the header (P2-12)', async () => {
    const { calls, impl } = scripted([
      { status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }) },
    ])
    const r = await runAssistantChatApiSingle(
      { provider: 'google', model: 'gemini-2.0-flash-lite', systemPrompt: 'sys', userPrompt: 'usr' },
      impl,
    )
    expect(r.ok).toBe(true)
    expect(calls[0]!.url).not.toContain('key=')
    expect(calls[0]!.headers?.['x-goog-api-key']).toBe('fake-key')
  })
})

// ---------------------------------------------------------------------------
// P2-6 — the cancelled stream flag
// ---------------------------------------------------------------------------

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

describe('runAssistantChatApiStream — cancelled flag (P2-6)', () => {
  it('a caller abort with zero streamed bytes is marked cancelled', async () => {
    vi.mocked(loadCredential).mockResolvedValue({ kind: 'api_key', value: 'sk-stream' } as never)
    const xhr = new FakeXhr()
    const done = runAssistantChatApiStream(
      { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'sys', userPrompt: 'usr' },
      {},
      () => xhr as unknown as XMLHttpRequest,
    )
    await vi.waitFor(() => {
      if (typeof xhr.onabort !== 'function') throw new Error('xhr not wired yet')
    })

    xhr.abort() // the user left the screen — nothing ever streamed

    const outcome = await done
    expect(outcome.ok).toBe(false)
    expect(outcome.cancelled).toBe(true)
    expect(outcome.text).toBe('')
    expect(outcome.partial).toBe(false)
  })

  it('a caller abort mid-stream keeps the partial text AND the cancelled flag', async () => {
    vi.mocked(loadCredential).mockResolvedValue({ kind: 'api_key', value: 'sk-stream' } as never)
    const xhr = new FakeXhr()
    const done = runAssistantChatApiStream(
      { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'sys', userPrompt: 'usr' },
      {},
      () => xhr as unknown as XMLHttpRequest,
    )
    await vi.waitFor(() => {
      if (typeof xhr.onprogress !== 'function') throw new Error('xhr not wired yet')
    })

    xhr.responseText = 'data: {"choices":[{"delta":{"content":"partial ans"}}]}\n\n'
    xhr.onprogress!()
    xhr.abort()

    const outcome = await done
    expect(outcome.cancelled).toBe(true)
    expect(outcome.partial).toBe(true)
    expect(outcome.text).toBe('partial ans')
  })

  it('a completed stream is not marked cancelled', async () => {
    vi.mocked(loadCredential).mockResolvedValue({ kind: 'api_key', value: 'sk-stream' } as never)
    const xhr = new FakeXhr()
    const done = runAssistantChatApiStream(
      { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'sys', userPrompt: 'usr' },
      {},
      () => xhr as unknown as XMLHttpRequest,
    )
    await vi.waitFor(() => {
      if (typeof xhr.onload !== 'function' && typeof xhr.onprogress !== 'function') throw new Error('xhr not wired yet')
    })

    xhr.responseText = 'data: {"choices":[{"delta":{"content":"done"}}]}\n\n'
    xhr.onprogress!()
    xhr.onload!()

    const outcome = await done
    expect(outcome.ok).toBe(true)
    expect(outcome.cancelled).toBeUndefined()
  })
})
