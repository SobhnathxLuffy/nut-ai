#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
// P2-40: import the COMPILED schema exports instead of regex-scraping the
// TypeScript source — a renamed or reformatted const in schema.ts used to
// silently build an empty dish knowledge base.
import { DISH_KB_SCHEMA, DISH_KB_FTS_SCHEMA } from '../../packages/db-adapter/dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')
const DB_PATH = join(REPO, 'apps/mobile/assets/nutrition.db')
const MAPPED_JSON = join(REPO, 'docs', 'data', 'indian-dishes.mapped.json')

// ---------------------------------------------------------------------------
// Supplemental ingredient rows.
//
// Plain tea and brewed coffee are genuinely absent from BOTH bundled corpora
// (IFCT 2017 subset: no tea/coffee rows; the shipped USDA release: only
// ready-to-drink and herbal variants). The dish curation needs them for
// Masala Chai, Milk Tea and Filter Coffee, so they ship as USDA FoodData
// Central reference values in a dedicated `fdc_supplemental` source — never
// misrepresented as verbatim SR Legacy rows. The `fdc_%` source pattern means
// the existing USDA source, resolver and mapping loader pick them up as
// ordinary usda: foods with zero special-casing, and the source_id `SUP-`
// namespace can never collide with a real FDC id.
// ---------------------------------------------------------------------------
const SUPPLEMENTAL_FOODS = [
  {
    sourceId: 'SUP-TEA-001',
    name: 'Tea, black, brewed, plain',
    energy: 1, protein: 0, fat: 0, carb: 0.3, fiber: 0, sugar: 0, sodium: 3,
    note: 'USDA FDC reference values for plain brewed black tea (~1 kcal/100 g).',
  },
  {
    sourceId: 'SUP-COF-001',
    name: 'Coffee, brewed, plain',
    energy: 1, protein: 0.1, fat: 0, carb: 0, fiber: 0, sugar: 0, sodium: 2,
    note: 'USDA FDC reference values for plain brewed coffee (~1 kcal/100 g).',
  },
]

function ensureSupplementalFoods(db) {
  const schemaRow = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foods'").get()
  if (!schemaRow) return 0 // fixture/food-less DB — nothing to do
  let inserted = 0
  const insertFood = db.prepare(`
    INSERT INTO foods (source, source_id, name, basis, basis_confidence,
                       energy_kcal, protein_g, fat_g, sat_fat_g, carb_g, fiber_g,
                       sugar_g, sodium_mg, completeness_score, popularity_rank,
                       license, updated_at)
    VALUES ('fdc_supplemental', ?, ?, 'per_100g', 'reviewed',
            ?, ?, ?, NULL, ?, ?, ?, ?, 1.0, 50,
            'Public domain (USDA FoodData Central reference values)', ?)
  `)
  const now = Date.now()
  const tx = db.transaction(() => {
    for (const food of SUPPLEMENTAL_FOODS) {
      const existing = db.prepare("SELECT id FROM foods WHERE source = 'fdc_supplemental' AND source_id = ?").get(food.sourceId)
      if (existing) continue
      const info = insertFood.run(food.sourceId, food.name, food.energy, food.protein, food.fat, food.carb, food.fiber, food.sugar, food.sodium, now)
      const rowId = Number(info.lastInsertRowid)
      // Keep the FTS indexes in sync so search finds the new rows.
      const ftsTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('food_fts','food_fts_trigram')").all()
      for (const t of ftsTables) {
        if (t.name === 'food_fts') db.prepare('INSERT INTO food_fts (rowid, name, brand, synonyms) VALUES (?, ?, NULL, ?)').run(rowId, food.name, food.sourceId)
        if (t.name === 'food_fts_trigram') db.prepare('INSERT INTO food_fts_trigram (rowid, name) VALUES (?, ?)').run(rowId, food.name)
      }
      inserted += 1
    }
  })
  tx()
  return inserted
}

