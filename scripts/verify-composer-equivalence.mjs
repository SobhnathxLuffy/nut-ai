#!/usr/bin/env node
/**
 * Cross-check: the deterministic engine (computeDishNutrition) vs the dish
 * composer's arithmetic (fraction-derived grams + folded cooking fat + verified
 * yield) must agree for every curated dish within rounding.
 */
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const nutrition = new Database(join(REPO, 'apps/mobile/assets/nutrition.db'), { readonly: true })
const ifct = new Database(join(REPO, 'apps/mobile/assets/ifct.db'), { readonly: true })

// Wrap better-sqlite3 in the async DbAdapter shape computeDishNutrition expects.
function adapt(db) {
  return {
    get: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
    all: async (sql, params = []) => db.prepare(sql).all(...params),
    run: async (sql, params = []) => db.prepare(sql).run(...params),
  }
}
const nutritionDb = adapt(nutrition)
const ifctDb = adapt(ifct)

const { computeDishNutrition } = await import(join(REPO, 'packages/indian-dishes/dist/index.js'))

const FOOD_FIELDS = 'energy_kcal, protein_g, fat_g, carb_g, fiber_g, sugar_g, sodium_mg'
function loadFood(foodId) {
  if (foodId.startsWith('ifct:')) {
    return ifct.prepare(`SELECT ${FOOD_FIELDS} FROM foods WHERE source = 'ifct' AND source_id = ?`).get(foodId.slice(5))
  }
  return nutrition.prepare(`SELECT ${FOOD_FIELDS} FROM foods WHERE source LIKE 'fdc_%' AND source_id = ?`).get(foodId.slice(5))
}

const dishes = nutrition.prepare(`SELECT * FROM dish_definitions WHERE record_status IN ('CURATED','VERIFIED')`).all()
let checked = 0
const mismatches = []
for (const row of dishes) {
  const dish = {
    id: row.id,
    canonicalName: row.canonical_name,
    category: row.category,
    family: row.family,
    cooking: { methods: JSON.parse(row.cooking_methods_json || '[]'), yieldModel: JSON.parse(row.yield_model_json || '{}') },
    recipeTemplate: JSON.parse(row.recipe_template_json || '{}'),
    portionModel: JSON.parse(row.portion_model_json || '{}'),
    provenance: { recordStatus: row.record_status },
  }
  let engine
  try {
    engine = await computeDishNutrition({ dish, nutritionDb: nutritionDb, ifctDb: ifctDb, servings: 1 })
  } catch (err) {
    mismatches.push(`${row.id}: engine failed: ${err.message}`)
    continue
  }

  // Composer arithmetic (mirror of dish-composer.tsx with dish-ingredients.ts).
  const slots = dish.recipeTemplate.ingredientSlots ?? []
  const yieldM = dish.cooking.yieldModel?.verifiedNumericYield
  const portion = dish.portionModel?.standardPortionGrams
  const FOLDABLE = new Set(['ifct:T013', 'ifct:T006', 'ifct:T012'])
  const mids = slots.map((s) => (s.amountPrior?.range ? (s.amountPrior.range[0] + s.amountPrior.range[1]) / 2 : null))
  const midSum = mids.reduce((a, b) => a + (b ?? 0), 0)
  const rawBatch = portion / yieldM

  let rawKcal = 0
  let hasNull = false
  let fatKcal = 0
  slots.forEach((s, i) => {
    const food = s.nutritionMapping?.canonicalFoodId ? loadFood(s.nutritionMapping.canonicalFoodId) : null
    if (!food || food.energy_kcal == null) { hasNull = true; return }
    const foldOut = s.role === 'fat_variable' && FOLDABLE.has(s.nutritionMapping.canonicalFoodId) && fatKcal === 0
    const grams = mids[i] != null && midSum > 0 ? (mids[i] / midSum) * rawBatch : 0
    if (foldOut) fatKcal = food.energy_kcal * grams / 100
    else rawKcal += food.energy_kcal * grams / 100
  })
  const composerKcal = hasNull ? null : (rawKcal + fatKcal) * (portion / (rawBatch * yieldM))

  if (composerKcal != null && Math.abs(composerKcal - engine.energyKcal) > 0.5) {
    mismatches.push(`${row.id}: engine ${engine.energyKcal.toFixed(1)} vs composer ${composerKcal.toFixed(1)} kcal`)
  }
  checked += 1
}
console.log(`Cross-checked ${checked} curated dishes: engine vs composer arithmetic.`)
if (mismatches.length === 0) console.log('ALL MATCH within 0.5 kcal.')
else {
  for (const m of mismatches.slice(0, 20)) console.log('MISMATCH:', m)
  console.log(`Total mismatches: ${mismatches.length}`)
  process.exit(1)
}
