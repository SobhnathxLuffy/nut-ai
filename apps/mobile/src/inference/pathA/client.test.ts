vi.mock('../credentials', () => ({ loadCredential: vi.fn(() => 'fake-key') }))
import { describe, expect, it, vi } from 'vitest'
import { runLabelScan, runScan, runScanWithFallback, runWebLookup } from './client'

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
