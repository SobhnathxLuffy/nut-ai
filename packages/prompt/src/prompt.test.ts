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

  it('classifies the whole frame into a scene before any item is named (v1.2)', () => {
    expect(SYSTEM_PROMPT).toMatch(/Scene classification — the whole frame first/)
    expect(SYSTEM_PROMPT).toMatch(/scene\.meal_type/)
    expect(SYSTEM_PROMPT).toMatch(/indian_thali/)
  })

  it('names the SCENE for the whole meal — an eight-bowl thali is never titled by one bowl', () => {
    // The user-reported failure this section exists for: a whole thali photo
    // titled "Chapati" because the UI fell back to items[0].
    expect(SYSTEM_PROMPT).toMatch(/Indian mixed thali" — not "Chapati"/)
    expect(SYSTEM_PROMPT).toMatch(/A thali with eight bowls\s+has at least eight item entries/)
  })

  it('tells the model to mark uncertain scene components rather than hallucinating them', () => {
    expect(SYSTEM_PROMPT).toMatch(/Do not hallucinate components you cannot see/)
    expect(SYSTEM_PROMPT).toMatch(/visibility:"likely" and say why in stated_assumptions/)
  })

  it('defines the three visibility levels and ties hidden fat to assumptions', () => {
    expect(SYSTEM_PROMPT).toMatch(/"visible"\s+= clearly seen/)
    expect(SYSTEM_PROMPT).toMatch(/"likely"\s+= strongly implied/)
    expect(SYSTEM_PROMPT).toMatch(/"inferred"\s+= structurally certain but hidden/)
    expect(SYSTEM_PROMPT).toMatch(/hidden oil\/ghee is ALWAYS "inferred" plus an\s+assumption/)
  })

  it('demands an honest gram range instead of fake-precise mass on unscaled dishes', () => {
    expect(SYSTEM_PROMPT).toMatch(/model_gram_range/)
    expect(SYSTEM_PROMPT).toMatch(/is NOT automatically\s+~500 g/)
    expect(SYSTEM_PROMPT).toMatch(/WIDEN the range and\s+drop portion_confidence/)
    expect(SYSTEM_PROMPT).toMatch(/null when you cannot responsibly bound it/)
  })

  it('strengthens hidden-fat guidance for Indian cooking specifically', () => {
    expect(SYSTEM_PROMPT).toMatch(/ghee\/oil across the cooked dishes|~1\.5 tbsp ghee\/oil/)
    expect(SYSTEM_PROMPT).toMatch(/tadka/)
    expect(SYSTEM_PROMPT).toMatch(/Malai\/cream in paneer/)
    expect(SYSTEM_PROMPT).toMatch(/papad, samosa, pakora, puri/)
    expect(SYSTEM_PROMPT).toMatch(/oil_or_fat_not_visually_determinable/)
  })

  it('specifies USDA-style keys, which is an IR lever rather than a style preference', () => {
    expect(SYSTEM_PROMPT).toMatch(/chicken breast, grilled/)
  })

  it('opens with the two hard prohibitions the v1.3 contract is built on', () => {
    expect(SYSTEM_PROMPT).toMatch(
      /DO NOT calculate calories, protein, carbs, fat, or micronutrients\./,
    )
    expect(SYSTEM_PROMPT).toMatch(
      /DO NOT invent exact grams when the image has no reliable scale reference\./,
    )
  })

  it('separates MEAL IDENTITY from COMPONENTS with the pizza/thali examples', () => {
    expect(SYSTEM_PROMPT).toMatch(/Meal identity vs components/)
    expect(SYSTEM_PROMPT).toMatch(/A pizza is ONE dish even though it contains dough, sauce, cheese and toppings\./)
    expect(SYSTEM_PROMPT).toMatch(/"Components" and `items` are the same list/)
  })

  it('demands absolute-scale honesty — no fake grams without a scale reference', () => {
    expect(SYSTEM_PROMPT).toMatch(/Absolute scale — never fake grams/)
    expect(SYSTEM_PROMPT).toMatch(/An honest "unknown" beats a fake "350 g" every single time\./)
    expect(SYSTEM_PROMPT).toMatch(/portion_context\.scale_reference_available is false and/)
  })

  it('ranks the ONE highest-impact question: eaten > size > count > hidden fat > preparation', () => {
    expect(SYSTEM_PROMPT).toMatch(/Work down this priority list/)
    expect(SYSTEM_PROMPT).toMatch(/HOW MUCH of the meal was or will be eaten/)
    expect(SYSTEM_PROMPT).toMatch(/The overall SIZE of the total meal/)
    expect(SYSTEM_PROMPT).toMatch(/The NUMBER of pieces, bowls or slices/)
    expect(SYSTEM_PROMPT).toMatch(/A LARGE uncertainty in hidden cooking fat/)
    expect(SYSTEM_PROMPT).toMatch(/The preparation type — fried versus grilled versus steamed\./)
    expect(SYSTEM_PROMPT).toMatch(
      /Do NOT prioritize trivia while portion is unknown: topping counts, garnish/,
    )
  })

  it('prefers natural serving units over invented grams', () => {
    expect(SYSTEM_PROMPT).toMatch(/slice, piece, roti, paratha, katori, bowl, cup, glass, spoon, serving\./)
    expect(SYSTEM_PROMPT).toMatch(/People do not eat grams; they eat units\./)
    expect(SYSTEM_PROMPT).toMatch(/Grams \(model_gram_estimate \/ model_gram_range\) only when JUSTIFIED/)
  })

  it('counts servings, not decorative fragments, and falls back to qualitative_amount', () => {
    expect(SYSTEM_PROMPT).toMatch(/Do not count decorative fragments\./)
    expect(SYSTEM_PROMPT).toMatch(/"15 olive slices" is not portion/)
    expect(SYSTEM_PROMPT).toMatch(/"tiny" \| "light" \| "moderate" \| "heavy" \|/)
  })

  it('distinguishes intrinsic fat from fat added IN COOKING', () => {
    expect(SYSTEM_PROMPT).toMatch(/Fat semantics — intrinsic fat is not added cooking fat/)
    expect(SYSTEM_PROMPT).toMatch(/a paratha is\s*\n\s*"moderate" \(shallow-fried in ghee\)/)
    expect(SYSTEM_PROMPT).toMatch(/a deep-fried ball \(samosa,/)
    expect(SYSTEM_PROMPT).toMatch(/never to the fat the food itself contains/)
  })

  it('forbids hallucinating the foods commonly served with a meal', () => {
    expect(SYSTEM_PROMPT).toMatch(/Visible vs inferred — never hallucinate the accompaniments/)
    expect(SYSTEM_PROMPT).toMatch(/the papad that "usually comes with" a thali/)
  })

  it('documents the always-emitted meal-level honesty blocks', () => {
    expect(SYSTEM_PROMPT).toMatch(/portion_context/)
    expect(SYSTEM_PROMPT).toMatch(/whole_meal_visible/)
    expect(SYSTEM_PROMPT).toMatch(/scale_reference_description/)
    expect(SYSTEM_PROMPT).toMatch(/absolute_portion_confidence: "high" \| "medium" \|/)
    expect(SYSTEM_PROMPT).toMatch(/major_uncertainties/)
    expect(SYSTEM_PROMPT).toMatch(/impact_on_total_calories: "low" \| "medium" \| "high"/)
    expect(SYSTEM_PROMPT).toMatch(/highest_impact_question/)
    expect(SYSTEM_PROMPT).toMatch(/what_is_known, what_is_not_known/)
    expect(SYSTEM_PROMPT).toMatch(/preparation\.intrinsic_fat/)
    expect(SYSTEM_PROMPT).toMatch(/preparation\.added_cooking_fat/)
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
    // P3-8 (QA Wave 4): Anthropic's system is a BLOCK array carrying
    // cache_control so the ~4.5K-token prefix is cached server-side.
    expect(Array.isArray(a.system)).toBe(true)
    expect(a.system[0].text).toBe(SYSTEM_PROMPT)
    expect(a.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(g.system_instruction.parts[0].text).toBe(SYSTEM_PROMPT)
    expect(o.messages[0].content).toBe(SYSTEM_PROMPT)
  })

  it('keeps per-scan context in the USER turn so the cached prefix stays stable', () => {
    const withCtx = { ...base, localSignalsBlock: '<user_context>hi</user_context>' }
    const a = buildAnthropicRequest(withCtx, { kind: 'api_key', value: 'k' }).body as any
    expect(a.system[0].text).toBe(SYSTEM_PROMPT)
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
