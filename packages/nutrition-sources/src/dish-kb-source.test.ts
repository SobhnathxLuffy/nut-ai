import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import { DISH_KB_FTS_SCHEMA, DISH_KB_SCHEMA } from '@nutai/db-adapter'
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