async function main() {
  // P2-40 companion: fail LOUDLY if the compiled adapter is stale or missing
  // (run the workspace build first) instead of db.exec('') no-op'ing into a
  // confusing "no such table" failure later.
  if (!DISH_KB_SCHEMA || !DISH_KB_FTS_SCHEMA) {
    throw new Error(
      'build-sqlite: DISH_KB_SCHEMA/DISH_KB_FTS_SCHEMA are empty — rebuild packages/db-adapter (npm run build) so the compiled exports are current.',
    )
  }

  const db = new Database(DB_PATH)
  
  db.exec('DROP TABLE IF EXISTS dish_aliases;')
  db.exec('DROP TABLE IF EXISTS dish_fts;')
  db.exec('DROP TABLE IF EXISTS dish_fts_trigram;')
  db.exec('DROP TABLE IF EXISTS dish_definitions;')
  
  db.exec(DISH_KB_SCHEMA)
  db.exec(DISH_KB_FTS_SCHEMA)
  
  let dishes = []
  try {
    dishes = JSON.parse(readFileSync(MAPPED_JSON, 'utf8'))
  } catch {
    // P2-12: the fossil fallback silently rebuilt an EMPTY/stale dish KB and
    // masked the failure. A missing or unreadable mapped seed must stop the
    // build — run `npm run indian-dishes:curate` to produce it.
    throw new Error(
      `build-sqlite: cannot read ${MAPPED_JSON} — refusing to build the dish KB from a fallback. Regenerate it with: npm run indian-dishes:map && npm run indian-dishes:curate`,
    )
  }
  
  const insertDish = db.prepare(`
    INSERT INTO dish_definitions (
      id, search_rowid, canonical_name, category, family, parent_dish_id,
      cooking_methods_json, yield_model_json, recipe_template_json,
      portion_model_json, uncertainty_model_json, resolver_config_json, record_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  const insertAlias = db.prepare('INSERT INTO dish_aliases (dish_id, alias, is_search_term) VALUES (?, ?, ?)')
  const insertFts = db.prepare('INSERT INTO dish_fts (rowid, canonical_name, aliases, search_terms) VALUES (?, ?, ?, ?)')
  const insertFtsTri = db.prepare('INSERT INTO dish_fts_trigram (rowid, canonical_name, aliases) VALUES (?, ?, ?)')

  // P2-11 (QA Wave 4): the IngredientSuggestion mechanism was provably inert —
  // the generator only targets DRAFT dishes, zero drafts remain, and the
  // injection skipped every CURATED record. Deleted rather than kept as dead
  // machinery that misled contributors into thinking suggestions flow.
  const templateOf = (dish) => dish.recipeTemplate || {}
  
  let count = 0
  const tx = db.transaction(() => {
    for (const dish of dishes) {
      count++
      insertDish.run(
        dish.id,
        count,
        dish.canonicalName,
        dish.category,
        dish.family,
        dish.parentDishId || null,
        JSON.stringify(dish.cooking?.methods || []),
        JSON.stringify(dish.cooking?.yieldModel || {}),
        JSON.stringify(templateOf(dish)),
        JSON.stringify(dish.portionModel || {}),
        JSON.stringify(dish.uncertaintyModel || {}),
        JSON.stringify(dish.resolver || {}),
        dish.provenance?.recordStatus || 'DRAFT_CURATED'
      )
      
      const aliases = dish.aliases || []
      const searchTerms = dish.searchTerms || []
      
      for (const alias of aliases) {
        insertAlias.run(dish.id, alias, searchTerms.includes(alias) ? 1 : 0)
      }
      
      insertFts.run(count, dish.canonicalName, aliases.join(' '), searchTerms.join(' '))
      insertFtsTri.run(count, dish.canonicalName, aliases.join(' '))
    }
  })
  
  tx()
  const supplemental = ensureSupplementalFoods(db)

  // P1-10: ship the corpus-honesty metrics INSIDE the artifact they describe,
  // so the app's dish-KB header reports the shipped truth instead of a docs
  // report that may (and did) contradict it. The split is recomputed from the
  // exact records being inserted, not copied from an earlier pipeline stage.
  const MAPPED = new Set(['AUTO_MAPPED', 'MANUAL_OVERRIDE', 'mapped'])
  const slotMapped = (slot) =>
    !!slot?.nutritionMapping && MAPPED.has(slot.nutritionMapping.mappingStatus) && !!slot.nutritionMapping.canonicalFoodId
  let fullyMapped = 0
  let partiallyMapped = 0
  let unmapped = 0
  let yieldVerified = 0
  for (const dish of dishes) {
    const slots = dish.recipeTemplate?.ingredientSlots ?? []
    const mappedCount = slots.filter(slotMapped).length
    if (slots.length > 0 && mappedCount === slots.length) fullyMapped += 1
    else if (mappedCount > 0) partiallyMapped += 1
    else unmapped += 1
    const ym = dish.cooking?.yieldModel
    if (ym?.status === 'verified' && typeof ym?.verifiedNumericYield === 'number' && Number.isFinite(ym.verifiedNumericYield) && ym.verifiedNumericYield > 0) {
      yieldVerified += 1
    }
  }
  const manifest = db.prepare('INSERT INTO build_manifest (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  const nowIso = new Date().toISOString()
  manifest.run('dish_kb_dishes', String(dishes.length))
  manifest.run('dish_kb_fully_mapped', String(fullyMapped))
  manifest.run('dish_kb_partially_mapped', String(partiallyMapped))
  manifest.run('dish_kb_unmapped', String(unmapped))
  manifest.run('dish_kb_yield_verified', String(yieldVerified))
  manifest.run('dish_kb_built_at', nowIso)

  // Owner QA 2026-10: a device that ever imported an early/partial corpus kept
  // serving it forever — `importDatabaseFromAssetAsync` is idempotent by name
  // and the only freshness probe was "does the dish_definitions table exist",
  // so an on-disk DB with FEWER dishes than the shipped asset was never
  // replaced (the browser showed a handful of rows under a "362 identities"
  // headline). The fix is a content-derived revision stamped INSIDE the
  // artifact and mirrored into a generated TS constant: the app compares the
  // on-disk revision against the bundled one and force-reimports on any
  // mismatch. Content-derived (not timestamp) so rebuilding identical data
  // keeps the same revision and triggers no pointless 4.7 MB re-copy.
  const counts = db.prepare("SELECT (SELECT COUNT(*) FROM foods) AS foods, (SELECT COUNT(*) FROM food_portions) AS portions").get()
  const revisionHash = createHash('sha256')
  revisionHash.update(JSON.stringify(dishes))
  revisionHash.update(`|foods:${counts.foods}|portions:${counts.portions}`)
  const revision = revisionHash.digest('hex').slice(0, 12)
  manifest.run('corpus_revision', revision)

  // Mirror the revision into the bundle so openNutritionDb() can compare
  // without opening the asset. Written as a full file (not appended) — the
  // generated module is the single source the adapter imports.
  const generatedTs = `// GENERATED by tools/indian-dishes/build-sqlite.mjs — do not edit by hand.
// The content-derived revision of the nutrition.db this build shipped.
// openNutritionDb() compares the on-disk copy's build_manifest.corpus_revision
// against this constant and force-reimports the asset on any mismatch, so an
// app update can never keep serving a stale corpus (owner QA 2026-10: the
// Indian-dishes browser showed a handful of rows under a "362 identities"
// headline because an early import was never refreshed).
export const REQUIRED_CORPUS_REVISION = '${revision}'
`
  writeFileSync(join(REPO, 'apps/mobile/src/data/corpus-revision.ts'), generatedTs)

  db.close()
  console.log(`Compiled ${count} dishes into ${DB_PATH} (fully mapped ${fullyMapped}, partial ${partiallyMapped}, unmapped ${unmapped}; yield-verified ${yieldVerified}; ${supplemental} supplemental ingredients ensured).`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
