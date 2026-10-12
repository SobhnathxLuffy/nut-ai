import Storage from 'expo-sqlite/kv-store'

/**
 * The in-app appearance preference (light-mode request, 2026-10-12).
 *
 * Both palettes already existed and were contrast-gated (ADR-021), but the
 * app only ever FOLLOWED the OS (`useColorScheme`) — a user on a dark-mode
 * phone had no way to force light. This module adds the missing preference
 * layer: `system` (the old behaviour, the default) / `light` / `dark`.
 *
 * It lives in its own module for the same reason done-key.ts does: the
 * ThemeProvider (resolve), the appearance sub-page (write) and any future
 * caller need it without importing each other's worlds. Same kv-store as
 * the other local-state keys — one storage mechanism by convention.
 */

export const THEME_PREFERENCE_KEY = 'theme.preference.v1'

export type ThemePreference = 'system' | 'light' | 'dark'

/** The exact strings the appearance screen offers, for the a11y labels. */
export const THEME_PREFERENCE_LABELS: Record<ThemePreference, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
}

/**
 * Corrupt storage is not a preference — it falls back to `system`, which is
 * byte-identical to the pre-preference behaviour (fail-open to the old
 * contract, never to a broken theme).
 */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

/**
 * The effective color scheme: an explicit light/dark preference WINS over
 * the OS; `system` follows the OS (null scheme — the web default before any
 * media-query result — resolves to light, matching useColorScheme's own
 * contract where non-'dark' renders light).
 */
export function resolveColorScheme(
  preference: ThemePreference,
  osScheme: 'light' | 'dark' | null,
): 'light' | 'dark' {
  if (preference === 'system') return osScheme === 'dark' ? 'dark' : 'light'
  return preference
}

export async function readThemePreference(): Promise<ThemePreference> {
  return parseThemePreference(await Storage.getItem(THEME_PREFERENCE_KEY))
}

export async function writeThemePreference(preference: ThemePreference): Promise<void> {
  await Storage.setItem(THEME_PREFERENCE_KEY, preference)
}
