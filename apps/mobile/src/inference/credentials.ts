import * as SecureStore from 'expo-secure-store'
import type { ProviderId } from '@nutai/prompt'

/**
 * API credentials.
 *
 * WHERE KEYS LIVE, and the rules that are not negotiable:
 *
 *   Keychain / Keystore via expo-secure-store, ONE ENTRY PER PROVIDER — never one
 *   combined JSON blob, so a corrupt or revoked key for one provider cannot take
 *   the others with it.
 *
 *   Written ONLY from runtime user input. Never from EXPO_PUBLIC_*, app.config,
 *   .env, or EAS secrets — anything in those ships inside the bundle and is
 *   readable by anyone who downloads the app.
 *
 *   Read at exactly ONE place (the Path A request builder) and sent to exactly
 *   one destination: the provider the user named.
 *
 * The biometric gate is on REVEAL/EDIT in settings only, never on read-for-scan.
 * Putting Face ID in front of every meal photo is how a privacy feature becomes
 * the reason someone stops logging.
 */

import { Platform } from 'react-native'

export type CredentialKind = 'api_key' | 'oauth'

export interface StoredCredential {
  kind: CredentialKind
  value: string
}

const keyFor = (p: ProviderId) => `key.${p}`
const kindFor = (p: ProviderId) => `kind.${p}`

export async function saveCredential(
  provider: ProviderId,
  cred: StoredCredential,
): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(keyFor(provider), cred.value);
    localStorage.setItem(kindFor(provider), cred.kind);
    return;
  }
  await SecureStore.setItemAsync(keyFor(provider), cred.value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
  await SecureStore.setItemAsync(kindFor(provider), cred.kind)
}

export async function loadCredential(provider: ProviderId): Promise<StoredCredential | null> {
  if (Platform.OS === 'web') {
    const value = localStorage.getItem(keyFor(provider));
    if (!value) return null;
    const kind = localStorage.getItem(kindFor(provider)) as CredentialKind | null;
    return { kind: kind ?? 'api_key', value };
  }
  const value = await SecureStore.getItemAsync(keyFor(provider))
  if (!value) return null
  const kind = (await SecureStore.getItemAsync(kindFor(provider))) as CredentialKind | null
  return { kind: kind ?? 'api_key', value }
}

export async function clearCredential(provider: ProviderId): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(keyFor(provider));
    localStorage.removeItem(kindFor(provider));
    return;
  }
  await SecureStore.deleteItemAsync(keyFor(provider))
  await SecureStore.deleteItemAsync(kindFor(provider))
}


/** `sk-ant-…a8f2` — never the whole thing, not even to its owner by default. */
export function maskCredential(value: string): string {
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 7)}…${value.slice(-4)}`
}

/**
 * Is this worth spending a network round trip on?
 *
 * LENGTH ONLY, deliberately. An earlier version required an `sk-ant-` prefix for
 * Anthropic, which meant pasting a valid `claude setup-token` credential into the
 * API-key tab left the Verify button greyed out with no explanation — the user
 * had a working credential and no way to submit it.
 *
 * Prefixes also change without notice, and the provider is the authority on
 * whether a credential is real. Guessing here can only produce false negatives we
 * never learn about; the probe produces a true answer either way.
 */
export function looksPlausible(_provider: ProviderId, _kind: CredentialKind, value: string): boolean {
  return value.trim().length >= 20
}
