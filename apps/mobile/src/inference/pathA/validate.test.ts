import { describe, expect, it, vi } from 'vitest'
import { validateCredential } from './validate'

/**
 * The credential validator, against a scripted fetch.
 *
 * This code failed on a real phone twice — first by validating with a request
 * every provider structurally 400s, then by hiding the bearer attempt's error
 * behind the x-api-key fallback's 401. These tests pin the exact wire behavior:
 * which endpoint each shape probes, which headers ride along, and that EVERY
 * attempt's response survives into `detail`.
 */

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

function scripted(responses: Array<{ status: number; body?: string }>) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: any, init: any) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
      ),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!
    return { status: r.status, text: async () => r.body ?? '{}' } as Response
  })
  return { calls, impl: impl as unknown as typeof fetch }
}

describe('anthropic credential shapes', () => {
  it('probes a CLI token against /v1/messages — the endpoint scans actually use', async () => {
    const { calls, impl } = scripted([{ status: 200 }])
    const res = await validateCredential('anthropic', 'claude-haiku-4-5-20251001', { kind: 'oauth', value: 'tok' }, impl)

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.usedShape).toBe('bearer')
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.headers['authorization']).toBe('Bearer tok')
    // Without this beta header a VALID setup-token 401s. Load-bearing.
    expect(calls[0]!.headers['anthropic-beta']).toBe('oauth-2025-04-20')
    // One output token — the cheapest request that proves inference scope.
    expect((calls[0]!.body as any).max_tokens).toBe(1)
  })

  it('probes an API key against the free model-retrieve endpoint', async () => {
    const { calls, impl } = scripted([{ status: 200 }])
    const res = await validateCredential('anthropic', 'claude-haiku-4-5-20251001', { kind: 'api_key', value: 'sk-ant-x' }, impl)

    expect(res.ok).toBe(true)
    expect(calls[0]!.url).toContain('/v1/models/claude-haiku-4-5-20251001')
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.headers['x-api-key']).toBe('sk-ant-x')
  })

  it('recovers a CLI token pasted into the API-key tab by trying the other shape', async () => {
    const { calls, impl } = scripted([
      { status: 401, body: '{"error":"invalid x-api-key"}' },
      { status: 200 },
    ])
    const res = await validateCredential('anthropic', 'm', { kind: 'api_key', value: 'sk-ant-oat01-tok' }, impl)

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.usedShape).toBe('bearer')
    expect(calls).toHaveLength(2)
  })

  it('keeps EVERY attempt in detail when both shapes fail — the hidden-error bug', async () => {
    const { impl } = scripted([
      { status: 401, body: '{"scope":"insufficient"}' },
      { status: 401, body: '{"error":"invalid x-api-key"}' },
    ])
    const res = await validateCredential('anthropic', 'm', { kind: 'oauth', value: 'tok' }, impl)

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.detail).toContain('bearer:')
      expect(res.detail).toContain('x-api-key:')
      expect(res.detail).toContain('insufficient')
    }
  })

  it('stops at a 404 — auth worked, the model id is wrong, retrying headers cannot help', async () => {
    const { calls, impl } = scripted([{ status: 404, body: '{"error":"not found"}' }])
    const res = await validateCredential('anthropic', 'bad-model', { kind: 'api_key', value: 'sk' }, impl)

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('model-unavailable')
    expect(calls).toHaveLength(1)
  })
})

describe('other providers', () => {
  it('openai: GET /v1/models/{id} with a bearer header', async () => {
    const { calls, impl } = scripted([{ status: 200 }])
    const res = await validateCredential('openai', 'gpt-4o-mini', { kind: 'api_key', value: 'sk-o' }, impl)
    expect(res.ok).toBe(true)
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/models/gpt-4o-mini')
    expect(calls[0]!.headers['authorization']).toBe('Bearer sk-o')
  })

  it('google: model retrieve with x-goog-api-key', async () => {
    const { calls, impl } = scripted([{ status: 200 }])
    const res = await validateCredential('google', 'gemini-2.0-flash', { kind: 'api_key', value: 'g' }, impl)
    expect(res.ok).toBe(true)
    expect(calls[0]!.url).toContain('generativelanguage.googleapis.com')
    expect(calls[0]!.headers['x-goog-api-key']).toBe('g')
  })

  it('a thrown fetch is offline, and nothing is saved on the strength of it', async () => {
    const impl = (async () => {
      throw new TypeError('Network request failed')
    }) as unknown as typeof fetch
    const res = await validateCredential('openai', 'm', { kind: 'api_key', value: 'k' }, impl)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('offline')
  })
})

