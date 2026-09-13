import type { DbAdapter } from '@nutai/db-adapter'
import type { DishDefinition } from '@nutai/core-schema'

export interface HouseholdDefault {
  dishId: string
  slotLabel: string
  canonicalFoodId: string
  updatedAt: number
}

/**
 * Saves a user's clarification answer as a household default.
 */
export async function saveHouseholdDefault(
  userDb: DbAdapter,
  dishId: string,
  slotLabel: string,
  canonicalFoodId: string
) {
  await userDb.run(
    `INSERT INTO household_defaults (dish_id, slot_label, canonical_food_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (dish_id, slot_label) DO UPDATE SET canonical_food_id = ?, updated_at = ?`,
    [dishId, slotLabel, canonicalFoodId, Date.now(), canonicalFoodId, Date.now()]
  )
}

/**
 * Applies household defaults to a dish definition.
 */
export async function applyHouseholdDefaults(
  userDb: DbAdapter,
  dish: DishDefinition
): Promise<DishDefinition> {
  if (!dish.recipeTemplate) return dish

  // Check if table exists
  try {
    await userDb.run(`
      CREATE TABLE IF NOT EXISTS household_defaults (
        dish_id TEXT NOT NULL,
        slot_label TEXT NOT NULL,
        canonical_food_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (dish_id, slot_label)
      )
    `)
  } catch {
    // Ignore if exists
  }

  const defaults = await userDb.all<HouseholdDefault>(
    `SELECT dish_id as dishId, slot_label as slotLabel, canonical_food_id as canonicalFoodId, updated_at as updatedAt
     FROM household_defaults WHERE dish_id = ?`,
    [dish.id]
  )

  if (!defaults.length) return dish

  const defaultMap = new Map(defaults.map(d => [d.slotLabel, d.canonicalFoodId]))

  const newSlots = dish.recipeTemplate.ingredientSlots.map(slot => {
    const canonicalFoodId = defaultMap.get(slot.label)
    if (canonicalFoodId) {
      return {
        ...slot,
        nutritionMapping: {
          ...slot.nutritionMapping,
          mappingStatus: 'mapped' as const,
          canonicalFoodId
        }
      }
    }
    return slot
  })

  return {
    ...dish,
    recipeTemplate: {
      ...dish.recipeTemplate,
      ingredientSlots: newSlots
    }
  }
}
