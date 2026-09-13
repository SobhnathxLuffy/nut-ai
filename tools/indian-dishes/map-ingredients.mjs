#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openNodeDb } from '../../packages/db-adapter/dist/node.js'
import { resolveByText } from '../../packages/resolver/dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')
const SEED_FILE = join(HERE, '..', '..', 'docs', 'indian-dishes.seed.v0.1 (1).json')
const OUT_FILE = join(HERE, '..', '..', 'docs', 'data', 'indian-dishes.mapped.json')
const REVIEW_QUEUE_FILE = join(HERE, '..', '..', 'docs', 'data', 'indian-dishes.review-queue.json')

async function main() {
  console.log('Opening databases...')
  const nutritionDb = openNodeDb(join(REPO, 'apps/mobile/assets/nutrition.db'), { readonly: true })
  const ifctDb = openNodeDb(join(REPO, 'apps/mobile/assets/ifct.db'), { readonly: true })

  console.log(`Reading seed corpus from ${SEED_FILE}...`)
  const dishes = JSON.parse(readFileSync(SEED_FILE, 'utf8'))
  
  const reviewQueue = {
    mapped: [],
    ambiguous: [],
    unresolved: [],
    manual_override: []
  }

  let totalSlots = 0

  for (const dish of dishes) {
    if (!dish.recipeTemplate || !dish.recipeTemplate.ingredientSlots) continue
    
    for (const slot of dish.recipeTemplate.ingredientSlots) {
      if (slot.nutritionMapping.mappingStatus === 'pending_exact_id') {
        totalSlots++
        
        // Use resolver to find mapping
        const result = await resolveByText(nutritionDb, {
          canonicalFoodKey: slot.label,
          observedBrand: null,
          prepFacet: null,
          modelCategory: null,
          estimatedGrams: 100
        }, { ifctDb })

        const queueItem = {
          dishId: dish.id,
          dishName: dish.canonicalName,
          slotLabel: slot.label,
          result: result.outcome
        }

        if (result.outcome.kind === 'auto_accept') {
          slot.nutritionMapping.canonicalFoodId = result.outcome.match.foodId
          slot.nutritionMapping.mappingStatus = 'mapped'
          reviewQueue.mapped.push(queueItem)
          resolvedSlots++
        } else if (result.outcome.kind === 'disambiguate') {
          reviewQueue.ambiguous.push(queueItem)
        } else {
          reviewQueue.unresolved.push(queueItem)
        }
      }
    }
  }

  writeFileSync(OUT_FILE, JSON.stringify(dishes, null, 2))
  writeFileSync(REVIEW_QUEUE_FILE, JSON.stringify(reviewQueue, null, 2))
  
  console.log(`Processed ${totalSlots} pending ingredient slots.`)
  console.log(`Auto-mapped: ${reviewQueue.mapped.length}`)
  console.log(`Ambiguous: ${reviewQueue.ambiguous.length}`)
  console.log(`Unresolved: ${reviewQueue.unresolved.length}`)

  await nutritionDb.close()
  await ifctDb.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
