/**
 * Path A — the cloud inference client (public surface).
 *
 * SPEC-accuracy-engine.md §3, PLAN.md D10. A thin wrapper over React Native's
 * `fetch`, deliberately NOT the vendor Node SDKs: those assume Node runtime
 * features Hermes does not guarantee.
 *
 * This is the ONLY place in the app that reads an API key, and the key travels
 * to exactly one destination: the provider the user named.
 *
 * QA Wave 4 (god-file split): this used to be a 1,170-line module holding
 * three providers, three transport modes and the fallback logic in one file —
 * it is where both streaming P1s lived, which was not a coincidence. The
 * implementation now lives in:
 *
 *   wire/         shared types, error taxonomy, fenced-JSON extraction, the
 *                 provider-agnostic SSE/XHR core
 *   transports/   per-provider envelope shapes and request builders
 *                 (openai / anthropic / google)
 *   calls/        one module per call type (scan, vision one-shots,
 *                 web lookup, correction, chat, chat stream)
 *
 * This file is the STABLE IMPORT SURFACE: every existing consumer keeps
 * importing from 'pathA/client', and the public names below are the contract
 * the unit tests pin down.
 */

// --- Shared wire vocabulary -------------------------------------------------
export type {
  AssistantStreamHandlers,
  AssistantStreamOutcome,
  ChatTurn,
  Credential,
  ScanFailure,
  ScanFailureKind,
  ScanOutcome,
  ScanRequest,
  ScanSuccess,
  SseDelta,
  WebLookupOutcome,
} from './wire/types'

// --- Shared taxonomy and extraction -----------------------------------------
export {
  classify,
  classifyTransportError,
  serializeBody,
} from './wire/errors'
export { extractJsonObject } from './wire/json'

// --- Per-provider transport dispatch ---------------------------------------
export {
  createSseDeltaParser,
  extractFullCompletion,
} from './transports'

// --- Scan -------------------------------------------------------------------
export { runScan, runScanWithFallback } from './calls/scan'

// --- Vision-JSON one-shots ---------------------------------------------------
export { runExerciseEstimate, runLabelScan, runReceiptScan } from './calls/vision'

// --- Web lookup ---------------------------------------------------------------
export { runWebLookup } from './calls/web-lookup'

// --- Correction ---------------------------------------------------------------
export { runCorrectionIntent } from './calls/correction'

// --- Assistant chat (non-streaming + fallback chain) --------------------------
export { normalizeHistory, runAssistantChatApi, runAssistantChatApiSingle } from './calls/chat'

// --- Assistant chat (streaming) -----------------------------------------------
export { runAssistantChatApiStream } from './calls/chat-stream'
