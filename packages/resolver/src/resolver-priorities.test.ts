import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'
import {
  DISH_KB_FTS_SCHEMA,
  DISH_KB_SCHEMA,
  NUTRITION_FTS_SCHEMA,
  NUTRITION_SCHEMA,
} from '@nutai/db-adapter'
import { loadFood, resolveByText } from './index.js'

/**
 * Task 2-c — resolver priority + identity locks.
 *
 * Two coupled guarantees, both fixture-backed so they run everywhere (the
 * bundled-corpus golden tests skip when the artifact is absent):
 *
 * 1. LITERAL-FIRST ladder + DishKB(75) above USDA(70): the literal Indian dish
 *    name resolves to its dish identity (Dish KB, or IFCT when the KB lacks
 *    it) — never to the generic English alias expansion ('dosa' -> 'crepe',
 *    'biryani' -> 'mixed rice') that USDA's FTS matches so eagerly. Aliases
 *    BROADEN the ladder; they do not replace the identity.
 *
 * 2. portionHints seam: DishKB resolveById carries the curated portion model,
 *    and rows WITHOUT grams of their own get an inspectable population prior
 *    from @nutai/portion-priors via the display name.
 */

const INGREDIENTS: Array<[string, string, string, number]> = [
  // source, source_id, name, kcal/100g
  ['fdc_sr_legacy', 'ing-rice', 'Rice, white, long-grain, raw', 360],
  ['fdc_sr_legacy', 'ing-atta', 'Wheat flour, whole-grain, atta', 340],
  ['fdc_sr_legacy', 'ing-chana', 'Chickpeas, cooked', 164],
]

/** USDA trap rows: the generic matches the alias expansions used to win with. */
const USDA_TRAPS: Array<{ sourceId: string; name: string; serving: number | null; kcal: number }> = [
  { sourceId: 'trap-crepe', name: 'Crepes, plain, from flour', serving: null, kcal: 200 },
  { sourceId: 'trap-chapati', name: 'Bread, chapati or roti, commercially prepared, plain', serving: 52, kcal: 300 },
  { sourceId: 'trap-pudding', name: 'Pudding, rice, mix, dry', serving: null, kcal: 360 },
  { sourceId: 'trap-hummus', name: 'Hummus, commercial', serving: 30, kcal: 166 },
  // A gram-less Indian row: the population-prior fallback path in loadFood.
  { sourceId: 'trap-dal', name: 'Pigeon pea (red gram), dal, cooked', serving: null, kcal: 120 },
  { sourceId: 'trap-riceflour', name: 'Rice flour, brown', serving: null, kcal: 360 },
]

interface DishFixture {
  id: string
  searchRowid: number
  canonicalName: string
  aliases: string
  searchTerms: string
  portionGrams: number
  strategies?: string[] | undefined
  slotFoodId: string
  recordStatus?: string | undefined
}

function dishRow(over: DishFixture): Array<string | number | null> {
  return [
    over.id,
    over.searchRowid,
    over.canonicalName,
    'breakfast_snack',
    'batter_or_breakfast',
    null,
    '[]',
    JSON.stringify({ verifiedNumericYield: 0.9, status: 'verified' }),
    JSON.stringify({
      templateStatus: 'CURATED',
      numericRatiosVerified: true,
      ingredientSlots: [
        {
          label: 'primary',
          role: 'dominant',
          required: true,
          amountPrior: { kind: 'CURATED_PRIOR', range: [0.6, 0.7], verified: true },
          nutritionMapping: {
            preferredSources: ['USDA_FDC'],
            canonicalFoodId: over.slotFoodId,
            mappingStatus: 'MANUAL_OVERRIDE',
          },
        },
      ],
    }),
    JSON.stringify({
      strategies: over.strategies ?? ['count', 'diameter', 'cooked_weight_g'],
      standardPortionGrams: over.portionGrams,
      standardPortionStatus: 'verified',
      assumptionClass: 'CURATED_PRIOR',
    }),
    '{}',
    '{}',
    over.recordStatus ?? 'CURATED',
  ]
}

