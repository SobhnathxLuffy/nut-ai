import type { ProviderId } from '@nutai/prompt'
import type { SseDelta } from '../wire/types'
import { createSseDeltaParser as createParserFromHook } from '../wire/sse'
import * as openai from './openai'
import * as anthropic from './anthropic'
import * as google from './google'

/**
 * Per-provider transport wiring (QA Wave 4 god-file split).
 *
 * This is the ONLY place that maps a ProviderId to its transport module. Call
 * modules take a provider and stay shape-agnostic; adding a fourth provider
 * means adding a module and one line per table below.
 */

export const scanPayloadExtractors: Record<ProviderId, (j: Record<string, any>) => { text: unknown } | null> = {
  openai: openai.openAiScanPayload,
  anthropic: anthropic.anthropicScanPayload,
  google: google.googleScanPayload,
}

export function visionTextFor(provider: ProviderId): (j: Record<string, any>) => string | null {
  if (provider === 'openai') return openai.openAiVisionText
  if (provider === 'anthropic') return anthropic.anthropicVisionText
  return google.googleVisionText
}

export function lookupTextFor(provider: ProviderId): (j: Record<string, any>) => string | null {
  if (provider === 'openai') return openai.openAiLookupText
  if (provider === 'anthropic') return anthropic.anthropicVisionText
  return google.googleVisionText
}

/** Legacy 2-arg full-completion extraction (client.ts public surface). */
export function extractFullCompletion(provider: ProviderId, j: any): SseDelta {
  if (provider === 'openai') return openai.openAiFullCompletion(j)
  if (provider === 'anthropic') return anthropic.anthropicFullCompletion(j)
  return google.googleFullCompletion(j)
}

/** Legacy 1-arg SSE parser factory (client.ts public surface). */
export function createSseDeltaParser(provider: ProviderId): (chunk: string) => SseDelta[] {
  const hook =
    provider === 'openai'
      ? openai.openAiStreamDeltas
      : provider === 'anthropic'
        ? anthropic.anthropicStreamDeltas
        : google.googleStreamDeltas
  return createParserFromHook(hook)
}

export interface ChatRequestOpts {
  baseUrl: string | null | undefined
  credentialValue: string
  model: string
  systemPrompt: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  userPrompt: string
}

/** Non-streaming chat request per provider. */
export function chatRequestFor(provider: ProviderId, opts: ChatRequestOpts): { url: string; headers: Record<string, string>; body: unknown } {
  if (provider === 'openai') return openai.openAiChatRequest(opts)
  if (provider === 'anthropic') return anthropic.anthropicChatRequest(opts)
  return google.googleChatRequest(opts)
}

/** Streaming (SSE) chat request per provider. */
export function streamRequestFor(provider: ProviderId, opts: ChatRequestOpts): { url: string; headers: Record<string, string>; body: unknown } {
  if (provider === 'openai') return openai.openAiStreamRequest(opts)
  if (provider === 'anthropic') return anthropic.anthropicStreamRequest(opts)
  return google.googleStreamRequest(opts)
}

/** Correction request per provider. */
export function correctionRequestFor(provider: ProviderId, opts: {
  baseUrl: string | null | undefined
  credentialValue: string
  model: string
  systemPrompt: string
  userPrompt: string
}): { url: string; headers: Record<string, string>; body: unknown } {
  if (provider === 'openai') return openai.openAiCorrectionRequest(opts)
  if (provider === 'anthropic') return anthropic.anthropicCorrectionRequest(opts)
  return google.googleCorrectionRequest(opts)
}
