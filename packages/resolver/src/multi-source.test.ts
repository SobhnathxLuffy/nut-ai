import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, NUTRITION_FTS_SCHEMA, NUTRITION_SCHEMA, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { loadFood, resolveByText } from './index.js'

async function seedFood(db: DbAdapter, source: string, sourceId: string, kcal: number): Promise<void> {
  await db.exec(NUTRITION_SCHEMA)
  await db.exec(NUTRITION_FTS_SCHEMA)
  await db.run(
    `INSERT INTO foods (id, source, source_id, name, energy_kcal, license, basis_confidence, completeness_score)
     VALUES (1, ?, ?, 'Rice, raw', ?, 'test', 'high', 1)`,
    [source, sourceId, kcal],
  )
  await db.run('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (1, ?, \'\', \'\')', ['Rice, raw'])
}

describe('multi-source resolver', () => {
  let usdaDb: DbAdapter
  let ifctDb: DbAdapter

  beforeEach(async () => {
    usdaDb = openMemoryDb()
    ifctDb = openMemoryDb()
    await seedFood(usdaDb, 'fdc_sr_legacy', '168878', 130)
    await seedFood(ifctDb, 'ifct', 'A015', 345)
  })

  it('keeps identical local row IDs source-qualified and resolves each from its own database', async () => {
    const context = { ifctDb }
    const usda = await loadFood(usdaDb, 'usda:168878', context)
    const ifct = await loadFood(usdaDb, 'ifct:A015', context)
    expect(usda?.energyKcal).toBe(130)
    expect(ifct?.energyKcal).toBe(345)

    const result = await resolveByText(usdaDb, {
      canonicalFoodKey: 'rice raw', observedBrand: null, prepFacet: 'raw', modelCategory: null, estimatedGrams: 100,
    }, context)
    const candidates = result.outcome.kind === 'disambiguate' ? result.outcome.candidates : []
    expect(candidates.map((candidate) => candidate.foodId)).toContain('ifct:A015')
    expect(candidates.map((candidate) => candidate.foodId)).not.toContain('usda:168878')
  })

  it('falls back to USDA only when the higher-priority IFCT corpus misses', async () => {
    await usdaDb.run(
      `INSERT INTO foods (id, source, source_id, name, energy_kcal, license, basis_confidence, completeness_score)
       VALUES (2, 'fdc_foundation', '321358', 'Hummus, commercial', 166, 'test', 'high', 1)`,
    )
    await usdaDb.run("INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (2, 'Hummus, commercial', '', '')")
    const result = await resolveByText(usdaDb, {
      canonicalFoodKey: 'hummus', observedBrand: null, prepFacet: null,
      modelCategory: null, estimatedGrams: 100,
    }, { ifctDb })
    const ids = result.outcome.kind === 'auto_accept'
      ? [result.outcome.match.foodId]
      : result.outcome.kind === 'disambiguate' ? result.outcome.candidates.map((candidate) => candidate.foodId) : []
    expect(ids).toContain('usda:321358')
  })

  it('returns a matching user food before every bundled corpus', async () => {
    const userDb = openMemoryDb()
    await migrate(userDb, 1_760_000_000_000)
    await userDb.run(
      `INSERT INTO user_foods
       (uuid, name, basis, energy_kcal, created_at, updated_at, revision, sync_state)
       VALUES ('018f7fc7-7c00-7000-8000-000000000099', 'Rice, raw', 'per_100g', 999, ?, ?, 1, 'local')`,
      [1_760_000_000_000, 1_760_000_000_000],
    )
    const result = await resolveByText(usdaDb, {
      canonicalFoodKey: 'rice raw', observedBrand: null, prepFacet: null,
      modelCategory: null, estimatedGrams: 100,
    }, { ifctDb, userDb })
    const ids = result.outcome.kind === 'auto_accept'
      ? [result.outcome.match.foodId]
      : result.outcome.kind === 'disambiguate' ? result.outcome.candidates.map((candidate) => candidate.foodId) : []
    expect(ids).toEqual(['userfood:018f7fc7-7c00-7000-8000-000000000099'])
  })
})
