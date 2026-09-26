import type { ProviderId } from '@nutai/prompt'

export type CredentialKind = 'api_key' | 'oauth'

export interface StoredCredential {
  kind: CredentialKind
  value: string
}

export async function saveCredential(
  provider: ProviderId,
  cred: StoredCredential,
): Promise<void> {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.setItem(`key.${provider}`, cred.value)
    window.sessionStorage.setItem(`kind.${provider}`, cred.kind)
  }
}

export async function loadCredential(provider: ProviderId): Promise<StoredCredential | null> {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    const value = window.sessionStorage.getItem(`key.${provider}`)
    if (!value) return null
    const kind = window.sessionStorage.getItem(`kind.${provider}`) as CredentialKind | null
    return { kind: kind ?? 'api_key', value }
  }
  return null
}

export async function clearCredential(provider: ProviderId): Promise<void> {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    window.sessionStorage.removeItem(`key.${provider}`)
    window.sessionStorage.removeItem(`kind.${provider}`)
  }
}

export function maskCredential(value: string): string {
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 7)}…${value.slice(-4)}`
}

export function looksPlausible(_provider: ProviderId, _kind: CredentialKind, value: string): boolean {
  return value.trim().length >= 20
}
