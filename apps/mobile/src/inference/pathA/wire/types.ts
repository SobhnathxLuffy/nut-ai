import type { ProviderId } from '@nutai/prompt'

/**
 * Shared wire types for the Path A cloud client (QA Wave 4, god-file split).
 *
 * client.ts used to be a 1,170-line module holding three providers, three
 * transport modes and the fallback logic in one file. This module holds ONLY
 * the type vocabulary every transport and call shares.
 */

/** One prior assistant-conversation turn, replayed to the provider in order. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Six distinct states, never a generic toast.
 *
 * Every one of these gets its own copy and its own retry policy, because "an
 * error occurred" tells a user nothing about whether to wait, pay, re-enter a
 * key, or switch paths.
 */
export type ScanFailureKind =
  | 'key-invalid'
  | 'quota-exhausted'
  | 'model-unavailable'
  | 'error-retryable'
  | 'offline'
  | 'content-refusal'
  | 'schema-violation'
  /**
   * The provider answered HTTP 200 but marked the completion as cut off by the
   * output-token budget (OpenAI `finish_reason: "length"`, Gemini
   * `finishReason: "MAX_TOKENS"`). A truncated scan payload is garbage by
   * construction — half a JSON object parses into half a meal — so it is
   * reported HONESTLY as its own kind instead of being fished or misfiled as
   * a shape violation. Retryable: the budget is per-attempt, not per-user —
   * the retry chain is real, not aspirational: runScanWithFallback fires one
   * escalated retry at a doubled (capped) budget, and the orchestrator's
   * instruction-schema rescue is the second layer behind that.
   */
  | 'truncated'
  /**
   * A request that may or may not have been billed. NEVER auto-retried: no
   * provider offers an idempotency key for this endpoint, so a naive retry
   * double-bills the user for one photo.
   */
  | 'timeout-ambiguous'
  /**
   * P2-1: the failure happened INSIDE the app, not on the network — a request
   * the JS engine could not even prepare (oversized base64 payload), or an
   * unexpected local error. Retryable:false: retrying a request that can never
   * succeed burned time and credits on every attempt.
   */
  | 'internal-error'

export interface ScanFailure {
  kind: ScanFailureKind
  message: string
  retryable: boolean
  httpStatus?: number
}

export interface ScanSuccess {
  raw: unknown
  inputTokens: number
  outputTokens: number
  /**
   * P2-9: null when the model id is not in the catalogue (every custom
   * reseller id) — the honest "cost unknown", never a silent 0.
   */
  costUsd: number | null
  latencyMs: number
  promptVersion: string
  /**
   * The envelope's own finish marker when the provider sent one
   * (choices[0].finish_reason / candidates[0].finishReason), null when it
   * did not. Diagnostic metadata only — a 'length' answer never REACHES
   * success (it fails as kind 'truncated' first); this exists so a success
   * that rode an unusual stop reason is still auditable in the ledger.
   */
  finishReason?: string | null
}

export type ScanOutcome = { ok: true; value: ScanSuccess } | { ok: false; error: ScanFailure }

export interface Credential {
  kind: 'api_key' | 'oauth'
  value: string
}

export interface ScanRequest {
  provider: ProviderId
  model: string
  credential: Credential
  imagesBase64: readonly string[]
  localSignalsBlock: string
  jsonSchema: unknown
  /**
   * The original wire schema, carried ONLY on the structural-400 retry (see
   * runScanWithFallback) so the request can ship it as instruction text while
   * structured-output mode stays off. Ignored when jsonSchema is non-null.
   */
  instructionSchema?: unknown
  timeoutMs?: number
  /**
   * Per-attempt output budget (max_tokens / maxOutputTokens). Default is the
   * catalogue's DEFAULT_SCAN_MAX_TOKENS (8192); the truncation-escalation
   * retry in runScanWithFallback derives its HIGHER budget (doubled, capped
   * at 16384) from this base, so an explicit override raises the whole chain
   * with it and never silently resets to the default.
   */
  maxTokens?: number
  /** Optional OpenAI-compatible base URL (resellers). Only rewrites OpenAI calls. */
  baseUrl?: string | null
}

/** Outcome shape of the vision-JSON one-shots (label, receipt, web lookup). */
export interface WebLookupOutcome {
  ok: boolean
  raw?: unknown
  error?: ScanFailure
}

/** A parsed streaming delta: visible text or (DeepSeek/Qwen/GLM) reasoning. */
export interface SseDelta {
  text?: string
  reasoning?: string
}

export interface AssistantStreamHandlers {
  /** Called on the UI thread for every parsed delta, in arrival order. */
  onDelta?: (d: SseDelta) => void
  /** Filled with an abort function the caller can invoke to cancel the stream. */
  abortRef?: { current: null | (() => void) }
}

export interface AssistantStreamOutcome {
  ok: boolean
  text: string
  reasoning: string
  error?: ScanFailure
  /** True when at least one visible text delta arrived before the failure. */
  partial?: boolean
  /**
   * P2-6: the caller (or the screen going away) aborted this stream before it
   * produced an answer. The caller must NOT fire the legacy fallback call —
   * that would re-request exactly what the user just cancelled, and bill for
   * an answer nobody will read.
   */
  cancelled?: boolean
}
