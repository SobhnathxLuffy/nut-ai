import { beforeEach, describe, expect, it } from 'vitest'
import { NUTRITION_FTS_SCHEMA, NUTRITION_SCHEMA, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { IFCTSource } from './ifct-source.js'

describe('IFCTSource', () => {
  let db: DbAdapter
  let source: IFCTSource

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec(NUTRITION_SCHEMA)
    await db.exec(NUTRITION_FTS_SCHEMA)
    source = new IFCTSource(db)

    const foods: Array<[number, string, string, string, string | null, number, string | null, number]> = [
      [1, 'ifct', 'A015', 'Rice, raw', 'raw', 345, null, 10],
      [2, 'ifct', 'A020', 'Wheat flour, whole', 'raw', 341, null, 20],
      [3, 'fdc_sr_legacy', '168878', 'Rice, white, long-grain, regular, cooked', 'boiled', 130, null, 5],
    ]
    for (const [id, src, sourceId, name, prep, kcal, barcode, rank] of foods) {
      await db.run(
        `INSERT INTO foods (id, source, source_id, name, prep_facet, energy_kcal, barcode, popularity_rank,
                            license, basis_confidence, completeness_score)
         VALUES (?,?,?,?,?,?,?,?,'Permission','high',1.0)`,
        [id, src, sourceId, name, prep, kcal, barcode, rank],
      )
      await db.run('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (?,?,?,?)', [
        id, name, '', '',
      ])
    }
  })

  it('provides accurate IFCT license info', () => {
    const info = source.getLicenseInfo()
    expect(info.attribution).toContain('ICMR-NIN')
    expect(info.redistributionPermitted).toBe(true)
  })

  it('searches against FTS but only returns IFCT foods', async () => {
    const results = await source.search('"rice"')
    expect(results.length).toBe(1)
    expect(results[0]?.foodId).toBe('ifct:A015')
    expect(results[0]?.energyKcal).toBeDefined()
  })

  it('resolves by ID for IFCT foods only', async () => {
    const foodIfct = await source.resolveById('ifct:A015')
    expect(foodIfct).not.toBeNull()
    expect(foodIfct?.foodId).toBe('ifct:A015')
    expect(foodIfct?.sourceId).toBe('A015')
    expect(foodIfct?.name).toContain('Rice')
    expect(foodIfct?.energyKcal).toBe(345)

    const foodUsda = await source.resolveById('usda:168878')
    expect(foodUsda).toBeNull() // because f.source = 'ifct' filter
  })
})
