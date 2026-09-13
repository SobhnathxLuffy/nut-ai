import type { DishDefinition } from '@nutai/core-schema'

export interface ClarificationQuestion {
  id: string
  slotLabel: string
  questionText: string
  options: {
    label: string
    canonicalFoodId: string | null
    amountMultiplier?: number
  }[]
}

/**
 * Determines what clarification questions are needed for a dish, based on ambiguous slots.
 * This satisfies Part K (Clarification Engine).
 */
export function generateClarifications(dish: DishDefinition): ClarificationQuestion[] {
  if (!dish.recipeTemplate) return []

  const questions: ClarificationQuestion[] = []

  for (const slot of dish.recipeTemplate.ingredientSlots) {
    if (slot.label === 'added_fat_optional' || slot.label === 'cooking_oil') {
      questions.push({
        id: `clarify_${slot.label}`,
        slotLabel: slot.label,
        questionText: `Which fat was used for cooking?`,
        options: [
          { label: 'Ghee', canonicalFoodId: 'ifct:T013' },
          { label: 'Mustard Oil', canonicalFoodId: 'ifct:T006' },
          { label: 'Sunflower Oil', canonicalFoodId: 'ifct:T012' },
          { label: 'None / Dry Roasted', canonicalFoodId: null, amountMultiplier: 0 }
        ]
      })
    } else if (slot.nutritionMapping.mappingStatus === 'unresolved') {
        questions.push({
            id: `clarify_${slot.label}`,
            slotLabel: slot.label,
            questionText: `What kind of ${slot.label.replace(/_/g, ' ')} did you use?`,
            options: [] // To be populated by dynamic search
        })
    }
  }

  // Deduplicate questions by ID
  const uniqueQuestions = new Map<string, ClarificationQuestion>()
  for (const q of questions) {
    if (!uniqueQuestions.has(q.id)) {
      uniqueQuestions.set(q.id, q)
    }
  }

  return Array.from(uniqueQuestions.values())
}

/**
 * Applies the user's answers to the dish definition, updating the ingredient slots.
 */
export function applyClarifications(
  dish: DishDefinition,
  answers: Record<string, { canonicalFoodId: string | null, amountMultiplier?: number }>
): DishDefinition {
  if (!dish.recipeTemplate) return dish

  const newSlots = dish.recipeTemplate.ingredientSlots.map(slot => {
    const answer = answers[`clarify_${slot.label}`]
    if (answer) {
      return {
        ...slot,
        nutritionMapping: {
          ...slot.nutritionMapping,
          mappingStatus: 'mapped' as const,
          canonicalFoodId: answer.canonicalFoodId
        },
        amountPrior: answer.amountMultiplier !== undefined && slot.amountPrior?.kind === 'broad_mass_fraction_engineering_prior' ? {
          ...slot.amountPrior,
          range: [
            slot.amountPrior.range[0] * answer.amountMultiplier,
            slot.amountPrior.range[1] * answer.amountMultiplier
          ] as [number, number]
        } : slot.amountPrior
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
