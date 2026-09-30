import type { ProviderId } from '@nutai/prompt'
import { loadCredential } from '../../credentials'
import type { AssistantStreamHandlers, AssistantStreamOutcome, ChatTurn } from '../wire/types'
import { extractFullCompletion, streamRequestFor } from '../transports'
import { runXhrStream } from '../wire/sse'
import { withBaseUrl } from '../../base-url'

/**
 * Streaming assistant chat (QA Wave 4 god-file split).
 *
 * The scan path stays deliberately non-streaming (one request, one JSON
 * object). The CHATBOT is the opposite: a silent 20-second wait reads as a
 * broken app, and reasoning models spend most of that time thinking. Both
 * problems share one fix — stream.
 *
 * All provider request shapes and SSE parsing live in the transports and the
 * shared SSE core; this module only wires credentials + request + hooks.
 */
export async function runAssistantChatApiStream(
  req: {
    provider: ProviderId
    model: string
    systemPrompt: string
    userPrompt: string
    history?: ChatTurn[]
    baseUrl?: string | null
    /** Guards the "no bytes at all" case; streaming itself is unbounded. */
    stallTimeoutMs?: number
  },
  handlers: AssistantStreamHandlers = {},
  xhrFactory: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<AssistantStreamOutcome> {
  const credObj = await loadCredential(req.provider)
  if (!credObj || !credObj.value) {
    return {
      ok: false,
      text: '',
      reasoning: '',
      error: { kind: 'key-invalid', message: `No credentials for ${req.provider}`, retryable: false },
    }
  }

  const history = normalizeHistoryLocal(req.history ?? [])
  // GATEWAY ROUTING: a custom base URL speaks the OpenAI-compatible dialect
  // for EVERY provider (same rule as the scan path) — request built, SSE
  // deltas and full-body extraction all read the openai shapes.
  const dialect: ProviderId = req.baseUrl ? 'openai' : req.provider
  const built = streamRequestFor(dialect, {
    baseUrl: req.baseUrl,
    credentialValue: credObj.value,
    model: req.model,
    systemPrompt: req.systemPrompt,
    history,
    userPrompt: req.userPrompt,
  })

  return runXhrStream({
    provider: dialect,
    request: {
      url: withBaseUrl(built.url, req.baseUrl),
      headers: built.headers,
      body: JSON.stringify(built.body),
    },
    extractFullCompletion: (j) => extractFullCompletion(dialect, j),
    handlers,
    xhrFactory,
    stallTimeoutMs: req.stallTimeoutMs,
  })
}

/** Same merge rule as calls/chat.ts — kept in sync by contract tests. */
function normalizeHistoryLocal(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = []
  for (const turn of turns) {
    if (!turn.content?.trim()) continue
    const last = out.length > 0 ? out[out.length - 1] : null
    if (last && last.role === turn.role) {
      out[out.length - 1] = { role: last.role, content: `${last.content}\n\n${turn.content}` }
    } else {
      out.push({ role: turn.role, content: turn.content })
    }
  }
  return out
}
