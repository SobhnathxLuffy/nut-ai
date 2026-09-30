import { SYSTEM_PROMPT, PROMPT_VERSION } from './system-prompt.js'
import { sanitizeJsonSchemaForWire, schemaContractBlock } from './schema-compat.js'

/**
 * Provider wire formats.
 *
 * SPEC-accuracy-engine.md §3.3 and §3.5. One canonical schema, three emitted
 * shapes. This module builds request BODIES only — it performs no I/O, holds no
 * credentials, and imports nothing platform-specific, so the eval harness can
 * diff the exact bytes each provider would receive without a network stack.
 *
 * The differences between providers are small but each one is load-bearing:
 *
 *   Anthropic  rejects numeric and length bounds in structured-output schemas, so
 *              minimum/maximum/minItems/pattern must be stripped. They live in the
 *              Zod validator instead, enforced client-side for ALL providers
 *              uniformly — which is what actually matters.
 *   OpenAI     strict mode has no concept of optional-but-not-required, so every
 *              property must appear in `required` and nullability is expressed as
 *              a type union.
 *   Gemini     accepts a looser shape, and its FREE TIER is blocked entirely for
 *              photo scans (see isGeminiFreeTierBlocked).
 */

export type ProviderId = 'anthropic' | 'openai' | 'google'

export interface ProviderModel {
  id: string
  label: string
  /** USD per million input tokens. */
  inputPerMTok: number
  outputPerMTok: number
  /** Rough cost of one 1024px meal photo scan, in USD. */
  approxScanCostUsd: number
}

/**
 * Model catalogue.
 *
 * The picker is NEUTRAL: price-sorted, no "recommended" badge, no pre-selected
 * provider. Within a chosen provider the cheapest vision-capable model is
 * pre-selected — which is honest rather than a compromise, because the literature
 * says frontier models are NOT better at portion math, which is the dominant error
 * source. Paying 5-30x buys identification quality we mostly already have.
 */
export const PROVIDER_MODELS: Record<ProviderId, ProviderModel[]> = {
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', inputPerMTok: 0.15, outputPerMTok: 0.6, approxScanCostUsd: 0.0009 },
    { id: 'gpt-4o', label: 'GPT-4o', inputPerMTok: 2.5, outputPerMTok: 10, approxScanCostUsd: 0.012 },
  ],
  google: [
    { id: 'gemini-2.0-flash-lite', label: 'Gemini Flash-Lite', inputPerMTok: 0.075, outputPerMTok: 0.3, approxScanCostUsd: 0.0024 },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', inputPerMTok: 1.25, outputPerMTok: 10, approxScanCostUsd: 0.02 },
  ],
  anthropic: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', inputPerMTok: 1, outputPerMTok: 5, approxScanCostUsd: 0.005 },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', inputPerMTok: 3, outputPerMTok: 15, approxScanCostUsd: 0.018 },
  ],
}

/** Providers sorted cheapest-first. No badges, no editorializing. */
export function providersByPrice(): ProviderId[] {
  return (Object.keys(PROVIDER_MODELS) as ProviderId[]).sort((a, b) => {
    const ca = Math.min(...PROVIDER_MODELS[a].map((m) => m.approxScanCostUsd))
    const cb = Math.min(...PROVIDER_MODELS[b].map((m) => m.approxScanCostUsd))
    return ca - cb
  })
}

export function cheapestModel(provider: ProviderId): ProviderModel {
  const models = PROVIDER_MODELS[provider]
  return models.reduce((a, b) => (a.approxScanCostUsd <= b.approxScanCostUsd ? a : b))
}

/**
 * Google's Gemini API Terms state, verbatim: "Do not submit sensitive,
 * confidential, or personal information to the Unpaid Services."
 *
 * A meal photo is special-category health data by the industry's own privacy-policy
 * classification. Offering the free tier for photo scans would put the USER in
 * breach of Google's terms, so we block it and explain why in the UI rather than
 * letting them find out later.
 */
export function isGeminiFreeTierBlocked(provider: ProviderId, isPaidTier: boolean): boolean {
  return provider === 'google' && !isPaidTier
}

export interface BuildRequestInput {
  // No `provider` field: each builder below IS the provider, so carrying one
  // would let a caller pass 'openai' to buildAnthropicRequest and have the types
  // agree with a request that cannot work.
  model: string
  /** Base64 JPEG, already resized and EXIF-baked by the preprocess stage. */
  imagesBase64: readonly string[]
  /** The labeled user-context block, or empty string. */
  localSignalsBlock: string
  /**
   * The provider-dialect wire schema, or null to skip structured-output mode
   * entirely and rely on the prompt + client-side Zod. Null is the retry path
   * when a provider rejects the schema dialect with a structural 400 — a scan
   * that degrades to prompt-shaped JSON beats a scan that fails.
   */
  jsonSchema: unknown
  /**
   * The ORIGINAL wire schema, used when `jsonSchema` is null (the structural-
   * 400 retry): instead of structured-output mode, the schema ships as TEXT
   * inside the instruction, so even gateways with no schema support receive a
   * complete field contract. Without it, free-form `json_object` answers
   * drifted — missing schema_version, enums, gram estimates — and failed the
   * client-side Zod pass. Null/undefined when structured-output mode is on.
   */
  instructionSchema?: unknown
  maxTokens?: number
}

export interface ProviderRequest {
  url: string
  headers: Record<string, string>
  body: unknown
  promptVersion: string
}

const USER_INSTRUCTION =
  'Analyze the meal in the attached photo(s) and respond with only the JSON object.'

