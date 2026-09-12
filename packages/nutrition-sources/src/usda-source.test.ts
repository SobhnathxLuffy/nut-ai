import { beforeEach, describe, expect, it } from 'vitest'
import { NUTRITION_FTS_SCHEMA, NUTRITION_SCHEMA, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { USDASource } from './usda-source.js'

describe('USDASource', () => {
  let db: DbAdapter
  let source: USDASource

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec(NUTRITION_SCHEMA)
    await db.exec(NUTRITION_FTS_SCHEMA)
    source = new USDASource(db)

    const foods: Array<[number, string, string, string, string | null, number, string | null, number]> = [
      [1, 'fdc_sr_legacy', '171077', 'Chicken, broilers or fryers, breast, meat only, cooked, grilled', 'grilled', 165, null, 10],
      [2, 'fdc_sr_legacy', '171078', 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', 'roasted', 172, null, 20],
      [3, 'fdc_sr_legacy', '168878', 'Rice, white, long-grain, regular, cooked', 'boiled', 130, null, 5],
      [4, 'fdc_branded', '2456789', 'Granola Bar, Chewy', null, 400, '0012345678905', 100],
    ]
    for (const [id, src, sourceId, name, prep, kcal, barcode, rank] of foods) {
      await db.run(
        `INSERT INTO foods (id, source, source_id, name, prep_facet, energy_kcal, barcode, popularity_rank,
                            license, basis_confidence, completeness_score)
         VALUES (?,?,?,?,?,?,?,?,'CC0','high',0.9)`,
        [id, src, sourceId, name, prep, kcal, barcode, rank],
      )
      await db.run('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (?,?,?,?)', [
        id, name, '', '',
      ])
    }
  })

  it('provides accurate license and provenance info', () => {
    const info = source.getLicenseInfo()
    expect(info.attribution).toContain('U.S. Department of Agriculture')
    expect(info.redistributionPermitted).toBe(true)
  })

  it('searches against FTS', async () => {
    const results = await source.search('"chicken"')
    expect(results.length).toBe(2)
    expect(results.map(r => r.foodId).sort()).toEqual(['usda:171077', 'usda:171078'])
    expect(results[0]?.energyKcal).toBeDefined()
  })

  it('resolves by ID', async () => {
    const food = await source.resolveById('usda:171077')
    expect(food).not.toBeNull()
    expect(food?.foodId).toBe('usda:171077')
    expect(food?.sourceId).toBe('171077')
    expect(food?.name).toContain('Chicken, broilers')
    expect(food?.energyKcal).toBe(165)
  })

  it('resolves by barcode', async () => {
    const food = await source.resolveByBarcode('0012345678905')
    expect(food).not.toBeNull()
    expect(food?.foodId).toBe('usda:2456789')
    expect(food?.name).toBe('Granola Bar, Chewy')
  })
})
