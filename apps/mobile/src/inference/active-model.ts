import { cheapestModel, type ProviderId } from '@nutai/prompt'
import { customProviderBaseUrl, setting } from '../data/repo'

/**
 * The small "which model am I talking to" line shown under the assistant
 * header and on the scan screen. Demand-driven transparency: the user picked
 * (or asked about) a specific model — the app should show exactly what runs,
 * including the reseller host when one is configured.
 */

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export function composeModelLine(modelId: string, baseUrl: string | null, provider: ProviderId): string {
  const host = hostOf(baseUrl)
  return host ? `${modelId} · ${host}` : `${modelId} · ${PROVIDER_LABEL[provider] ?? provider}`
}

/**
 * Resolves the model line the same way each consumer resolves its own calls:
 * chat prefers assistant_model (falling back to the scan model), scan reads
 * provider_model. Null when no provider is configured — callers hide the line.
 */
export async function describeActiveModel(scope: 'scan' | 'chat'): Promise<string | null> {
  try {
    const provider = (await setting('provider')) as ProviderId | 'none' | ''
    if (!provider || provider === 'none') return null
    const model =
      scope === 'chat'
        ? (await setting('assistant_model')) || (await setting('provider_model')) || cheapestModel(provider).id
        : (await setting('provider_model')) || cheapestModel(provider).id
    const base = await customProviderBaseUrl()
    return composeModelLine(model, base, provider)
  } catch {
    return null
  }
}
