#!/usr/bin/env node
/**
 * AUDIT 1 — Composer-vs-engine reconciliation (Bug Pattern 1 catcher).
 *
 * THE BUG THIS CATCHES: the dish composer's Cooking Fat / Oil selector used to
 * open at a hardcoded "Mustard Oil, 14 g" default. For any dish whose recipe
 * template ALREADY carries its own fat ingredient (frying oil, tadka fat,
 * cooking oil, butter), the composer therefore added a second, silent 14 g of
 * fat on top of the recipe's own — ~100-130 kcal per serving of pure
 * double-counting. The previous version of this script missed the bug because
 * it hard-coded the same fold set as the app and never simulated the
 * selector's default grams at all.
 *
 * WHAT IT DOES NOW — a FAITHFUL simulation of the composer's initial UI state
 * for every curated dish:
 *   1. Derive per-serving grams exactly like dish-ingredients.ts
 *      (mid(range)/SUM(mids) x portion/yield; household grams win).
 *   2. Fold the first fat_variable slot whose mapped food is selector-
 *      representable (ghee, mustard, sunflower, groundnut, butter) into the
 *      selector — same as the app.
 *   3. If no slot folds, the selector opens at "No Added Oil" (0 g) — the
 *      reflective default. (The old UI opened at mustard-14g here.)
 *   4. Sum rows + selector contribution, and compare kcal AND P/C/F against
 *      the deterministic engine (computeDishNutrition) within 0.5.
 *
 * `--old-ui` runs the pre-fix initialization (mustard-14g default whenever no
 * slot folds) to demonstrate the check catches the historical bug; the default
 * (post-fix) mode must pass for all 362 dishes.
 */
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const OLD_UI = process.argv.includes('--old-ui')

const nutrition = new Database(join(REPO, 'apps/mobile/assets/nutrition.db'), { readonly: true })
const ifct = new Database(join(REPO, 'apps/mobile/assets/ifct.db'), { readonly: true })

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

// Mirror of apps/mobile/src/data/dish-ingredients.ts FAT_OPTION_BY_FOOD —
// the optionIds the Cooking Fat / Oil selector can represent (post-fix).
const FAT_OPTION_BY_FOOD = {
  'ifct:T013': 'ghee-14g',
  'ifct:T006': 'mustard-oil-14g',
  'ifct:T012': 'sunflower-oil-14g',
  'ifct:T005': 'groundnut-oil-14g',
  'usda:173430': 'butter-14g',
  'usda:173410': 'butter-14g',
}
// The PRE-FIX fold set (what the app could fold before this round).
const OLD_FAT_OPTION_BY_FOOD = {
  'ifct:T013': 'ghee-14g',
  'ifct:T006': 'mustard-oil-14g',
  'ifct:T012': 'sunflower-oil-14g',
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
    engine = await computeDishNutrition({ dish, nutritionDb, ifctDb, servings: 1 })
  } catch (err) {
    mismatches.push(`${row.canonical_name} (${row.id}): engine failed: ${err.message}`)
    continue
  }

  // ---- Faithful composer simulation -------------------------------------
  const slots = dish.recipeTemplate.ingredientSlots ?? []
  const yieldM = dish.cooking.yieldModel?.verifiedNumericYield
  const portion = dish.portionModel?.standardPortionGrams
  const mids = slots.map((s) => (s.amountPrior?.range ? (s.amountPrior.range[0] + s.amountPrior.range[1]) / 2 : null))
  const midSum = mids.reduce((a, b) => a + (b ?? 0), 0)
  const rawBatch = portion / yieldM

  let kcal = 0, protein = 0, carb = 0, fat = 0
  let hasNull = false
  let folded = false // did any fat slot fold into the selector?
  let hasUnfoldedFatSlot = false
  slots.forEach((s, i) => {
    const foodId = s.nutritionMapping?.canonicalFoodId
    const food = foodId ? loadFood(foodId) : null
    if (!food || food.energy_kcal == null) { hasNull = true; return }
    const grams = mids[i] != null && midSum > 0 ? (mids[i] / midSum) * rawBatch : 0
    const isFatSlot = s.role === 'fat_variable'
    const foldMap = OLD_UI ? OLD_FAT_OPTION_BY_FOOD : FAT_OPTION_BY_FOOD
    const foldThis = isFatSlot && !folded && foldMap[foodId] != null
    if (foldThis) {
      // The slot is removed from the rows and becomes the selector's
      // preselected option with THESE grams — the contribution still flows
      // into the dish through the selector, exactly once.
      folded = true
    } else {
      if (isFatSlot) hasUnfoldedFatSlot = true
    }
    kcal += food.energy_kcal * grams / 100
    protein += (food.protein_g || 0) * grams / 100
    carb += (food.carb_g || 0) * grams / 100
    fat += (food.fat_g || 0) * grams / 100
  })

  // Selector initialization, exactly as the UI does it.
  if (OLD_UI && !folded) {
    // The historical bug: a hardcoded mustard-oil 14 g default even when the
    // recipe already carries its own fat.
    kcal += 900 * 14 / 100
    fat += 100 * 14 / 100
  }
  // Post-fix UI: no fold -> "No Added Oil" -> adds nothing. The folded slot
  // already contributed its grams through the fold branch above.

  if (hasNull) continue // composer blocks logging on unknowns; engine skips too
  const scale = portion / (rawBatch * yieldM) // == 1 for verified yields; kept for parity
  const cKcal = kcal * scale, cP = protein * scale, cC = carb * scale, cF = fat * scale

  const e = {
    kcal: engine.energyKcal,
    protein: engine.proteinG,
    carb: engine.carbG,
    fat: engine.fatG,
  }
  const cmp = (a, b, tol) => b == null ? false : Math.abs(a - b) <= tol
  if (!cmp(cKcal, e.kcal, 0.5) || !cmp(cP, e.protein, 0.5) || !cmp(cC, e.carb, 0.5) || !cmp(cF, e.fat, 0.5)) {
    mismatches.push(`${dish.canonicalName}: composer ${cKcal.toFixed(1)}kcal/${cP.toFixed(1)}P/${cC.toFixed(1)}C/${cF.toFixed(1)}F vs engine ${e.kcal?.toFixed(1)}kcal/${e.protein?.toFixed(1)}P/${e.carb?.toFixed(1)}C/${e.fat?.toFixed(1)}F`)
  }
  if (!OLD_UI && hasUnfoldedFatSlot && !folded) {
    // informational — recipe fat kept as a row (e.g. coconut-milk "added_fat")
  }
  checked++
}

console.log(`Reconciliation: ${checked} curated dishes, engine vs faithful composer simulation${OLD_UI ? ' (--old-ui)' : ''}.`)
if (mismatches.length === 0) {
  console.log('ALL MATCH within 0.5 kcal / 0.5 g on kcal, P, C and F.')
} else {
  for (const m of mismatches.slice(0, 40)) console.log('MISMATCH:', m)
  console.log(`Total mismatches: ${mismatches.length}`)
  process.exit(1)
}
