import type { ProviderId } from '@nutai/prompt'
import type { AssistantStreamHandlers, AssistantStreamOutcome, SseDelta, ScanFailure } from './types'
import { classify } from './errors'

/**
 * The shared SSE core (QA Wave 4 god-file split).
 *
 * Transport is XMLHttpRequest, NOT fetch: React Native's fetch cannot read an
 * incremental body, while XHR's onprogress hands us growing responseText on
 * every platform (RN, web, Node+undici in tests). The SSE wire formats are
 * parsed per provider into two lanes — visible text and reasoning — because
 * DeepSeek/Qwen/GLM-style gateways put thinking in `reasoning_content`, and
 * showing it is the difference between "it froze" and "it's thinking".
 *
 * Everything provider-SPECIFIC arrives as injected hooks (delta parsers, the
 * non-streamed completion extractor); everything provider-AGNOSTIC — the XHR
 * lifecycle, the stall guard, the byte cap, the SSE/JSON detection, the abort
 * semantics — lives here exactly once.
 */

export const STREAM_MAX_BYTES = 256_000

/**
 * Pure per-provider SSE delta parser factory. Fed raw network chunks, returns
 * the deltas they completed. Keeps a trailing-partial-line buffer internally,
 * so chunk boundaries can split anywhere — including mid-JSON.
 *
 * The provider hook receives one parsed `data:` payload object at a time and
 * returns the deltas it completed.
 */
export function createSseDeltaParser(
  deltasFromObject: (obj: any) => SseDelta[],
): (chunk: string) => SseDelta[] {
  let rest = ''
  return (chunk: string): SseDelta[] => {
    rest += chunk
    const deltas: SseDelta[] = []
    let nl: number
    while ((nl = rest.indexOf('\n')) !== -1) {
      const line = rest.slice(0, nl).replace(/\r$/, '')
      rest = rest.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let obj: any
      try {
        obj = JSON.parse(payload)
      } catch {
        continue
      }
      deltas.push(...deltasFromObject(obj))
    }
    return deltas
  }
}

/** OpenAI-family SSE delta: content lane + DeepSeek/Qwen/GLM reasoning lane. */
export function openAiDeltasFrom(obj: any): SseDelta[] {
  const d = obj?.choices?.[0]?.delta
  if (!d) return []
  const text = typeof d.content === 'string' ? d.content : ''
  const reasoning =
    typeof d.reasoning_content === 'string'
      ? d.reasoning_content
      : typeof d.reasoning === 'string'
        ? d.reasoning
        : ''
  if (!text && !reasoning) return []
  return [text ? { text } : { reasoning }]
}

/** Anthropic SSE delta: text_delta / thinking_delta block events only. */
export function anthropicDeltasFrom(obj: any): SseDelta[] {
  if (obj?.type !== 'content_block_delta') return []
  if (obj.delta?.type === 'text_delta' && typeof obj.delta.text === 'string') return [{ text: obj.delta.text }]
  if (obj.delta?.type === 'thinking_delta' && typeof obj.delta.thinking === 'string') return [{ reasoning: obj.delta.thinking }]
  return []
}

/** Gemini SSE delta: candidate parts, with thinking summaries flagged `thought`. */
export function googleDeltasFrom(obj: any): SseDelta[] {
  const parts = obj?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return []
  const out: SseDelta[] = []
  for (const p of parts) {
    if (typeof p?.text !== 'string' || !p.text) continue
    out.push(p.thought === true ? { reasoning: p.text } : { text: p.text })
  }
  return out
}

export function deltasFromFor(provider: ProviderId): (obj: any) => SseDelta[] {
  if (provider === 'openai') return openAiDeltasFrom
  if (provider === 'anthropic') return anthropicDeltasFrom
  return googleDeltasFrom
}

export interface StreamRequest {
  url: string
  headers: Record<string, string>
  body: string
}

/**
 * One streaming chat completion over XHR. NO provider fallback chain here —
 * that lives in the caller, which decides between a failed stream and the
 * legacy non-streaming call. Provider specifics are injected: `provider` only
 * selects the delta hooks and the non-streamed-body extractor.
 */
