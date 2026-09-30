import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VISION_WIRE_SCHEMA } from '@nutai/core-schema'
import {
  buildAnthropicRequest,
  buildGeminiRequest,
  buildOpenAIRequest,
  PROMPT_VERSION,
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
    // commit — the version rides the scan ledger.
    expect(PROMPT_VERSION).toBe('food-scan-v1.1.0')
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
    expect(body['max_tokens']).toBe(4096)
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
const SYSTEM_PROMPT_GOLDEN_SHA256 = '11c7ac4a27962a8d2ea3c28bac81b15d793b52c247a4dcfcb617bbbe32defc46'
