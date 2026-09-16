#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')
const DB_PATH = join(REPO, 'apps/mobile/assets/nutrition.db')
const MAPPED_JSON = join(REPO, 'docs', 'data', 'indian-dishes.mapped.json')

async function main() {
  const src = await readFile(join(REPO, 'packages/db-adapter/src/schema.ts'), 'utf8')
  const grab = (name) => {
    const m = new RegExp(`export const ${name} = \\\`([\\s\\S]*?)\\\``).exec(src)
    return m ? m[1] : ''
  }
  
  const DISH_KB_SCHEMA = grab('DISH_KB_SCHEMA')
  const DISH_KB_FTS_SCHEMA = grab('DISH_KB_FTS_SCHEMA')
  
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
    dishes = JSON.parse(readFileSync(join(REPO, 'docs', 'indian-dishes.seed.v0.1 (1).json'), 'utf8'))
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
        JSON.stringify(dish.recipeTemplate || {}),
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
  db.close()
  console.log(`Compiled ${count} dishes into ${DB_PATH}.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
