import { buildWebLookupInstruction } from '@nutai/prompt'
import type { SseDelta } from '../wire/types'
import { openAiDeltasFrom } from '../wire/sse'
import { OPENAI_CHAT_URL } from '@nutai/prompt'

/**
 * OpenAI-family transport (QA Wave 4 god-file split).
 *
 * Two response shapes exist and BOTH are live:
 *   - chat-completions: official scans and every reseller gateway
 *   - Responses API:    official-endpoint server-side web lookup
 * The extractors below accept both, always preferring chat-completions.
 */

/** Scan envelope: chat-completions message content. Usage is shared code. */
export function openAiScanPayload(j: Record<string, any>): { text: unknown } | null {
  return { text: j.choices?.[0]?.message?.content }
}

/** Vision/JSON one-shot envelope (label, receipt, web lookup, correction). */
export function openAiVisionText(j: Record<string, any>): string | null {
  return j.choices?.[0]?.message?.content ?? null
}

/**
 * Web-lookup envelope: chat-completions shape takes priority (official scans
 * AND the reseller fallback); the Responses API shape is the official form.
 */
export function openAiLookupText(j: Record<string, any>): string | null {
  return (
    j.choices?.[0]?.message?.content ??
    (() => {
      const msg = (j.output ?? []).find((o: any) => o?.type === 'message')
      return msg?.content?.map((c: any) => c?.text ?? '').join('') ?? j.output_text ?? null
    })()
  )
}

/** Non-streamed completion body → (text, reasoning). */
export function openAiFullCompletion(j: any): SseDelta {
  const msg = j?.choices?.[0]?.message
  return {
    text: typeof msg?.content === 'string' ? msg.content : '',
    reasoning:
      typeof msg?.reasoning_content === 'string'
        ? msg.reasoning_content
        : typeof msg?.reasoning === 'string'
          ? msg.reasoning
          : '',
  }
}

export const openAiStreamDeltas = openAiDeltasFrom

/**
 * Chat (non-streaming) request: system + history + user, chat-completions
 * shape. `baseUrl` (reseller gateways) rewrites the endpoint; the API key
 * rides the Authorization header.
 */
export function openAiChatRequest(opts: {
  baseUrl: string | null | undefined
  credentialValue: string
  model: string
  systemPrompt: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  userPrompt: string
}): { url: string; headers: Record<string, string>; body: unknown } {
  return {
    url: OPENAI_CHAT_URL,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.credentialValue}`,
    },
    body: {
      model: opts.model,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        ...opts.history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: opts.userPrompt },
      ],
    },
  }
}

/** Streaming chat request (SSE), chat-completions shape. */
export function openAiStreamRequest(opts: {
  baseUrl: string | null | undefined
  credentialValue: string
  model: string
  systemPrompt: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  userPrompt: string
}): { url: string; headers: Record<string, string>; body: unknown } {
  return {
    url: OPENAI_CHAT_URL,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.credentialValue}` },
    body: {
      model: opts.model,
      stream: true,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        ...opts.history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: opts.userPrompt },
      ],
    },
  }
}

/** Correction request: chat-completions with json_object response format. */
export function openAiCorrectionRequest(opts: {
  baseUrl: string | null | undefined
  credentialValue: string
  model: string
  systemPrompt: string
  userPrompt: string
}): { url: string; headers: Record<string, string>; body: unknown } {
  return {
    url: OPENAI_CHAT_URL,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.credentialValue}` },
    body: {
      model: opts.model,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userPrompt },
      ],
      response_format: { type: 'json_object' },
    },
  }
}

/**
 * The OpenAI web-lookup rides the Responses API, which virtually no reseller
 * proxies (aicredits, OpenRouter: 404). On a custom base URL the same
 * instruction is sent through PLAIN chat completions instead — the model
 * answers from what it reliably knows and is told to say found:false when
 * unsure, which rescues major branded products without ever hallucinating a
 * source. Official-endpoint lookups keep the real server-side search tool
 * (built by @nutai/prompt's buildWebLookupRequest).
 */
export function openAiResellerLookupRequest(opts: {
  credentialValue: string
  model: string
  itemName: string
  brand: string | null
  visualContext?: string | null
}): { url: string; headers: Record<string, string>; body: unknown } {
  return {
    url: OPENAI_CHAT_URL,
    headers: {
      authorization: `Bearer ${opts.credentialValue}`,
      'content-type': 'application/json',
    },
    body: {
      model: opts.model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content:
            buildWebLookupInstruction(opts) +
            '\n\nYou have NO live search tool in this conversation. Use only product nutrition facts ' +
            'you are highly confident about from training (major brands, chain restaurants, packaged staples). ' +
            'When you are not confident the product matches, set "found" to false. NEVER invent a source_url — set it to null.',
        },
      ],
      response_format: { type: 'json_object' },
    },
  }
}
