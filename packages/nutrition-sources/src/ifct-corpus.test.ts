import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import type { DbAdapter } from '@nutai/db-adapter'
import { openNodeDb } from '@nutai/db-adapter/node'
import { loadFood, resolveByText } from '@nutai/resolver'

describe('bundled IFCT corpus', () => {
  let nutritionDb: DbAdapter
  let ifctDb: DbAdapter

  beforeAll(() => {
    nutritionDb = openNodeDb(fileURLToPath(new URL('../../../apps/mobile/assets/nutrition.db', import.meta.url)), { readonly: true })
    ifctDb = openNodeDb(fileURLToPath(new URL('../../../apps/mobile/assets/ifct.db', import.meta.url)), { readonly: true })
  })

  afterAll(async () => {
    await nutritionDb.close()
    await ifctDb.close()
  })

  it('ships all 528 source rows with the official source hash', async () => {
    expect((await ifctDb.get<{ c: number }>("SELECT COUNT(*) c FROM foods WHERE source = 'ifct'"))?.c).toBe(528)
    expect((await ifctDb.get<{ value: string }>("SELECT value FROM build_manifest WHERE key = 'source_hash_sha256'"))?.value)
      .toBe('e87629581a58faca286f4886504bc75f33d6d3771a50fb4e40e2afee2b2b32dd')
  })

  it('resolves stable IFCT food codes, not generated SQLite row IDs', async () => {
    const ragi = await loadFood(nutritionDb, 'ifct:A010', { ifctDb })
    expect(ragi).toMatchObject({ sourceId: 'A010', source: 'ifct', energyKcal: 320.75 })
  })

  it('routes a common alias to IFCT before USDA', async () => {
    const result = await resolveByText(nutritionDb, {
      canonicalFoodKey: 'toor dal',
      observedBrand: null,
      prepFacet: null,
      modelCategory: null,
      estimatedGrams: 100,
    }, { ifctDb })
    const ids = result.outcome.kind === 'auto_accept'
      ? [result.outcome.match.foodId]
      : result.outcome.kind === 'disambiguate' ? result.outcome.candidates.map((candidate) => candidate.foodId) : []
    expect(ids).toContain('ifct:B021')
  })
})
