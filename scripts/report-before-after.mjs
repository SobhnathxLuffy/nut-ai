#!/usr/bin/env node
/**
 * Before/after report for the three bug-pattern fixes.
 *  - Filling restorations: old template (from git HEAD mapped.json) vs new db.
 *  - Fat double-count: old-UI composer total (recipe + silent 14 g mustard)
 *    vs the recipe's true engine total.
 *  - N001 chicken correction: same template computed with 383.6 vs 191.52 kcal.
 */
import Database from 'better-sqlite3'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const nutrition = new Database(join(REPO, 'apps/mobile/assets/nutrition.db'), { readonly: true })
const ifct = new Database(join(REPO, 'apps/mobile/assets/ifct.db', ), { readonly: true })

const FOOD_FIELDS = 'energy_kcal, protein_g, fat_g, carb_g'
function loadFood(foodId) {
  if (foodId.startsWith('ifct:')) return ifct.prepare(`SELECT ${FOOD_FIELDS} FROM foods WHERE source = 'ifct' AND source_id = ?`).get(foodId.slice(5))
  return nutrition.prepare(`SELECT ${FOOD_FIELDS} FROM foods WHERE source LIKE 'fdc_%' AND source_id = ?`).get(foodId.slice(5))
}

function totals(slots, yieldM, portion, overrides = {}) {
  const mids = slots.map((s) => (s.amountPrior?.range ? (s.amountPrior.range[0] + s.amountPrior.range[1]) / 2 : null))
  const midSum = mids.reduce((a, b) => a + (b ?? 0), 0)
  const rawBatch = portion / yieldM
  let kcal = 0, p = 0, c = 0, f = 0
  slots.forEach((s, i) => {
    let food = null
    let overrideKcal = null
    const fid = s.nutritionMapping?.canonicalFoodId
    if (fid === 'ifct:N001' && overrides.chickenKcal != null) {
      food = loadFood(fid)
      overrideKcal = overrides.chickenKcal
    } else if (fid) {
      food = loadFood(fid)
    }
    if (!food) return
    const grams = mids[i] != null && midSum > 0 ? (mids[i] / midSum) * rawBatch : 0
    kcal += (overrideKcal ?? food.energy_kcal) * grams / 100
    p += (food.protein_g || 0) * grams / 100
    c += (food.carb_g || 0) * grams / 100
    f += (food.fat_g || 0) * grams / 100
  })
  return { kcal: Math.round(kcal), p: Math.round(p), c: Math.round(c), f: Math.round(f) }
}

const fmt = (t) => `${t.kcal} kcal · ${t.p}P/${t.c}C/${t.f}F`

// ---- 1. Filling restorations ---------------------------------------------
const oldMapped = JSON.parse(execSync('git show HEAD:docs/data/indian-dishes.mapped.json', { cwd: REPO, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }))
const FILLING_DISHES = ['Paneer Paratha', 'Gobi Paratha', 'Mooli Paratha', 'Methi Paratha', 'Sattu Paratha', 'Mysore Masala Dosa', 'Onion Rava Dosa', 'Onion Uttapam']
console.log('=== FILLING RESTORATIONS (per standard serving, engine) ===')
for (const name of FILLING_DISHES) {
  const oldD = oldMapped.find((d) => d.canonicalName === name)
  const newRow = nutrition.prepare('SELECT * FROM dish_definitions WHERE canonical_name = ?').get(name)
  const oldT = totals(oldD.recipeTemplate.ingredientSlots, oldD.cooking.yieldModel.verifiedNumericYield, oldD.portionModel.standardPortionGrams)
  const newT = totals(JSON.parse(newRow.recipe_template_json).ingredientSlots, JSON.parse(newRow.yield_model_json).verifiedNumericYield, JSON.parse(newRow.portion_model_json).standardPortionGrams)
  console.log(`${name}:  BEFORE ${fmt(oldT)}  ->  AFTER ${fmt(newT)}  (portion ${newRow.portion_model_json ? JSON.parse(newRow.portion_model_json).standardPortionGrams : '?'}g)`)
}

// ---- 2. Fat double-counting (old-UI silent 14 g) --------------------------
console.log('\n=== FAT DOUBLE-COUNT (composer total, old UI vs fixed UI = engine) ===')
const FAT_ROWS = execSync(`node scripts/verify-composer-equivalence.mjs --old-ui 2>&1 | rg MISMATCH`, { cwd: REPO, encoding: 'utf8' }).trim().split('\n')
for (const line of FAT_ROWS) {
  const m = line.match(/^MISMATCH: (.+?): composer ([\d.]+)kcal\/([\d.]+)P\/([\d.]+)C\/([\d.]+)F vs engine ([\d.]+)kcal\/([\d.]+)P\/([\d.]+)C\/([\d.]+)F/)
  if (m) console.log(`${m[1]}:  OLD UI ${Math.round(+m[2])} kcal · ${Math.round(+m[3])}P/${Math.round(+m[4])}C/${Math.round(+m[5])}F  ->  FIXED ${Math.round(+m[6])} kcal · ${Math.round(+m[7])}P/${Math.round(+m[8])}C/${Math.round(+m[9])}F  (−${Math.round(+m[2] - +m[6])} kcal)`)
}

// ---- 3. N001 chicken correction -------------------------------------------
console.log('\n=== CHICKEN (IFCT N001) 383.6 -> 191.52 kcal/100g (per standard serving) ===')
const CHICKEN_DISHES = ['Chicken Biryani', 'Hyderabadi Chicken Biryani', 'Kolkata Chicken Biryani', 'Chicken Momos', 'Chicken Roll', 'Egg Chicken Roll', 'Kathi Roll']
for (const name of CHICKEN_DISHES) {
  const row = nutrition.prepare('SELECT * FROM dish_definitions WHERE canonical_name = ?').get(name)
  if (!row) continue
  const slots = JSON.parse(row.recipe_template_json).ingredientSlots
  const y = JSON.parse(row.yield_model_json).verifiedNumericYield
  const p = JSON.parse(row.portion_model_json).standardPortionGrams
  const before = totals(slots, y, p, { chickenKcal: 383.6 })
  const after = totals(slots, y, p, { chickenKcal: 191.52 })
  console.log(`${name}:  BEFORE ${fmt(before)}  ->  AFTER ${fmt(after)}  (${p}g)`)
}