export async function runXhrStream(opts: {
  provider: ProviderId
  request: StreamRequest
  /** Extract (text, reasoning) from a NON-streamed completion body — the path
   * a gateway that ignores stream:true comes back on. */
  extractFullCompletion: (j: any) => SseDelta
  handlers?: AssistantStreamHandlers
  xhrFactory?: () => XMLHttpRequest
  /** Guards the "no bytes at all" case; streaming itself is unbounded. */
  stallTimeoutMs?: number
}): Promise<AssistantStreamOutcome> {
  const { provider, request, extractFullCompletion, handlers = {}, xhrFactory = () => new XMLHttpRequest(), stallTimeoutMs } = opts

  return await new Promise<AssistantStreamOutcome>((resolve) => {
    const xhr = xhrFactory()
    const parse = createSseDeltaParser(deltasFromFor(provider))

    let processed = 0
    // P3-A3: the stream cap is a BYTE budget, not a UTF-16 code-unit count —
    // counting responseText.length cut off legitimately long multi-byte
    // answers early. Bytes are counted incrementally per chunk (one shared
    // encoder, no per-check re-encode of the whole body).
    const byteCounter = new TextEncoder()
    let streamedBytes = 0
    let text = ''
    let reasoning = ''
    let sawSse = false
    let nonSseBody = ''
    let tooLarge = false
    let settled = false

    const finish = (outcome: AssistantStreamOutcome) => {
      if (settled) return
      settled = true
      if (handlers.abortRef) handlers.abortRef.current = null
      resolve(outcome)
    }

    let stall: ReturnType<typeof setTimeout> | null = null
    // Set just before the stall guard aborts the request, so onabort — which
    // abort() fires synchronously — defers to the stall's own finish() and the
    // real diagnosis is not replaced by 'cancelled'.
    let stallFired = false
    // Arms (or re-arms) the stall timer. Fired whenever NO bytes arrive for
    // stallTimeoutMs — either before the first byte (gateway accepted the
    // connection and went silent) or mid-stream (gateway stalled partway).
    const armStall = () => {
      if (!stallTimeoutMs) return
      if (stall) clearTimeout(stall)
      stall = setTimeout(() => {
        stallFired = true
        xhr.abort()
        finish({
          ok: false,
          text,
          reasoning,
          partial: text.length > 0,
          error: {
            kind: 'error-retryable',
            message:
              processed === 0
                ? 'The model did not start answering in time.'
                : 'The answer stalled partway through.',
            retryable: true,
          },
        })
      }, stallTimeoutMs)
    }
    armStall()

    if (handlers.abortRef) handlers.abortRef.current = () => xhr.abort()

    xhr.open('POST', request.url, true)
    for (const [k, v] of Object.entries(request.headers)) xhr.setRequestHeader(k, v)
    xhr.responseType = 'text'

    const emit = (d: SseDelta) => {
      if (d.text) text += d.text
      if (d.reasoning) reasoning += d.reasoning
      handlers.onDelta?.(d)
    }

    xhr.onprogress = () => {
      if (settled) return
      const full = xhr.responseText
      const chunk = full.slice(processed)
      processed = full.length
      // Re-arm: a fresh stallTimeoutMs window for every received chunk, so
      // mid-stream stalls are covered too, not just the pre-first-byte case.
      armStall()
      streamedBytes += byteCounter.encode(chunk).length
      if (streamedBytes > STREAM_MAX_BYTES) {
        tooLarge = true
        xhr.abort()
        return
      }
      if (!chunk) return

      if (!sawSse && !nonSseBody) {
        const head = chunk.trimStart()
        // SSE events open with "data:"/"event:" (or a leading ":" comment).
        if (head.startsWith('data:') || head.startsWith('event:') || head.startsWith(':')) {
          sawSse = true
        } else {
          // Plain JSON body — the gateway ignored stream:true. Snapshot the
          // first chunk only; settleFromFullBody parses the accumulated body
          // once load fires. (Assigning AND appending here would double the
          // first chunk — the 'AB' -> 'AAB' bug.)
          nonSseBody = chunk
          return
        }
      }
      if (nonSseBody) {
        nonSseBody += chunk
        return
      }

      for (const d of parse(chunk)) emit(d)
    }

    const settleFromFullBody = (status: number) => {
      const body = nonSseBody || xhr.responseText
      if (status >= 400) {
        finish({ ok: false, text, reasoning, partial: text.length > 0, error: classify(status, body) })
        return
      }
      let j: any
      try {
        j = JSON.parse(body)
      } catch {
        finish({
          ok: false,
          text,
          reasoning,
          partial: text.length > 0,
          error: { kind: 'schema-violation', message: 'The provider returned malformed JSON.', retryable: false },
        })
        return
      }
      const full = extractFullCompletion(j)
      if (full.text) emit({ text: full.text })
      if (full.reasoning) emit({ reasoning: full.reasoning })
      finish({ ok: true, text, reasoning })
    }

    xhr.onload = () => {
      if (stall) {
        clearTimeout(stall)
        stall = null
      }
      if (settled) return
      if (nonSseBody || xhr.status >= 400) {
        settleFromFullBody(xhr.status)
        return
      }
      // Flush any complete final line the stream ended without a newline on.
      for (const d of parse('\n')) emit(d)
      if (text.length === 0 && reasoning.length === 0) {
        // Some gateways return 200 with an empty stream when the upstream
        // failed. Let the caller fall back rather than render a blank bubble.
        finish({
          ok: false,
          text: '',
          reasoning: '',
          error: { kind: 'schema-violation', message: 'The provider returned an empty stream.', retryable: true },
        })
        return
      }
      finish({ ok: true, text, reasoning })
    }

    xhr.onerror = () => {
      if (stall) {
        clearTimeout(stall)
        stall = null
      }
      finish({
        ok: false,
        text,
        reasoning,
        partial: text.length > 0,
        error: { kind: 'offline', message: 'No connection to the provider.', retryable: true },
      })
    }

    xhr.onabort = () => {
      if (stall) {
        clearTimeout(stall)
        stall = null
      }
      if (settled) return
      // The stall guard aborted: it finishes with the real diagnosis right
      // after abort() returns — do not race it with 'cancelled'.
      if (stallFired) return
      if (tooLarge) {
        finish({
          ok: false,
          text,
          reasoning,
          partial: text.length > 0,
          error: { kind: 'schema-violation', message: 'The answer was too long to receive.', retryable: true },
        })
        return
      }
      // Caller-invoked abort (screen closed / stop pressed): surface as a
      // cancelled stream, keeping whatever already streamed in. The cancelled
      // flag (P2-6) is what stops the caller from re-requesting the identical
      // answer through the legacy non-streaming call.
      finish({
        ok: false,
        text,
        reasoning,
        partial: text.length > 0,
        cancelled: true,
        error: { kind: 'error-retryable', message: 'cancelled', retryable: true },
      })
    }

    xhr.send(request.body)
  })
}

export type { ScanFailure }
