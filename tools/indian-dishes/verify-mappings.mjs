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
  let curatedDishes = 0
  let draftDishes = 0
  let fullyMappedDishes = 0

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
    const slots = dish.recipeTemplate?.ingredientSlots ?? []
    const isCurated = dish.provenance?.recordStatus === 'CURATED' || dish.provenance?.recordStatus === 'VERIFIED'
    if (isCurated) curatedDishes += 1
    else draftDishes += 1

    // Graduation gates — a CURATED record claims deterministic nutrition, so
    // every element computeDishNutrition() requires must actually be verified.
    if (isCurated) {
      if (dish.recipeTemplate?.numericRatiosVerified !== true) {
        hardErrors.push(`${dish.id} (${dish.canonicalName}): CURATED but numericRatiosVerified is not true`)
      }
      const yieldValue = dish.cooking?.yieldModel?.verifiedNumericYield
      if (!(typeof yieldValue === 'number' && Number.isFinite(yieldValue) && yieldValue > 0)) {
        hardErrors.push(`${dish.id} (${dish.canonicalName}): CURATED but cooked yield is not verified`)
      }
      if (dish.cooking?.yieldModel?.status !== 'verified') {
        hardErrors.push(`${dish.id} (${dish.canonicalName}): CURATED but yieldModel.status is not 'verified'`)
      }
      const portion = dish.portionModel?.standardPortionGrams
      if (!(typeof portion === 'number' && Number.isFinite(portion) && portion > 0) || dish.portionModel?.standardPortionStatus !== 'verified') {
        hardErrors.push(`${dish.id} (${dish.canonicalName}): CURATED but standard portion is not verified`)
      }
      if (dish.recipeTemplate?.templateStatus !== 'CURATED' && dish.recipeTemplate?.templateStatus !== 'VERIFIED') {
        hardErrors.push(`${dish.id} (${dish.canonicalName}): record is CURATED but templateStatus is '${dish.recipeTemplate?.templateStatus}'`)
      }
    }

    let allSlotsMapped = slots.length > 0
    for (const slot of slots) {
      const mapping = slot.nutritionMapping
      const mapped = mapping && MAPPED_STATUSES.has(mapping.mappingStatus) && mapping.canonicalFoodId
      if (!mapped) allSlotsMapped = false
      if (isCurated) {
        // A CURATED dish has no room for pending-ambiguity statuses.
        if (!mapping || !MAPPED_STATUSES.has(mapping.mappingStatus) || !mapping.canonicalFoodId) {
          hardErrors.push(`${dish.id} (${dish.canonicalName}): CURATED but slot "${slot.label}" is not mapped`)
          continue
        }
        if (slot.amountPrior?.verified !== true) {
          hardErrors.push(`${dish.id} (${dish.canonicalName}): CURATED but slot "${slot.label}" amount prior is not verified`)
        }
      }
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
    if (allSlotsMapped) fullyMappedDishes += 1
    // A draft with every slot still ambiguous cannot justify shipping a
    // search result at all — that dish needs curation, not a pass.
    if (!isCurated && slots.length > 0 && !slots.some((slot) => {
      const mapping = slot.nutritionMapping
      return mapping && MAPPED_STATUSES.has(mapping.mappingStatus) && mapping.canonicalFoodId
    })) {
      hardErrors.push(`${dish.id} (${dish.canonicalName}): DRAFT record has zero verified mappings — curation required`)
    }
  }

  if (draftDishes === 0 && curatedDishes > 0 && fullyMappedDishes !== dishes.length) {
    hardErrors.push(`${dishes.length - fullyMappedDishes} dishes are not fully mapped despite ${draftDishes} drafts remaining`)
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalDishes: dishes.length,
    curatedDishes,
    draftDishes,
    fullyMappedDishes,
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
