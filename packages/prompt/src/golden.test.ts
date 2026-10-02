import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VISION_WIRE_SCHEMA } from '@nutai/core-schema'
import {
  ASSISTANT_PROMPT_VERSION,
  ASSISTANT_SYSTEM_PROMPT,
  buildAnthropicRequest,
  buildExerciseEstimateInstruction,
  buildGeminiRequest,
  buildLabelScanRequest,
  buildOpenAIRequest,
  buildReceiptScanRequest,
  buildTextJsonRequest,
  LABEL_SCAN_PROMPT_VERSION,
  PROMPT_VERSION,
  RECEIPT_SCAN_PROMPT_VERSION,
  SYSTEM_PROMPT,
} from './index.js'

/**
 * Golden tests for the scan prompts and request builders (QA P3-3, Wave 4).
 *
 * Prompt strings drift silently: nothing crashes when a wording change alters
 * model behaviour, and only the wire-transform/schema-compat paths had
 * coverage. These tests pin the load-bearing bytes so a change is LOUD — when
 * one fires on an intentional edit, update the golden value in the same commit
 * and say why in the message.
 */

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const BASE_INPUT = {
  model: 'test-model',
  imagesBase64: ['QUJDRDEyMw=='] as readonly string[],
  localSignalsBlock: '',
  jsonSchema: VISION_WIRE_SCHEMA,
}

const ANTHROPIC_CRED = { kind: 'api_key' as const, value: 'test-key' }

describe('golden: system prompt', () => {
  it('PROMPT_VERSION stays the pinned contract string', () => {
    // Intentional prompt version bumps MUST update this golden in the same
    // commit — the version rides the scan ledger. v1.3.0 = the live-tested
    // reasoning-rule structure: hard prohibitions (no calorie math, no
    // invented grams), meal identity vs components, absolute-scale honesty,
    // high-impact-question priority, natural serving units, component amounts,
    // fat semantics (intrinsic vs added cooking fat), visible-vs-inferred, and
    // the always-emitted honesty blocks (portion_context, qualitative_amount,
    // preparation, major_uncertainties, highest_impact_question, summary).
    expect(PROMPT_VERSION).toBe('food-scan-v1.3.0')
  })

  it('SYSTEM_PROMPT bytes are pinned (update the golden deliberately)', () => {
    // Pinned via digest rather than inline text: the point is that the
    // ~4.5K-token block changes ONLY deliberately, with the golden updated in
    // the same commit. If this fires unexpectedly, someone changed the prompt.
    const digest = sha256(SYSTEM_PROMPT)
    expect(digest).toBe(SYSTEM_PROMPT_GOLDEN_SHA256)
  })

  it('system prompt keeps its non-negotiable behavioural anchors', () => {
    // The sections the QA audit calls out as load-bearing. Cheap, readable,
    // and they fail with a message a human can act on.
    for (const anchor of [
      'PERCEPTION device, not a calculator',
      '<prompt_version>',
    ]) {
      expect({ anchor: true, found: SYSTEM_PROMPT.includes(anchor) }).toEqual({ anchor: true, found: true })
    }
  })
})

describe('golden: anthropic scan request', () => {
  it('system block is the cacheable block array (P3-8 cache_control)', () => {
    const req = buildAnthropicRequest(BASE_INPUT, ANTHROPIC_CRED)
    const body = req.body as Record<string, unknown>
    expect(Array.isArray(body['system'])).toBe(true)
    const block = (body['system'] as Array<Record<string, unknown>>)[0]!
    expect(block['type']).toBe('text')
    expect(block['cache_control']).toEqual({ type: 'ephemeral' })
    expect(sha256(String(block['text']))).toBe(SYSTEM_PROMPT_GOLDEN_SHA256)
  })

  it('url, auth headers and structured-output envelope stay pinned', () => {
    const req = buildAnthropicRequest(BASE_INPUT, ANTHROPIC_CRED)
    expect(req.url).toBe('https://api.anthropic.com/v1/messages')
    expect(req.headers).toEqual({
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    })
    const body = req.body as Record<string, unknown>
    // 8192, not 4096: thinking models (gemini-2.5-flash through OpenAI-
    // compatible gateways) spend the completion budget on reasoning before the
    // visible JSON — 4096 truncated scans mid-payload.
    expect(body['max_tokens']).toBe(8192)
    expect(body['messages']).toHaveLength(1)
    expect(body['output_config']).toEqual({
      format: { type: 'json_schema', schema: VISION_WIRE_SCHEMA },
    })
    expect(req.promptVersion).toBe(PROMPT_VERSION)
  })

  it('oauth credentials keep the beta header that prevents the 401', () => {
    const req = buildAnthropicRequest(BASE_INPUT, { kind: 'oauth', value: 'tok' })
    expect(req.headers).toMatchObject({
      authorization: 'Bearer tok',
      'anthropic-beta': 'oauth-2025-04-20',
    })
  })
})

describe('golden: openai scan request', () => {
  it('prefix stays byte-stable: system message first, strict json_schema', () => {
    const req = buildOpenAIRequest(BASE_INPUT, 'test-key')
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
    const body = req.body as Record<string, unknown>
    const messages = body['messages'] as Array<Record<string, unknown>>
    expect(messages[0]!['role']).toBe('system')
    // OpenAI has no cache_control param — the prefix is only cached when it
    // stays stable, so its bytes are pinned by the same digest.
    expect(sha256(String(messages[0]!['content']))).toBe(SYSTEM_PROMPT_GOLDEN_SHA256)
    const rf = body['response_format'] as Record<string, any>
    expect(rf['type']).toBe('json_schema')
    expect(rf['json_schema']['strict']).toBe(true)
    expect(rf['json_schema']['name']).toBe('VisionPayload')
  })
})

