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
 * Every fat-family slot label the shipped corpus uses (added_fat,
 * added_fat_optional, added_fat_or_frying_oil, tadka_fat_optional,
 * fat_optional, cooking_oil, oil_or_ghee, wrapper_cooking_oil,
 * mustard_oil_optional, ghee_finishing_optional, butter_or_ghee). The
 * original implementation matched only `added_fat_optional` / `cooking_oil`,
 * so 44 frying dishes (Aloo Tikki, Samosa, Pakora, …) — whose slot is
 * `added_fat_or_frying_oil` — never got the "which fat did you use?"
 * question (owner QA 2026-10). Role `fat_variable` is the primary signal;
 * the label regex catches any future fat label that forgets the role.
 */
export function isFatSlot(slot: { label: string; role?: string }): boolean {
  return slot.role === 'fat_variable' || /(^|_)(fat|oil|ghee)(_|$)/.test(slot.label)
}

/**
 * Determines what clarification questions are needed for a dish, based on ambiguous slots.
 * This satisfies Part K (Clarification Engine).
 */
export function generateClarifications(dish: DishDefinition): ClarificationQuestion[] {
  if (!dish.recipeTemplate) return []

  const questions: ClarificationQuestion[] = []

  for (const slot of dish.recipeTemplate.ingredientSlots) {
    if (isFatSlot(slot)) {
      questions.push({
        id: `clarify_${slot.label}`,
        slotLabel: slot.label,
        questionText: `Which fat was used for cooking?`,
        options: [
          { label: 'Ghee', canonicalFoodId: 'ifct:T013' },
          { label: 'Mustard Oil', canonicalFoodId: 'ifct:T006' },
          { label: 'Sunflower Oil', canonicalFoodId: 'ifct:T012' },
          { label: 'Groundnut Oil', canonicalFoodId: 'ifct:T005' },
          { label: 'Butter', canonicalFoodId: 'usda:173430' },
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
