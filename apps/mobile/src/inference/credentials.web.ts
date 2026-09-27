import type { ProviderId } from '@nutai/prompt'

export type CredentialKind = 'api_key' | 'oauth'

export interface StoredCredential {
  kind: CredentialKind
  value: string
}

/**
 * WEB-006 fix.
 *
 * Credentials used to live in sessionStorage, which means every browser refresh
 * silently wiped the user's API keys and dropped them back into onboarding.
 * sessionStorage also could not be shared across tabs, so a key entered in one
 * tab was invisible in another.
 *
 * Keys now live in localStorage (survives refresh and tab handoff). A one-time
 * promotion path copies any legacy sessionStorage entry into localStorage on
 * first load so nobody has to re-enter a key after upgrading. Both stores are
 * cleared together so the key never ends up in two places.
 *
 * This is still browser storage, NOT mobile SecureStore — same-origin JS can
 * read it, and that trade-off is documented in provider settings. The
 * alternative (losing the key on every refresh) was strictly worse for a
 * local-first app whose keys never leave the device except to the provider
 * the user named.
 */

const keyItem = (provider: ProviderId) => `key.${provider}`
const kindItem = (provider: ProviderId) => `kind.${provider}`

function localStorageOk(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage
  } catch {
    return false
  }
}

function sessionStorageOk(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.sessionStorage
  } catch {
    return false
  }
}

/** Copy a legacy sessionStorage credential into localStorage, then purge it. */
function promoteLegacySessionKey(provider: ProviderId): string | null {
  if (!sessionStorageOk()) return null
  const legacyValue = window.sessionStorage.getItem(keyItem(provider))
  if (!legacyValue) return null
  const legacyKind = window.sessionStorage.getItem(kindItem(provider))
  if (localStorageOk()) {
    try {
      window.localStorage.setItem(keyItem(provider), legacyValue)
      window.localStorage.setItem(kindItem(provider), legacyKind ?? 'api_key')
    } catch {
      // Storage full or blocked: still return the promoted value for this session.
    }
  }
  window.sessionStorage.removeItem(keyItem(provider))
  window.sessionStorage.removeItem(kindItem(provider))
  return legacyValue
}

export async function saveCredential(
  provider: ProviderId,
  cred: StoredCredential,
): Promise<void> {
  if (!localStorageOk()) return
  window.localStorage.setItem(keyItem(provider), cred.value)
  window.localStorage.setItem(kindItem(provider), cred.kind)
  // Purge any legacy sessionStorage copy so the key lives in exactly one place.
  if (sessionStorageOk()) {
    window.sessionStorage.removeItem(keyItem(provider))
    window.sessionStorage.removeItem(kindItem(provider))
  }
}

export async function loadCredential(provider: ProviderId): Promise<StoredCredential | null> {
  let value: string | null = null
  if (localStorageOk()) {
    value = window.localStorage.getItem(keyItem(provider))
  }
  if (!value) {
    // WEB-006 migration path: users who saved a key before this fix still have
    // it in sessionStorage for this one session — promote it instead of
    // telling them their (still valid) key is gone.
    value = promoteLegacySessionKey(provider)
  }
  if (!value) return null
  let kind: CredentialKind | null = null
  if (localStorageOk()) {
    kind = window.localStorage.getItem(kindItem(provider)) as CredentialKind | null
  }
  return { kind: kind ?? 'api_key', value }
}

export async function clearCredential(provider: ProviderId): Promise<void> {
  if (localStorageOk()) {
    window.localStorage.removeItem(keyItem(provider))
    window.localStorage.removeItem(kindItem(provider))
  }
  if (sessionStorageOk()) {
    window.sessionStorage.removeItem(keyItem(provider))
    window.sessionStorage.removeItem(kindItem(provider))
  }
}

export function maskCredential(value: string): string {
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 7)}…${value.slice(-4)}`
}

export function looksPlausible(_provider: ProviderId, _kind: CredentialKind, value: string): boolean {
  return value.trim().length >= 20
}
