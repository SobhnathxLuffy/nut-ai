import type { SseDelta } from '../wire/types'
import { anthropicDeltasFrom } from '../wire/sse'

/**
 * Anthropic transport (QA Wave 4 god-file split).
 *
 * Envelope: `content` is a BLOCK array (text / tool_use / thinking interleaved
 * — the answer is the LAST text block, not the first), usage counts are
 * snake_case. The system prompt is a top-level `system` field, and messages
 * must alternate strictly starting with 'user' (normalizeHistory guarantees it).
 */

/** Scan envelope: first content block text + input/output token usage. */
export function anthropicScanPayload(j: Record<string, any>): { text: unknown } | null {
  return { text: j.content?.[0]?.text }
}

/**
 * Vision/JSON one-shot envelope (label, receipt, web lookup): content is a
 * block ARRAY interleaving tool use and text; the answer is the LAST text
 * block, not the first.
 */
export function anthropicVisionText(j: Record<string, any>): string | null {
  const texts = (j.content ?? []).filter((b: any) => b?.type === 'text')
  return texts.length ? texts[texts.length - 1].text : null
}

/** Non-streamed completion body → (text, reasoning) over content blocks. */
export function anthropicFullCompletion(j: any): SseDelta {
  let text = ''
  let reasoning = ''
  for (const block of j?.content ?? []) {
    if (block?.type === 'text' && typeof block.text === 'string') text += block.text
    if (block?.type === 'thinking' && typeof block.thinking === 'string') reasoning += block.thinking
  }
  return { text, reasoning }
}

export const anthropicStreamDeltas = anthropicDeltasFrom

/** Chat (non-streaming) request. 2048 max_tokens: reasoning models spend the
 * budget on thinking before the visible answer starts — 1024 truncated them. */
export function anthropicChatRequest(opts: {
  credentialValue: string
  model: string
  systemPrompt: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  userPrompt: string
}): { url: string; headers: Record<string, string>; body: unknown } {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.credentialValue,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: opts.model,
      system: opts.systemPrompt,
      messages: [
        ...opts.history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: opts.userPrompt },
      ],
      max_tokens: 2048,
    },
  }
}

/** Streaming chat request (SSE). */
export function anthropicStreamRequest(opts: {
  credentialValue: string
  model: string
  systemPrompt: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  userPrompt: string
}): { url: string; headers: Record<string, string>; body: unknown } {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.credentialValue,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: opts.model,
      system: opts.systemPrompt,
      messages: [
        ...opts.history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: opts.userPrompt },
      ],
      max_tokens: 2048,
      stream: true,
    },
  }
}

/** Correction request: system as top-level field, json enforced by the prompt. */
export function anthropicCorrectionRequest(opts: {
  credentialValue: string
  model: string
  systemPrompt: string
  userPrompt: string
}): { url: string; headers: Record<string, string>; body: unknown } {
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.credentialValue,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: opts.model,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userPrompt }],
    },
  }
}
