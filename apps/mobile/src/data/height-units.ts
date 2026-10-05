import type { DbAdapter } from '@nutai/db-adapter'

export type HeightUnit = 'cm' | 'ftin'

const SETTING_KEY = 'height.displayUnit'
const CM_PER_IN = 2.54

/**
 * Height display units, decoupled from weight (owner mandate 2026-10).
 *
 * Mirrors weight-units.ts: the dedicated preference wins; rows written before
 * the preference existed fall back to the onboarding unit system (an imperial
 * profile picked "ft, in" heights, a metric profile picked cm). Canonical
 * height stays centimetres (user_profile.height_cm) — this key is display-only
 * and changing it must never rewrite the stored value.
 */
export async function readHeightUnit(db: DbAdapter): Promise<HeightUnit> {
  const explicit = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [SETTING_KEY])
  if (explicit?.value === 'cm' || explicit?.value === 'ftin') return explicit.value
  const profile = await db.get<{ units: string | null }>('SELECT units FROM user_profile WHERE id = 1')
  return profile?.units === 'imperial' ? 'ftin' : 'cm'
}

export async function writeHeightUnit(db: DbAdapter, unit: HeightUnit): Promise<void> {
  if (unit !== 'cm' && unit !== 'ftin') throw new Error('Unsupported height unit')
  await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [SETTING_KEY, unit])
}

/** ft + in (display) -> cm (canonical). The onboarding ft/in wheels' math. */
export function ftInToCm(ft: number, inch: number): number {
  return (ft * 12 + inch) * CM_PER_IN
}

/** cm (canonical) -> whole ft + remaining in (display). */
export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = Math.round(cm / CM_PER_IN)
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 }
}

/** Display formatter at the UI edge — canonical cm in, labelled string out. */
export function formatHeightCm(cm: number, unit: HeightUnit): string {
  if (unit === 'ftin') {
    const { ft, inch } = cmToFtIn(cm)
    return `${ft} ft ${inch} in`
  }
  return `${Math.round(cm)} cm`
}
