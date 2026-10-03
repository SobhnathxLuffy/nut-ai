#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openNodeDb } from '../../packages/db-adapter/dist/node.js'
import { DishDefinitionSchema } from '../../packages/core-schema/dist/indian-dish.js'
import { computeDishNutrition } from '../../packages/indian-dishes/dist/totals.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')
const MAPPED_FILE = join(REPO, 'docs', 'data', 'indian-dishes.mapped.json')
const REPORT_FILE = join(REPO, 'docs', 'data', 'indian-dishes.mapping-report.json')
const NUTRITION_DB = join(REPO, 'apps/mobile', 'assets', 'nutrition.db')
const IFCT_DB = join(REPO, 'apps/mobile', 'assets', 'ifct.db')
const EXPECTED = new Set(['AUTO_MAPPED', 'MANUAL_OVERRIDE', 'AMBIGUOUS', 'UNRESOLVED'])

async function main() {
  // P0-5b: fail with the remedy, not a raw ENOENT stack from deep inside better-sqlite3.
  if (!existsSync(NUTRITION_DB)) {
    console.error(
      '\nindian-dishes:verify — apps/mobile/assets/nutrition.db not found.\n' +
      'Run `npm run data:build` first (it now compiles the Indian Dish KB too).\n',
    )
    process.exit(1)
  }
  if (!existsSync(IFCT_DB)) {
    console.error(
      '\nindian-dishes:verify — apps/mobile/assets/ifct.db not found.\n' +
      'Run `npm run ifct:build` first.\n',
    )
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(MAPPED_FILE, 'utf8'))
  const report = JSON.parse(readFileSync(REPORT_FILE, 'utf8'))
  const nutrition = openNodeDb(NUTRITION_DB, { readonly: true })
  const ifct = openNodeDb(IFCT_DB, { readonly: true })
  const errors = []
  let slots = 0
  const statusCounts = { AUTO_MAPPED: 0, MANUAL_OVERRIDE: 0, AMBIGUOUS: 0, UNRESOLVED: 0 }
  const sourceCounts = { ifct: 0, usda: 0 }
  const recordCounts = { DRAFT_CURATED: 0, CURATED: 0, VERIFIED: 0 }

  for (const dish of data) {
    const parsed = DishDefinitionSchema.safeParse(dish)
    if (!parsed.success) errors.push(`${dish.id}: schema validation failed: ${parsed.error.issues.map((item) => item.message).join('; ')}`)
    const status = dish.provenance?.recordStatus
    if (status && status in recordCounts) {
      recordCounts[status]++
    }

    if (status === 'CURATED') {
      const required = dish.recipeTemplate.ingredientSlots.filter((slot) => slot.required)
      const mapped = required.every((slot) => ['AUTO_MAPPED', 'MANUAL_OVERRIDE'].includes(slot.nutritionMapping.mappingStatus) && slot.nutritionMapping.canonicalFoodId)
      if (!mapped) errors.push(`${dish.id}: CURATED dish has unmapped required slots`)
      if (dish.recipeTemplate.numericRatiosVerified !== true) errors.push(`${dish.id}: CURATED dish missing verified numeric ratios`)
      if (!Number.isFinite(dish.cooking?.yieldModel?.verifiedNumericYield) || dish.cooking.yieldModel.verifiedNumericYield <= 0) errors.push(`${dish.id}: CURATED dish missing verified numeric yield`)
      if (!Number.isFinite(dish.portionModel?.standardPortionGrams) || dish.portionModel.standardPortionGrams <= 0 || dish.portionModel.standardPortionStatus !== 'verified') errors.push(`${dish.id}: CURATED dish missing verified standard portion`)
      try {
        const computed = await computeDishNutrition({ dish, nutritionDb: nutrition, ifctDb: ifct })
        if (!Number.isFinite(computed.energyKcal) || computed.energyKcal <= 0) {
          errors.push(`${dish.id}: CURATED dish computed non-positive calories: ${computed.energyKcal}`)
        }
      } catch (err) {
        errors.push(`${dish.id}: computeDishNutrition failed on CURATED dish: ${err.message}`)
      }
    } else if (status === 'DRAFT_CURATED') {
      const blockers = dish.provenance?.validation?.blockers ?? []
      if (blockers.length === 0) errors.push(`${dish.id}: DRAFT_CURATED dish must document validation blockers`)
    } else {
      errors.push(`${dish.id}: unsupported recordStatus: ${status}`)
    }
    for (const slot of dish.recipeTemplate?.ingredientSlots ?? []) {
      slots++
      const mapping = slot.nutritionMapping
      if (!EXPECTED.has(mapping.mappingStatus)) errors.push(`${dish.id}/${slot.label}: non-final mapping status ${mapping.mappingStatus}`)
      else statusCounts[mapping.mappingStatus]++
      const shouldHaveId = mapping.mappingStatus === 'AUTO_MAPPED' || mapping.mappingStatus === 'MANUAL_OVERRIDE'
      if (shouldHaveId !== Boolean(mapping.canonicalFoodId)) errors.push(`${dish.id}/${slot.label}: status/id invariant failed`)
      if (mapping.canonicalFoodId?.startsWith('ifct:')) {
        sourceCounts.ifct++
        const sourceId = mapping.canonicalFoodId.slice(5)
        if (!await ifct.get('SELECT id FROM foods WHERE source = ? AND source_id = ?', ['ifct', sourceId])) errors.push(`${dish.id}/${slot.label}: missing IFCT id ${sourceId}`)
      } else if (mapping.canonicalFoodId?.startsWith('usda:')) {
        sourceCounts.usda++
        const sourceId = mapping.canonicalFoodId.slice(5)
        if (!await nutrition.get("SELECT id FROM foods WHERE source LIKE 'fdc_%' AND source_id = ?", [sourceId])) errors.push(`${dish.id}/${slot.label}: missing USDA id ${sourceId}`)
      } else if (mapping.canonicalFoodId) errors.push(`${dish.id}/${slot.label}: unsupported source-qualified id`)
    }
  }
  const checks = {
    totalDishes: data.length, totalIngredientSlots: slots,
    mappedToIFCT: sourceCounts.ifct, mappedToUSDA: sourceCounts.usda,
    autoMapped: statusCounts.AUTO_MAPPED, manualOverrides: statusCounts.MANUAL_OVERRIDE,
    ambiguous: statusCounts.AMBIGUOUS, unresolved: statusCounts.UNRESOLVED,
    DRAFT_CURATED: recordCounts.DRAFT_CURATED, CURATED: recordCounts.CURATED, VERIFIED: recordCounts.VERIFIED,
  }
  if (data.length !== 362) errors.push(`expected 362 dishes, found ${data.length}`)
  // 1441 pre-curation + 2 extra regional slots (Eromba's bespoke recipe and
  // the Singju/Dhuska restructuring) + 1 slot added from reviewed curation
  // (Aloo Paratha's potato_filling, absent in the seed template) + 7 slots
  // restored by scripts/add-missing-fillings.mjs (the missing fillings:
  // Gobi/Paneer/Mooli/Methi/Sattu Paratha, Onion Rava Dosa, Onion Uttapam)
  // = 1451.
  // Owner QA 2026-10: net UNCHANGED at 1451 — 4 reviewed appendSlots (Aloo
  // Tikki's besan binder; Aloo Tikki Chaat's besan binder + tamarind chutney;
  // Sev Tameta's besan-sev topping; Aloo Matar's peas slot) and 4 reviewed
  // removals (the tikkis' bogus potato filling, Sev Tameta's and Tomato
  // Chokha's double-served tomato gravy slots).
  if (slots !== 1_451) errors.push(`expected 1451 ingredient slots, found ${slots}`)

  // P0-6: the BUNDLED artifact must actually contain the dish KB this file
  // validates. Until the KB compile was chained into `npm run data:build`, a
  // fresh clone silently shipped a dish-less app: search reported the food
  // counts, every dish query fell through to decompose, and nothing warned.
  try {
    const dbDishCount = await nutrition.get('SELECT COUNT(*) AS c FROM dish_definitions')
    if (!dbDishCount || dbDishCount.c !== data.length) {
      errors.push(
        `bundled nutrition.db has ${dbDishCount ? dbDishCount.c : 'no dish_definitions table'}, expected ${data.length} dish rows — rebuild with npm run data:build`,
      )
    }
    // A dish FTS probe: the resolver's literal rung must be able to find a
    // CURATED biryani row in the same database the app ships.
    const ftsProbe = await nutrition.get(
      `SELECT d.canonical_name AS name FROM dish_definitions d
       WHERE d.search_rowid IN (SELECT rowid FROM dish_fts WHERE dish_fts MATCH 'biryani')
       AND d.record_status IN ('CURATED', 'VERIFIED') LIMIT 1`,
    )
    if (!ftsProbe) errors.push("dish FTS probe failed: MATCH 'biryani' returned no CURATED row in the bundled db")
  } catch (err) {
    errors.push(`bundled dish KB unreadable: ${err.message} — rebuild with npm run data:build`)
  }
  for (const [key, value] of Object.entries(checks)) if (report[key] !== value) errors.push(`report ${key}=${report[key]} but calculated ${value}`)
  if (report.thresholdsLowered !== false) errors.push('report must record that thresholds were not lowered')
  if (!Array.isArray(report.priorityDeepValidation) || report.priorityDeepValidation.length < 50) errors.push('priority deep-validation set is incomplete')
  await nutrition.close(); await ifct.close()
  if (errors.length > 0) { for (const error of errors) console.error(error); process.exit(1) }
  console.log(JSON.stringify({ verified: true, ...checks, deepValidated: report.priorityDeepValidation.length }, null, 2))
}

main().catch((error) => { console.error(error); process.exit(1) })