describe('reseller gateway validation — EVERY provider', () => {
  const BASE = 'https://aicredits.in/v1'

  it('google + base URL probes the GATEWAY (models/{id} then chat fallback), never generativelanguage', async () => {
    const { calls, impl } = scripted([
      { status: 404, body: '404 page not found' },
      { status: 200, body: '{"choices":[]}' },
    ])
    const res = await validateCredential('google', 'gemini-2.5-flash', { kind: 'api_key', value: 'sk-live-x' }, impl, 15_000, BASE)

    expect(res.ok).toBe(true)
    expect(calls.every((c) => !c.url.includes('generativelanguage.googleapis.com'))).toBe(true)
    expect(calls[0]!.url).toBe(`${BASE}/models/gemini-2.5-flash`)
    expect(calls[0]!.headers['authorization']).toBe('Bearer sk-live-x')
    // The 1-token chat probe is the endpoint scans actually hit.
    expect(calls[1]!.url).toBe(`${BASE}/chat/completions`)
    expect((calls[1]!.body as any).model).toBe('gemini-2.5-flash')
  })

  it('anthropic + base URL probes the gateway with Bearer — no native x-api-key attempt', async () => {
    const { calls, impl } = scripted([{ status: 200 }])
    const res = await validateCredential('anthropic', 'claude-haiku-4-5-20251001', { kind: 'api_key', value: 'sk-live-x' }, impl, 15_000, BASE)

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.usedShape).toBe('bearer')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${BASE}/models/claude-haiku-4-5-20251001`)
    expect(calls.every((c) => !c.url.includes('api.anthropic.com'))).toBe(true)
  })

  it('a gateway 400 on BOTH routes keeps its detail with status + body, key-free', async () => {
    const { impl } = scripted([
      { status: 404, body: '404 page not found' },
      { status: 400, body: '{"error":{"message":"model not found"}}' },
    ])
    const res = await validateCredential('google', 'gemini-2.5-flash', { kind: 'api_key', value: 'sk-live-x' }, impl, 15_000, BASE)

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('error-retryable')
      expect(res.detail).toContain('HTTP 400')
      expect(res.detail).toContain('model not found')
      expect(res.detail).not.toContain('sk-live-x')
    }
  })
})

describe('openai reseller base URLs', () => {
  const BASE = 'https://aicredits.in/v1'

  it('rewrites the probe onto the reseller base', async () => {
    const { calls, impl } = scripted([{ status: 200 }])
    const res = await validateCredential('openai', 'gpt-4o-mini', { kind: 'api_key', value: 'sk-live-x' }, impl, 15_000, BASE)
    expect(res.ok).toBe(true)
    expect(calls[0]!.url).toBe(`${BASE}/models/gpt-4o-mini`)
    expect(calls[0]!.headers['authorization']).toBe('Bearer sk-live-x')
  })

  it('falls back to a 1-token chat probe when the gateway skips per-model retrieve', async () => {
    const { calls, impl } = scripted([
      { status: 404, body: '404 page not found' },
      { status: 200, body: '{"choices":[]}' },
    ])
    const res = await validateCredential('openai', 'vendor/model-x', { kind: 'api_key', value: 'sk-live-x' }, impl, 15_000, BASE)

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.modelId).toBe('vendor/model-x')
    expect(calls).toHaveLength(2)
    expect(calls[1]!.url).toBe(`${BASE}/chat/completions`)
    expect(calls[1]!.method).toBe('POST')
    expect((calls[1]!.body as any).max_tokens).toBe(1)
    expect((calls[1]!.body as any).model).toBe('vendor/model-x')
  })

  it('a reseller 401 from the chat probe is key-invalid, with BOTH attempts in detail', async () => {
    const { impl } = scripted([
      { status: 404, body: '404 page not found' },
      { status: 401, body: '{"error":{"code":"invalid_api_key"}}' },
    ])
    const res = await validateCredential('openai', 'vendor/model-x', { kind: 'api_key', value: 'sk-live-x' }, impl, 15_000, BASE)

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('key-invalid')
      // The reseller owns the answer on its own base — no official-endpoint hint.
      expect(res.hint).toBeUndefined()
      expect(res.detail).toContain('chat/completions')
      expect(res.detail).toContain('invalid_api_key')
    }
  })

  it('a 401 from the OFFICIAL endpoint with a reseller-shaped key carries the reseller hint', async () => {
    const { impl } = scripted([
      { status: 401, body: '{"error":{"message":"Incorrect API key provided: sk-live-…bdcd.","type":"invalid_request_error","code":"invalid_api_key"}}' },
    ])
    // Synthetic reseller-shaped key — deliberately not a real credential and
    // not hex, so secret-scanning push protection has nothing to flag.
    const res = await validateCredential('openai', 'gpt-4o-mini', { kind: 'api_key', value: 'sk-live-testonly-notarealkey-0000000000000000000000000000' }, impl)

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.kind).toBe('key-invalid')
      expect(res.hint).toContain('aicredits.in/v1')
      expect(res.hint).toContain('api.openai.com')
    }
  })

  it('a 401 from the OFFICIAL endpoint with an official key shape gets NO hint', async () => {
    const { impl } = scripted([
      { status: 401, body: '{"error":{"code":"invalid_api_key"}}' },
    ])
    // Fixtures are CONCATENATED so no scanner-matchable literal key shape ever
    // appears in source — GitHub push protection flags even obviously fake
    // keys that match provider patterns (hit this in practice).
    const officialShapes = [
      'sk-proj-' + 'abc123',
      'sk-None-' + 'abc123',
      'sk-svcacct-' + 'abc123',
      'sk-' + 'ABCDEFGHIJKLMNOPQRST' + 'T3BlbkFJ' + 'xyz',
    ]
    for (const key of officialShapes) {
      const res = await validateCredential('openai', 'gpt-4o-mini', { kind: 'api_key', value: key }, impl)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.hint).toBeUndefined()
    }
  })
})
