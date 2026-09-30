import type { SseDelta } from '../wire/types'
import { googleDeltasFrom } from '../wire/sse'
import { googleModelUrl } from '@nutai/prompt'

/**
 * Google (Gemini) transport (QA Wave 4 god-file split).
 *
 * Envelope: candidates[0].content.parts[] with joined text; usage lives in
 * usageMetadata with camelCase. The key travels in the `x-goog-api-key`
 * HEADER (P2-12) — never in the URL query string, where it would land in
 * network-inspector logs, proxies and crash breadcrumbs.
 *
 * System prompt rides INSIDE the user message as `${system}\n\n${user}`:
 * generateContent has no separate system role in the v1beta shape we use.
 */

/** Scan envelope: first part text + usageMetadata token counts. */
export function googleScanPayload(j: Record<string, any>): { text: unknown } | null {
  return { text: j.candidates?.[0]?.content?.parts?.[0]?.text }
}

/** Vision/JSON one-shot envelope: all parts' text joined. */
export function googleVisionText(j: Record<string, any>): string | null {
  return (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('') || null
}

/** Non-streamed completion body → (text, reasoning) with thought-part split. */
export function googleFullCompletion(j: any): SseDelta {
  let text = ''
  let reasoning = ''
  for (const p of j?.candidates?.[0]?.content?.parts ?? []) {
    if (typeof p?.text !== 'string') continue
    if (p.thought === true) reasoning += p.text
    else text += p.text
  }
  return { text, reasoning }
}

export const googleStreamDeltas = googleDeltasFrom

/** Chat (non-streaming) request. */
export function googleChatRequest(opts: {
  credentialValue: string
  model: string
  systemPrompt: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  userPrompt: string
}): { url: string; headers: Record<string, string>; body: unknown } {
  return {
    url: googleModelUrl(opts.model),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': opts.credentialValue,
    },
    body: {
      contents: [
        ...opts.history.map((t) => ({
          role: t.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: t.content }],
        })),
        { role: 'user', parts: [{ text: `${opts.systemPrompt}\n\n${opts.userPrompt}` }] },
      ],
      generationConfig: { maxOutputTokens: 2048 },
    },
  }
}

/** Streaming chat request (SSE via alt=sse). */
export function googleStreamRequest(opts: {
  credentialValue: string
  model: string
  systemPrompt: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  userPrompt: string
}): { url: string; headers: Record<string, string>; body: unknown } {
  return {
    url: googleModelUrl(opts.model, 'streamGenerateContent'),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.credentialValue },
    body: {
      contents: [
        ...opts.history.map((t) => ({
          role: t.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: t.content }],
        })),
        { role: 'user', parts: [{ text: `${opts.systemPrompt}\n\n${opts.userPrompt}` }] },
      ],
      generationConfig: { maxOutputTokens: 2048 },
    },
  }
}

/** Correction request: single contents entry with responseMimeType json. */
export function googleCorrectionRequest(opts: {
  credentialValue: string
  model: string
  systemPrompt: string
  userPrompt: string
}): { url: string; headers: Record<string, string>; body: unknown } {
  return {
    url: googleModelUrl(opts.model),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.credentialValue },
    body: {
      contents: [{ role: 'user', parts: [{ text: `${opts.systemPrompt}\n\n${opts.userPrompt}` }] }],
      generationConfig: { responseMimeType: 'application/json' },
    },
  }
}
