import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { DISH_KB_FTS_SCHEMA, DISH_KB_SCHEMA, NUTRITION_SCHEMA } from '@nutai/db-adapter'
import { DishKBSource } from './dish-kb-source.js'

describe('DishKBSource', () => {
  let db: DbAdapter
  beforeEach(async () => {
    db = openMemoryDb(); await db.exec(DISH_KB_SCHEMA); await db.exec(DISH_KB_FTS_SCHEMA)
    await db.run(`INSERT INTO dish_definitions
      (id,search_rowid,canonical_name,category,family,parent_dish_id,cooking_methods_json,yield_model_json,recipe_template_json,portion_model_json,uncertainty_model_json,resolver_config_json,record_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      'dish:in:idli', 1, 'Idli', 'breakfast', 'fermented_batter', null, '[]', '{}',
      JSON.stringify({ templateStatus: 'DRAFT_CURATED', ingredientSlots: [] }), '{}', '{}', '{}', 'DRAFT_CURATED',
    ])
    await db.run('INSERT INTO dish_fts(rowid,canonical_name,aliases,search_terms) VALUES (?,?,?,?)', [1, 'Idli', 'idly', 'idli idly'])
  })
  afterEach(async () => { await db.close() })

  it('joins FTS rowids through the explicit numeric key and finds aliases', async () => {
    const results = await new DishKBSource(db).search('"idly"')
    expect(results[0]?.foodId).toBe('dish:in:idli')
    expect(results[0]?.basisConfidence).toBe('low')
  })

  it('does not resolve a draft dish to fake nutrition', async () => {
    await expect(new DishKBSource(db).resolveById('dish:in:idli')).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Task 2-c: the portionHints seam. A CURATED dish resolves to deterministic
// nutrition AND carries its curated portion model as an inspectable,
// range-carrying hint; the search row exposes the same range to the scorer.
// ---------------------------------------------------------------------------

const CURATED_DISH_ROW = [
  'dish:in:plain-dosa', 1, 'Plain Dosa', 'breakfast_snack', 'batter_or_breakfast', null,
  '[]',
  JSON.stringify({ verifiedNumericYield: 0.9, status: 'verified' }),
  JSON.stringify({
    templateStatus: 'CURATED',
    numericRatiosVerified: true,
    ingredientSlots: [
      {
        label: 'rice',
        role: 'dominant',
        required: true,
        amountPrior: { kind: 'CURATED_PRIOR', range: [0.6, 0.7], verified: true },
        nutritionMapping: {
          preferredSources: ['USDA_FDC'],
          canonicalFoodId: 'usda:123',
          mappingStatus: 'MANUAL_OVERRIDE',
        },
      },
    ],
  }),
  JSON.stringify({
    strategies: ['count', 'diameter', 'cooked_weight_g'],
    standardPortionGrams: 80,
    standardPortionStatus: 'verified',
    assumptionClass: 'CURATED_PRIOR',
  }),
  '{}', '{}', 'CURATED',
] as const

describe('DishKBSource portion hints (Task 2-c)', () => {
  let db: DbAdapter
  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec(NUTRITION_SCHEMA)
    await db.exec(DISH_KB_SCHEMA)
    await db.exec(DISH_KB_FTS_SCHEMA)
    await db.run(
      `INSERT INTO foods (id, source, source_id, name, basis, energy_kcal, protein_g, fat_g, carb_g,
                          license, basis_confidence, completeness_score)
       VALUES (1, 'fdc_sr_legacy', '123', 'Rice, white, cooked', 'per_100g', 130, 2.7, 0.3, 28,
               'CC0', 'high', 1)`,
    )
    await db.run(`INSERT INTO dish_definitions
      (id,search_rowid,canonical_name,category,family,parent_dish_id,cooking_methods_json,yield_model_json,recipe_template_json,portion_model_json,uncertainty_model_json,resolver_config_json,record_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...CURATED_DISH_ROW])
    await db.run('INSERT INTO dish_fts(rowid,canonical_name,aliases,search_terms) VALUES (?,?,?,?)', [
      1, 'Plain Dosa', 'dosa sada dosa', 'plain dosa dosa',
    ])
  })
  afterEach(async () => { await db.close() })

  it('resolveById attaches the curated portion model as a range-carrying hint', async () => {
    const resolved = await new DishKBSource(db).resolveById('dish:in:plain-dosa')
    expect(resolved).not.toBeNull()
    expect(resolved?.energyKcal).not.toBeNull()
    expect(resolved?.portionHints).toHaveLength(1)
    expect(resolved?.portionHints?.[0]).toMatchObject({
      unit: 'piece',
      typical: 80,
      min: 60,
      max: 100,
    })
    expect(resolved?.portionHints?.[0]?.source).toContain('Dish KB')
    expect(resolved?.portionHints?.[0]?.source).toContain('Plain Dosa')
  })

  it('search rows expose the curated portion range to the scorer', async () => {
    const results = await new DishKBSource(db).search('"dosa"')
    expect(results).toHaveLength(1)
    expect(results[0]?.typicalGramsMin).toBe(60)
    expect(results[0]?.typicalGramsMax).toBe(100)
    expect(results[0]?.servingSizeG).toBe(80)
  })
})
