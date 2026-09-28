#!/usr/bin/env node
/**
 * Name-derived ingredient suggestions for DRAFT dish records.
 *
 * The dish KB ships 362 dishes; 50 are CURATED with verified numeric recipes,
 * and 312 remain DRAFT whose ingredient slots are generic category labels
 * ("primary_vegetable") with no per-dish identity. Mapping those slots blindly
 * would fabricate confidence the data does not have — the honest upgrade is a
 * REVIEWED SUGGESTION: parse the dish's own name (the strongest signal a dish
 * record carries — "Aloo Matar" names potato and peas), resolve every match to
 * a pinned, DB-verified IFCT/USDA food id, and let the app pre-seed the dish
 * composer so a person confirms grams before any number is logged.
 *
 * Every suggestion entry below was resolved against the bundled IFCT corpus
 * (apps/mobile/assets/ifct.db) and is re-validated at run time — a stale or
 * mistyped id fails the build instead of silently shipping a wrong mapping.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openNodeDb } from '../../packages/db-adapter/dist/node.js'
// The reviewed pin list — shared with curate-drafts.mjs so the two passes can
// never drift apart. Grams are typical raw amounts in a family-size pot.
import { PINNED, PHRASES } from './pinned-ingredients.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')
// The MAPPED file is what build-sqlite.mjs actually ships — reading it keeps
// suggestions consistent with the shipped record statuses (CURATED dishes,
// whose recipes are already fully verified, are excluded here).
const SEED_FILE = join(REPO, 'docs', 'data', 'indian-dishes.mapped.json')
const OUT_FILE = join(HERE, 'dish-ingredient-suggestions.json')

function normalized(value) {
  return value.normalize('NFKD').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

async function validatePinned(ifctDb, usdaDb) {
  const problems = []
  for (const [token, entry] of Object.entries(PINNED)) {
    if (!entry) continue
    const { foodId } = entry
    const [source, sourceId] = foodId.split(':')
    const db = source === 'ifct' ? ifctDb : usdaDb
    const where = source === 'ifct' ? "source = 'ifct' AND source_id" : "source LIKE 'fdc_%' AND source_id"
    const row = await db.get(`SELECT name, energy_kcal FROM foods WHERE ${where} = ?`, [sourceId])
    if (!row) problems.push(`${token}: ${foodId} missing from corpus`)
    else if (!(row.energy_kcal > 0)) problems.push(`${token}: ${foodId} has no energy value`)
  }
  return problems
}

async function main() {
  const ifctDb = openNodeDb(join(REPO, 'apps/mobile/assets/ifct.db'), { readonly: true })
  const usdaDb = openNodeDb(join(REPO, 'apps/mobile/assets/nutrition.db'), { readonly: true })

  const problems = await validatePinned(ifctDb, usdaDb)
  if (problems.length > 0) {
    console.error('Pinned suggestion ids failed validation:\n' + problems.map((p) => `  - ${p}`).join('\n'))
    process.exit(1)
  }

  const dishes = JSON.parse(readFileSync(SEED_FILE, 'utf8'))
  const out = {}
  let draftDishes = 0
  let withSuggestions = 0
  let multiIngredient = 0

  for (const dish of dishes) {
    const status = dish.provenance?.recordStatus
    if (status !== 'DRAFT_CURATED') continue
    draftDishes += 1

    const matched = new Map()
    const texts = [normalized(dish.canonicalName), ...new Set([...(dish.aliases ?? []), ...(dish.searchTerms ?? [])].map(normalized))]

    const matchText = (text) => {
      // Phrases first, then single tokens, in the order they appear in the name.
      for (const phrase of Object.keys(PHRASES)) {
        const entry = PHRASES[phrase]
        if (entry && text.includes(phrase) && !matched.has(phrase)) matched.set(phrase, entry)
      }
      for (const word of text.split(' ')) {
        const entry = PINNED[word]
        if (entry && !matched.has(word)) matched.set(word, entry)
      }
    }
    texts.forEach(matchText)

    if (matched.size === 0) continue
    withSuggestions += 1
    const suggestions = [...matched.values()]
      .slice(0, 4)
      .map((entry) => ({ foodId: entry.foodId, label: entry.label, defaultGrams: entry.grams }))
    if (suggestions.length >= 2) multiIngredient += 1
    out[dish.id] = {
      dishName: dish.canonicalName,
      matchedTokens: [...matched.keys()],
      suggestions,
    }
  }

  writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`)

  const summary = {
    draftDishes,
    dishesWithSuggestions: withSuggestions,
    dishesWithTwoOrMoreIngredients: multiIngredient,
    coveragePercent: draftDishes === 0 ? 0 : Math.round((withSuggestions / draftDishes) * 100),
    distinctPinnedIngredients: new Set(Object.values(PINNED).filter(Boolean).map((e) => e.foodId)).size,
  }
  console.log(JSON.stringify(summary, null, 2))
  await ifctDb.close()
  await usdaDb.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
