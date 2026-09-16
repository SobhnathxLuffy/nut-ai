import type { DbAdapter } from '@nutai/db-adapter'
import type { WeightUnit } from '@nutai/analytics'

const SETTING_KEY = 'weight.displayUnit'

/**
 * Resolve the dedicated preference first, then preserve the onboarding unit
 * system for existing users. New India-first installs default to kilograms.
 */
export async function readWeightUnit(db: DbAdapter): Promise<WeightUnit> {
  const explicit = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [SETTING_KEY])
  if (explicit?.value === 'kg' || explicit?.value === 'lb') return explicit.value
  const profile = await db.get<{ units: string | null }>('SELECT units FROM user_profile WHERE id = 1')
  return profile?.units === 'imperial' ? 'lb' : 'kg'
}

export async function writeWeightUnit(db: DbAdapter, unit: WeightUnit): Promise<void> {
  if (unit !== 'kg' && unit !== 'lb') throw new Error('Unsupported weight unit')
  await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [SETTING_KEY, unit])
}