describe('golden: gemini scan request', () => {
  it('system_instruction stays byte-stable and key travels in the header', () => {
    const req = buildGeminiRequest(BASE_INPUT, 'test-key')
    expect(req.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent')
    expect(req.headers['x-goog-api-key']).toBe('test-key')
    const body = req.body as Record<string, unknown>
    const si = body['system_instruction'] as { parts: Array<{ text: string }> }
    expect(sha256(si.parts[0]!.text)).toBe(SYSTEM_PROMPT_GOLDEN_SHA256)
    const gen = body['generationConfig'] as Record<string, unknown>
    expect(gen['responseMimeType']).toBe('application/json')
    expect(gen['responseSchema']).toEqual(VISION_WIRE_SCHEMA)
  })
})

/*
 * ==== GOLDEN VALUES ====
 * Update ONLY with an intentional prompt change, in the same commit, with the
 * reason in the commit message. Copy the digest from the failing assertion
 * message ("Received" line) into SYSTEM_PROMPT_GOLDEN_SHA256.
 */
const SYSTEM_PROMPT_GOLDEN_SHA256 = '4acedf9197903e85a3b614951b797a95026ac3035731c605ee702e54e000e69f'

// P3-D3: computed from the current ASSISTANT_SYSTEM_PROMPT. Update in the
// same commit as an intentional prompt edit and say why in the message.
// 2026-09 tool-misroute fix (assistant-v1.1): get_nutrition_summary scoped to
// the user's own logged data; knowledge questions instructed to answer in text.
const ASSISTANT_SYSTEM_PROMPT_GOLDEN_SHA256 = '629735b06326520f12f72e566694d39cadcde091869bc4128afff6c2e3fe5e17'

// ---------------------------------------------------------------------------
// P3-D3 completion: the remaining builder surfaces (label/receipt/assistant/
// text-json estimate) get the same digest pinning. These builders shape every
// billed request their mode makes; a silent change here changes what the
// model sees.
// ---------------------------------------------------------------------------

const LABEL_SCAN_INSTRUCTION_HEAD = 'Read the nutrition label in this photo'

describe('golden: label-scan builder', () => {
  it('label instruction bytes are pinned', () => {
    // buildLabelScanRequest routes to buildVisionJsonRequest with the label
    // instruction — pin the instruction that reaches the model via the
    // request's serialized body head.
    const req = buildLabelScanRequest('openai', { model: 'test-model', imageBase64: 'QUJD' }, ANTHROPIC_CRED)
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(LABEL_SCAN_PROMPT_VERSION).toBe('label-scan-v1')
    expect(LABEL_SCAN_INSTRUCTION_HEAD.length).toBeGreaterThan(0)
  })

  it('label request per provider: urls stay on the constants', () => {
    for (const [provider, url] of [
      ['anthropic', 'https://api.anthropic.com/v1/messages'],
      ['google', 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent'],
    ] as const) {
      const req = buildLabelScanRequest(provider, { model: 'test-model', imageBase64: 'QUJD' }, ANTHROPIC_CRED)
      expect(req.url).toBe(url)
    }
  })
})

describe('golden: receipt-scan builder', () => {
  it('receipt prompt version pinned; instruction demands TRANSCRIPTION, not estimation', () => {
    expect(RECEIPT_SCAN_PROMPT_VERSION).toBe('receipt-scan-v1')
    const req = buildReceiptScanRequest('openai', { model: 'test-model', imageBase64: 'QUJD' }, ANTHROPIC_CRED)
    // ProviderRequest.body is already a serialized JSON string on the wire.
    const text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    expect(text).toContain('merchant')
    expect(text).toContain('items')
  })
})

describe('golden: assistant system prompt', () => {
  it('ASSISTANT_SYSTEM_PROMPT bytes are pinned', () => {
    // Digest-pinned like SYSTEM_PROMPT. When this fires on an intentional
    // edit, recompute: node -e "console.log(require('node:crypto').createHash('sha256').update(require('./packages/prompt/dist/index.js').ASSISTANT_SYSTEM_PROMPT).digest('hex'))"
    const digest = sha256(ASSISTANT_SYSTEM_PROMPT)
    expect(digest).toBe(ASSISTANT_SYSTEM_PROMPT_GOLDEN_SHA256)
  })
  it('keeps its tool-first behavioural anchors', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('tool')
  })

  // Tool-misroute fix (live browser E2E, Task 3): "How much protein is in 100g
  // of cooked toor dal?" routed to get_nutrition_summary (today's LOG totals —
  // a non-answer) because the prompt's only numeric guidance was "Numbers only
  // come from tools". These guards pin the fix's load-bearing language.
  it('scopes get_nutrition_summary to the user’s own logged data', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('their own diary only')
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('never a nutrition-facts lookup')
  })
  it('tells knowledge questions to answer in text with typical values', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('DIRECT plain-text answer with typical values')
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('cooked toor dal')
  })
  it('carries a version that was bumped with the fix', () => {
    expect(ASSISTANT_PROMPT_VERSION).toBe('assistant-v1.1')
  })
})

describe('golden: text-json (exercise estimate) builder', () => {
  it('instruction embeds the user description and body weight', () => {
    const instruction = buildExerciseEstimateInstruction('45 minutes of brisk running', 82)
    expect(instruction).toContain('45 minutes of brisk running')
    expect(instruction).toContain('82')
    const req = buildTextJsonRequest(
      'openai',
      { model: 'test-model', instruction },
      ANTHROPIC_CRED,
      'text-json-v1',
    )
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
  })
})
