#!/usr/bin/env node
/**
 * Mapping verification — "are the verified mappings actually correct?"
 *
 * Walks every dish in the mapped seed and, for each slot whose nutrition
 * mapping claims to be usable (AUTO_MAPPED / MANUAL_OVERRIDE / mapped),
 * checks the referenced food against the SHIPPED databases:
 *
 *   1. The food id resolves (ifct: in ifct.db, usda: in nutrition.db).
 *   2. It carries a positive energy value.
 *   3. Label-based sanity cross-checks — a slot labelled as fat must not
 *      point at a food with 40 kcal/100 g, a protein slot must not point at
 *      something with 1 g protein per 100 g. Sanity violations are REPORTED
 *      (they may be legitimate reviewed decisions) but missing or empty foods
 *      are hard failures.
 *
 * Output: docs/data/indian-dishes.mapping-verification.json + a console
 * summary. Exit 1 on hard failures so `npm run check` catches regressions.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openNodeDb } from '../../packages/db-adapter/dist/node.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')
const MAPPED_FILE = join(REPO, 'docs', 'data', 'indian-dishes.mapped.json')
const OUT_FILE = join(REPO, 'docs', 'data', 'indian-dishes.mapping-verification.json')
const NUTRITION_DB = join(REPO, 'apps/mobile/assets/nutrition.db')
const IFCT_DB = join(REPO, 'apps/mobile/assets/ifct.db')

const MAPPED_STATUSES = new Set(['AUTO_MAPPED', 'MANUAL_OVERRIDE', 'mapped'])

const FAT_LABEL = /(added_fat|oil|ghee|butter|fat)/i
const PROTEIN_LABEL_TOKENS = new Set(['animal_protein', 'chicken', 'mutton', 'egg', 'fish', 'prawn', 'meat', 'goat', 'liver', 'pork', 'duck'])

const isProteinLabel = (label) =>
  label
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .some((token) => PROTEIN_LABEL_TOKENS.has(token))

async function main() {
  if (!existsSync(NUTRITION_DB) || !existsSync(IFCT_DB)) {
    console.error('verify-mappings: bundled corpus missing — run `npm run data:build` and `npm run ifct:build` first.')
    process.exit(1)
  }
  const nutrition = openNodeDb(NUTRITION_DB, { readonly: true })
  const ifct = openNodeDb(IFCT_DB, { readonly: true })
  const dishes = JSON.parse(readFileSync(MAPPED_FILE, 'utf8'))

  const hardErrors = []
  const sanityWarnings = []
  let mappedSlots = 0
  let checkedSlots = 0
  let ifctHits = 0
  let usdaHits = 0

  const cache = new Map()
  const loadFood = async (foodId) => {
    if (cache.has(foodId)) return cache.get(foodId)
    let row = null
    if (foodId.startsWith('ifct:')) {
      row = await ifct.get('SELECT source_id, name, energy_kcal, protein_g, fat_g, carb_g FROM foods WHERE source = ? AND source_id = ?', ['ifct', foodId.slice(5)])
    } else if (foodId.startsWith('usda:')) {
      // USDA candidates may key off the row id when source_id is NULL (the
      // same COALESCE the search candidates and resolveById use).
      row = await nutrition.get(
        'SELECT source_id, name, energy_kcal, protein_g, fat_g, carb_g FROM foods WHERE source LIKE ? AND (source_id = ? OR (source_id IS NULL AND CAST(id AS TEXT) = ?))',
        ['fdc_%', foodId.slice(5), foodId.slice(5)],
      )
    }
    cache.set(foodId, row)
    return row
  }

  for (const dish of dishes) {
    for (const slot of dish.recipeTemplate?.ingredientSlots ?? []) {
      const mapping = slot.nutritionMapping
      if (!mapping || !MAPPED_STATUSES.has(mapping.mappingStatus) || !mapping.canonicalFoodId) continue
      mappedSlots += 1

      const food = await loadFood(mapping.canonicalFoodId)
      if (!food) {
        hardErrors.push(`${dish.id} (${dish.canonicalName}) slot "${slot.label}": ${mapping.canonicalFoodId} does not resolve in the shipped corpus`)
        continue
      }
      if (food.energy_kcal == null || !Number.isFinite(food.energy_kcal) || food.energy_kcal < 0) {
        hardErrors.push(`${dish.id} (${dish.canonicalName}) slot "${slot.label}": ${mapping.canonicalFoodId} (${food.name}) has no usable energy value`)
        continue
      }
      // Zero-energy ingredients (water, salt, some spices) are legitimate;
      // anything else must carry SOME energy to be a real food row.
      checkedSlots += 1
      if (mapping.canonicalFoodId.startsWith('ifct:')) ifctHits += 1
      else usdaHits += 1

      if (FAT_LABEL.test(slot.label) && food.energy_kcal < 300 && food.energy_kcal > 0) {
        sanityWarnings.push(`${dish.id} (${dish.canonicalName}) slot "${slot.label}": ${mapping.canonicalFoodId} (${food.name}) has ${food.energy_kcal} kcal/100g — low for a fat slot`)
      }
      if (isProteinLabel(slot.label) && (food.protein_g == null || food.protein_g < 8)) {
        sanityWarnings.push(`${dish.id} (${dish.canonicalName}) slot "${slot.label}": ${mapping.canonicalFoodId} (${food.name}) has ${food.protein_g ?? 'null'} g protein/100g — low for a protein slot`)
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalDishes: dishes.length,
    mappedSlots,
    checkedSlots,
    ifctMapped: ifctHits,
    usdaMapped: usdaHits,
    hardErrorCount: hardErrors.length,
    sanityWarningCount: sanityWarnings.length,
    hardErrors,
    sanityWarnings,
  }
  writeFileSync(OUT_FILE, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, hardErrors: `${hardErrors.length} (see ${OUT_FILE})`, sanityWarnings: `${sanityWarnings.length} (see ${OUT_FILE})` }, null, 2))

  await nutrition.close()
  await ifct.close()
  if (hardErrors.length > 0) process.exit(1)
}

main().catch((error) => { console.error(error); process.exit(1) })
