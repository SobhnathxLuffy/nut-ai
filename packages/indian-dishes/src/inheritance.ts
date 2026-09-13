import type { DishDefinition } from '@nutai/core-schema'

/**
 * Validates inheritance rules and resolves a full dish definition from its parent.
 * 
 * Rules:
 * 1. Reject circular inheritance.
 * 2. Reject inheritance if families do not match.
 * 3. Merge recipe templates, cooking methods, and portion models.
 */
export function resolveInheritance(
  dish: DishDefinition,
  lookupParent: (id: string) => DishDefinition | null,
  visited = new Set<string>()
): DishDefinition {
  if (!dish.parentDishId) {
    return dish
  }

  if (visited.has(dish.id)) {
    throw new Error(`Circular inheritance detected for dish: ${dish.id}`)
  }

  visited.add(dish.id)

  const parent = lookupParent(dish.parentDishId)
  if (!parent) {
    throw new Error(`Parent dish not found: ${dish.parentDishId}`)
  }

  if (parent.family !== dish.family) {
    throw new Error(`Illegal inheritance: Dish ${dish.id} family (${dish.family}) does not match parent ${parent.id} family (${parent.family})`)
  }

  // Resolve parent first (supports deep inheritance)
  const resolvedParent = resolveInheritance(parent, lookupParent, visited)

  // Merge recipe templates (child slots override parent slots by label)
  const mergedSlots = [...resolvedParent.recipeTemplate.ingredientSlots]
  for (const childSlot of dish.recipeTemplate.ingredientSlots) {
    const existingIdx = mergedSlots.findIndex(s => s.label === childSlot.label)
    if (existingIdx >= 0) {
      mergedSlots[existingIdx] = childSlot
    } else {
      mergedSlots.push(childSlot)
    }
  }

  return {
    ...resolvedParent,
    ...dish, // Child overwrites root properties
    aliases: Array.from(new Set([...(resolvedParent.aliases || []), ...(dish.aliases || [])])),
    searchTerms: Array.from(new Set([...(resolvedParent.searchTerms || []), ...(dish.searchTerms || [])])),
    cooking: {
      ...resolvedParent.cooking,
      ...dish.cooking,
      methods: Array.from(new Set([...resolvedParent.cooking.methods, ...dish.cooking.methods]))
    },
    recipeTemplate: {
      ...resolvedParent.recipeTemplate,
      ...dish.recipeTemplate,
      ingredientSlots: mergedSlots
    },
    portionModel: {
      ...resolvedParent.portionModel,
      ...dish.portionModel,
      strategies: Array.from(new Set([...resolvedParent.portionModel.strategies, ...dish.portionModel.strategies]))
    }
  }
}
