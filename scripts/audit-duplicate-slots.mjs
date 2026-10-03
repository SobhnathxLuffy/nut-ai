#!/usr/bin/env node
/**
 * AUDIT 3 — Duplicate-food slot check (owner QA 2026-10 catcher).
 *
 * THE BUG THIS CATCHES: the same food appearing in TWO ingredient slots of
 * one dish — "aloo inside aloo" (Aloo Tikki carried potato as both the patty
 * and a street_snack family-prior "filling"), moong dal twice in a chilla,
 * peas twice in aloo matar, yogurt twice in dahi vada. One family prior plus
 * one name claim can both land on the same food, and nothing used to fail.
 *
 * Same food twice is almost never a real recipe: the honest modeling for a
 * genuine two-role ingredient (tomato base AND tomato gravy) is ONE slot with
 * a widened range plus a review note saying so. Zero exemptions — a new
 * duplicate must be fixed in the data, not whitelisted here.
 */
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const nutrition = new Database(join(REPO, 'apps/mobile/assets/nutrition.db'), { readonly: true })

const dishes = nutrition.prepare(`
  SELECT d.id, d.canonical_name as name, d.recipe_template_json as template
  FROM dish_definitions d WHERE d.record_status = 'CURATED'
`).all()

const failures = []
for (const dish of dishes) {
  let slots = []
  try {
    slots = JSON.parse(dish.template)?.ingredientSlots ?? []
  } catch {
    failures.push(`${dish.name}: recipe template does not parse`)
    continue
  }
  const byFood = new Map()
  for (const slot of slots) {
    const foodId = slot.nutritionMapping?.canonicalFoodId
    if (!foodId) continue
    if (!byFood.has(foodId)) byFood.set(foodId, [])
    byFood.get(foodId).push(slot.label)
  }
  for (const [foodId, labels] of byFood) {
    if (labels.length > 1) {
      failures.push(`${dish.name}: food ${foodId} appears in ${labels.length} slots (${labels.join(', ')})`)
    }
  }
}

console.log(`Duplicate-slot audit: ${dishes.length} curated dishes checked for the same food in multiple slots.`)
if (failures.length === 0) {
  console.log('ALL PASS — no dish serves the same food twice.')
} else {
  console.log(`FAILURES: ${failures.length}`)
  for (const f of failures) console.log(' -', f)
  process.exit(1)
}
