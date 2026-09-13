#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DishDefinitionSchema } from '../../packages/core-schema/dist/indian-dish.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')
const SEED_FILE = join(REPO, 'docs', 'indian-dishes.seed.v0.1 (1).json')

function main() {
  const data = JSON.parse(readFileSync(SEED_FILE, 'utf8'))
  let errors = 0
  for (const dish of data) {
    const res = DishDefinitionSchema.safeParse(dish)
    if (!res.success) {
      console.error(`Validation failed for ${dish.id}:`, res.error.issues)
      errors++
    }
  }
  
  if (errors > 0) {
    console.error(`Found ${errors} invalid dishes.`)
    process.exit(1)
  } else {
    console.log(`Successfully validated all ${data.length} dishes against Zod schema.`)
  }
}

main()