describe('literal-first identity and DishKB priority (Task 2-c)', () => {
  let db: DbAdapter

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec(NUTRITION_SCHEMA)
    await db.exec(NUTRITION_FTS_SCHEMA)
    await db.exec(DISH_KB_SCHEMA)
    await db.exec(DISH_KB_FTS_SCHEMA)

    let nextId = 1
    for (const [source, sourceId, name] of INGREDIENTS) {
      await db.run(
        `INSERT INTO foods (id, source, source_id, name, energy_kcal, license, basis_confidence, completeness_score)
         VALUES (?,?,?,?,?,'test','high',1)`,
        [nextId++, source, sourceId, name, 200],
      )
      await db.run('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (?,?,?,?)', [
        nextId - 1, name, '', '',
      ])
    }
    for (const trap of USDA_TRAPS) {
      await db.run(
        `INSERT INTO foods (id, source, source_id, name, serving_size_g, energy_kcal, license, basis_confidence, completeness_score)
         VALUES (?,?,?,?,?,?, 'test','high',1)`,
        [nextId++, 'fdc_sr_legacy', trap.sourceId, trap.name, trap.serving, trap.kcal],
      )
      await db.run('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (?,?,?,?)', [
        nextId - 1, trap.name, '', '',
      ])
    }

    const dishes: DishFixture[] = [
      {
        id: 'dish:in:plain-dosa', searchRowid: 1, canonicalName: 'Plain Dosa',
        aliases: 'dosa sada dosa', searchTerms: 'plain dosa dosa', portionGrams: 80,
        slotFoodId: 'usda:ing-rice',
      },
      {
        id: 'dish:in:roti', searchRowid: 2, canonicalName: 'Roti',
        aliases: 'chapati phulka fulka', searchTerms: 'roti chapati phulka', portionGrams: 40,
        slotFoodId: 'usda:ing-atta', strategies: ['count', 'piece_weight_g', 'diameter_thickness'],
      },
      {
        id: 'dish:in:chicken-biryani', searchRowid: 3, canonicalName: 'Chicken Biryani',
        aliases: 'biryani biriyani', searchTerms: 'chicken biryani biryani', portionGrams: 300,
        slotFoodId: 'usda:ing-chana', strategies: ['measured_g', 'plate_volume', 'katori_volume'],
      },
      {
        // DRAFT on purpose: even an energyless draft identity must outrank the
        // generic USDA rows at decision time (tier 75 vs 70).
        id: 'dish:in:idli', searchRowid: 4, canonicalName: 'Idli',
        aliases: 'idly', searchTerms: 'idli idly', portionGrams: 50,
        slotFoodId: 'usda:ing-rice', recordStatus: 'DRAFT_CURATED',
      },
    ]
    for (const d of dishes) {
      await db.run(
        `INSERT INTO dish_definitions
         (id,search_rowid,canonical_name,category,family,parent_dish_id,cooking_methods_json,yield_model_json,recipe_template_json,portion_model_json,uncertainty_model_json,resolver_config_json,record_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        dishRow(d),
      )
      await db.run(
        'INSERT INTO dish_fts(rowid,canonical_name,aliases,search_terms) VALUES (?,?,?,?)',
        [d.searchRowid, d.canonicalName, d.aliases, d.searchTerms],
      )
    }
  })

  afterEach(async () => { await db.close() })

  async function topOf(query: string): Promise<{ name: string; foodId: string; ladderStep: number }> {
    const result = await resolveByText(db, {
      canonicalFoodKey: query,
      observedBrand: null,
      prepFacet: null,
      modelCategory: null,
      estimatedGrams: 100,
    })
    expect(result.zeroHit).toBe(false)
    const top =
      result.outcome.kind === 'auto_accept'
        ? result.outcome.match
        : result.outcome.kind === 'disambiguate'
          ? result.outcome.candidates[0]
          : undefined
    if (!top) throw new Error(`no candidate for "${query}"`)
    return { name: top.name, foodId: top.foodId, ladderStep: result.ladderStep }
  }

  it("literal 'dosa' resolves to the dish identity, not USDA 'crepes'", async () => {
    const top = await topOf('dosa')
    expect(top.name).toMatch(/dosa/i)
    expect(top.name).not.toMatch(/crepe/i)
    expect(top.foodId).toBe('dish:in:plain-dosa')
  })

  it("literal 'biryani' resolves to the dish identity, not generic rice-pudding junk", async () => {
    const top = await topOf('biryani')
    expect(top.name).toMatch(/biryani/i)
    expect(top.name).not.toMatch(/pudding|rice mix/i)
    expect(top.foodId).toBe('dish:in:chicken-biryani')
  })

  it("literal 'chapati' resolves to the curated Roti dish on rung 0, not USDA bread", async () => {
    const top = await topOf('chapati')
    expect(top.name).toMatch(/roti/i)
    expect(top.name).not.toMatch(/bread|commercial/i)
    expect(top.foodId).toBe('dish:in:roti')
    expect(top.ladderStep).toBe(0)
  })

  it("an alias-only spelling ('idly') still reaches the dish identity one rung later", async () => {
    // The literal rung finds nothing; the normalized rung (idly -> idli) hits
    // the dish KB. The alias broadened the search — it did not replace it.
    const top = await topOf('idly')
    expect(top.name).toMatch(/idli/i)
    expect(top.foodId).toBe('dish:in:idli')
  })

  it('generic USDA queries keep resolving when no dish identity exists', async () => {
    const top = await topOf('hummus')
    expect(top.name).toMatch(/hummus/i)
    expect(top.foodId).toBe('usda:trap-hummus')
  })

  it('DishKB resolveById carries the curated portion model as portionHints', async () => {
    const food = await loadFood(db, 'dish:in:plain-dosa')
    expect(food).not.toBeNull()
    expect(food?.energyKcal).not.toBeNull()
    expect(food?.portionHints).toHaveLength(1)
    expect(food?.portionHints?.[0]).toMatchObject({
      unit: 'piece',
      typical: 80,
      min: 60,
      max: 100,
    })
    expect(food?.portionHints?.[0]?.source).toContain('Dish KB')
  })

  it('gram-less corpus rows get a population prior from the display name', async () => {
    const dal = await loadFood(db, 'usda:trap-dal')
    expect(dal?.servingSizeG).toBeNull()
    expect(dal?.portionHints).toHaveLength(1)
    expect(dal?.portionHints?.[0]).toMatchObject({ unit: 'katori', typical: 150, min: 120, max: 180 })
    expect(dal?.portionHints?.[0]?.source).toContain('IFCT')
  })

  it('rows that already carry grams — or match nothing — stay untouched', async () => {
    // Has servingSizeG: no second opinion bolted on.
    const bread = await loadFood(db, 'usda:trap-chapati')
    expect(bread?.servingSizeG).toBe(52)
    expect(bread?.portionHints).toBeUndefined()

    // Gram-less but not a household-portion food: honestly no hint.
    const flour = await loadFood(db, 'usda:trap-riceflour')
    expect(flour?.servingSizeG).toBeNull()
    expect(flour?.portionHints).toBeUndefined()
  })
})
