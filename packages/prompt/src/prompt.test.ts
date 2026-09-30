import { describe, expect, it } from 'vitest'
import {
  buildAnthropicRequest, buildGeminiRequest, buildLocalSignalsBlock, buildOpenAIRequest,
  cheapestModel, computeScanCost, isGeminiFreeTierBlocked, PROMPT_VERSION, providersByPrice,
  PROVIDER_MODELS, SYSTEM_PROMPT,
} from './index.js'

const base = {
  model: 'x', imagesBase64: ['AAAA'], localSignalsBlock: '', jsonSchema: { type: 'object' },
}

describe('the system prompt', () => {
  it('embeds its own version, so no scan can be logged without knowing its prompt', () => {
    expect(SYSTEM_PROMPT).toContain(`<prompt_version>${PROMPT_VERSION}</prompt_version>`)
  })

  it('frames the model as a perception device, not a calculator', () => {
    expect(SYSTEM_PROMPT).toMatch(/PERCEPTION device, not a calculator/)
  })

  it('states the sanity bounds that are the first line of defence against absurd output', () => {
    expect(SYSTEM_PROMPT).toMatch(/900 kcal\/100g/)
    expect(SYSTEM_PROMPT).toMatch(/2,500 kcal/)
  })

  it('requires identification and portion confidence to be reported separately', () => {
    expect(SYSTEM_PROMPT).toMatch(/SEPARATELY/)
  })

  it('demands composite dishes decompose into per-component items', () => {
    expect(SYSTEM_PROMPT).toMatch(/one item PER COMPONENT/)
    expect(SYSTEM_PROMPT).toMatch(/"cheeseburger" as a single\s+item is WRONG/)
  })

  it('tells the model to name hidden oil every single time', () => {
    expect(SYSTEM_PROMPT).toMatch(/stated_assumptions every single time/)
  })

  it('asks for companion drinks, whose omission is a 100% error on that item', () => {
    expect(SYSTEM_PROMPT).toMatch(/COMPANION DRINKS/)
  })

  it('specifies USDA-style keys, which is an IR lever rather than a style preference', () => {
    expect(SYSTEM_PROMPT).toMatch(/chicken breast, grilled/)
  })
})

describe('local signals', () => {
  it('is empty when there is nothing to say, rather than emitting a stub block', () => {
    expect(buildLocalSignalsBlock({})).toBe('')
  })

  it('labels the block as information, not instruction', () => {
    const b = buildLocalSignalsBlock({ userHint: 'leftovers' })
    expect(b).toMatch(/<user_context>/)
    expect(b).toMatch(/not instruction/)
  })

  it('includes the user’s own calibrated containers', () => {
    const b = buildLocalSignalsBlock({
      knownContainers: [{ label: 'my cereal bowl', type: 'cereal_bowl', usableMl: 480 }],
    })
    expect(b).toMatch(/my cereal bowl/)
    expect(b).toMatch(/480 ml/)
  })
})

describe('provider wire formats', () => {
  it('uses x-api-key for an Anthropic API key and Bearer for a setup token', () => {
    const k = buildAnthropicRequest(base, { kind: 'api_key', value: 'sk-ant-x' })
    const o = buildAnthropicRequest(base, { kind: 'oauth', value: 'tok' })
    expect(k.headers['x-api-key']).toBe('sk-ant-x')
    expect(k.headers['authorization']).toBeUndefined()
    expect(k.headers['anthropic-beta']).toBeUndefined()
    expect(o.headers['authorization']).toBe('Bearer tok')
    expect(o.headers['x-api-key']).toBeUndefined()
    // A setup-token 401s on /v1/messages without this, even when valid.
    expect(o.headers['anthropic-beta']).toBe('oauth-2025-04-20')
  })

  it('puts the system prompt in the system field for every provider', () => {
    const a = buildAnthropicRequest(base, { kind: 'api_key', value: 'k' }).body as any
    const g = buildGeminiRequest(base, 'k').body as any
    const o = buildOpenAIRequest(base, 'k').body as any
    expect(a.system).toBe(SYSTEM_PROMPT)
    expect(g.system_instruction.parts[0].text).toBe(SYSTEM_PROMPT)
    expect(o.messages[0].content).toBe(SYSTEM_PROMPT)
  })

  it('keeps per-scan context in the USER turn so the cached prefix stays stable', () => {
    const withCtx = { ...base, localSignalsBlock: '<user_context>hi</user_context>' }
    const a = buildAnthropicRequest(withCtx, { kind: 'api_key', value: 'k' }).body as any
    expect(a.system).toBe(SYSTEM_PROMPT)
    expect(JSON.stringify(a.messages)).toContain('user_context')
  })

  it('requests strict structured output from OpenAI', () => {
    const o = buildOpenAIRequest(base, 'k').body as any
    expect(o.response_format.json_schema.strict).toBe(true)
  })

  it('records the prompt version on every request', () => {
    for (const r of [
      buildAnthropicRequest(base, { kind: 'api_key', value: 'k' }),
      buildOpenAIRequest(base, 'k'),
      buildGeminiRequest(base, 'k'),
    ]) {
      expect(r.promptVersion).toBe(PROMPT_VERSION)
    }
  })
})

describe('the provider picker is neutral', () => {
  it('sorts by price with no recommended badge anywhere', () => {
    const order = providersByPrice()
    const costs = order.map((p) => Math.min(...PROVIDER_MODELS[p].map((m) => m.approxScanCostUsd)))
    expect([...costs].sort((a, b) => a - b)).toEqual(costs)
  })

  it('pre-selects the cheapest vision model within a provider', () => {
    for (const p of providersByPrice()) {
      const cheapest = cheapestModel(p)
      for (const m of PROVIDER_MODELS[p]) {
        expect(cheapest.approxScanCostUsd).toBeLessThanOrEqual(m.approxScanCostUsd)
      }
    }
  })
})

describe('the Gemini free tier is blocked for photo scans', () => {
  it('blocks unpaid Google keys and nothing else', () => {
    // Google's terms: "Do not submit sensitive, confidential, or personal
    // information to the Unpaid Services." A meal photo is health data.
    expect(isGeminiFreeTierBlocked('google', false)).toBe(true)
    expect(isGeminiFreeTierBlocked('google', true)).toBe(false)
    expect(isGeminiFreeTierBlocked('anthropic', false)).toBe(false)
    expect(isGeminiFreeTierBlocked('openai', false)).toBe(false)
  })
})

describe('cost', () => {
  it('computes from real token counts, not an estimate', () => {
    const c = computeScanCost('anthropic', 'claude-haiku-4-5-20251001', 1500, 800)
    expect(c).toBeCloseTo((1500 / 1e6) * 1 + (800 / 1e6) * 5, 9)
  })

  // P2-9 + P3-7: an unknown model (every custom reseller id) has NO price the
  // catalogue can justify — null, never a silent 0 that reads as free. And a
  // catalogue id typed in the wrong case still finds its row.
  it('returns null for an unknown model rather than inventing a price', () => {
    expect(computeScanCost('openai', 'not-a-model', 1000, 1000)).toBeNull()
    expect(computeScanCost('openai', 'deepseek-chat', 1000, 1000)).toBeNull()
  })

  it('matches catalogue ids case-insensitively (P3-7)', () => {
    const exact = computeScanCost('openai', 'gpt-4o-mini', 1000, 1000)
    expect(computeScanCost('openai', 'GPT-4O-MINI', 1000, 1000)).toBe(exact)
    expect(computeScanCost('openai', '  GPT-4O-MINI  ', 1000, 1000)).toBe(exact)
    expect(exact).toBeGreaterThan(0)
  })
})