/**
 * Anthropic. Two credential shapes exist and they are NOT interchangeable:
 * a normal API key uses `x-api-key`, while a `claude setup-token` credential is a
 * bearer token that additionally REQUIRES the `anthropic-beta` OAuth header —
 * without it the messages endpoint 401s even for a perfectly valid token.
 */
export const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20'

export function buildAnthropicRequest(input: BuildRequestInput, credential: { kind: 'api_key' | 'oauth'; value: string }): ProviderRequest {
  const headers: Record<string, string> =
    credential.kind === 'api_key'
      ? { 'x-api-key': credential.value, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : {
          authorization: `Bearer ${credential.value}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': ANTHROPIC_OAUTH_BETA,
          'content-type': 'application/json',
        }

  const content: unknown[] = input.imagesBase64.map((data) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data },
  }))
  const baseText = input.localSignalsBlock
    ? `${input.localSignalsBlock}\n\n${USER_INSTRUCTION}`
    : USER_INSTRUCTION
  // Structured-output mode rejected with a 400 earlier: ship the schema as
  // text so the free-form answer still carries every required field.
  const text =
    input.jsonSchema == null && input.instructionSchema != null
      ? `${baseText}\n\n${schemaContractBlock(sanitizeJsonSchemaForWire(input.instructionSchema as Record<string, unknown>) ?? (input.instructionSchema as Record<string, unknown>))}`
      : baseText
  content.push({ type: 'text', text })

  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers,
    body: {
      model: input.model,
      max_tokens: input.maxTokens ?? 4096,
      // P3-8 (QA Wave 4): the ~4.5K-token system prompt used to be re-sent
      // byte-identical on EVERY scan with no caching arrangement. Marking the
      // system block cache_control: ephemeral makes Anthropic cache it — the
      // cached prefix is billed at 1/10th input price on the next call within
      // the 5-minute TTL. OpenAI and Gemini keep their stable prefixes (they
      // already are), so no wire change is needed for them.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
      ...(input.jsonSchema == null
        ? {}
        : { output_config: { format: { type: 'json_schema', schema: input.jsonSchema } } }),
    },
    promptVersion: PROMPT_VERSION,
  }
}

export function buildOpenAIRequest(input: BuildRequestInput, apiKey: string): ProviderRequest {
  const content: unknown[] = input.imagesBase64.map((data) => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${data}` },
  }))
  const baseText = input.localSignalsBlock
    ? `${input.localSignalsBlock}\n\n${USER_INSTRUCTION}`
    : USER_INSTRUCTION
  const text =
    input.jsonSchema == null && input.instructionSchema != null
      ? `${baseText}\n\n${schemaContractBlock(sanitizeJsonSchemaForWire(input.instructionSchema as Record<string, unknown>) ?? (input.instructionSchema as Record<string, unknown>))}`
      : baseText
  content.unshift({ type: 'text', text })

  // The wire schema is SANITIZED: nullable type-arrays ("type": ["string",
  // "null"]) and anyOf null-branches are flattened, because OpenAI-compatible
  // gateways implemented in Go (aicredits.in and others) cannot unmarshal type
  // unions and 400 the ENTIRE scan before it ever reaches the model. Official
  // OpenAI accepts both shapes, and the flattened one stays true to the Zod
  // validator — it merely stops offering null, so the model answers "" or 0,
  // which parse identically on our side.
  const wireSchema =
    input.jsonSchema == null
      ? null
      : sanitizeJsonSchemaForWire(input.jsonSchema as Record<string, unknown>) ?? input.jsonSchema

  return {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: {
      model: input.model,
      max_tokens: input.maxTokens ?? 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
      ...(wireSchema == null
        ? { response_format: { type: 'json_object' } }
        : {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'VisionPayload', strict: true, schema: wireSchema },
            },
          }),
    },
    promptVersion: PROMPT_VERSION,
  }
}

export function buildGeminiRequest(input: BuildRequestInput, apiKey: string): ProviderRequest {
  const parts: unknown[] = input.imagesBase64.map((data) => ({
    inline_data: { mime_type: 'image/jpeg', data },
  }))
  const baseText = input.localSignalsBlock
    ? `${input.localSignalsBlock}\n\n${USER_INSTRUCTION}`
    : USER_INSTRUCTION
  const text =
    input.jsonSchema == null && input.instructionSchema != null
      ? `${baseText}\n\n${schemaContractBlock(sanitizeJsonSchemaForWire(input.instructionSchema as Record<string, unknown>) ?? (input.instructionSchema as Record<string, unknown>))}`
      : baseText
  parts.push({ text })

  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(input.jsonSchema == null ? {} : { responseSchema: input.jsonSchema }),
        maxOutputTokens: input.maxTokens ?? 4096,
      },
    },
    promptVersion: PROMPT_VERSION,
  }
}

/**
 * Cost of one scan from real token counts. Never an estimate once the call
 * returns.
 *
 * P2-9 + P3-7: a model id outside the catalogue (every custom reseller id) has
 * NO honest price — returning 0 silently under-reported exactly the scans
 * reseller users run, and case-sensitive matching dropped even catalogue ids
 * typed in the wrong case. Unknown models return null: the ledger and the UI
 * render "cost unknown" instead of a lie, and catalogue matching is
 * case-insensitive.
 */
export function computeScanCost(
  provider: ProviderId,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const needle = modelId.trim().toLowerCase()
  const model = PROVIDER_MODELS[provider].find((m) => m.id.toLowerCase() === needle)
  if (!model) return null
  return (inputTokens / 1_000_000) * model.inputPerMTok + (outputTokens / 1_000_000) * model.outputPerMTok
}
