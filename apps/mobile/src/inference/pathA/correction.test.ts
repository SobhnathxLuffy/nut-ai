import { describe, it, expect } from 'vitest'
import { buildCorrectionPrompt } from '@nutai/prompt'

import { CorrectionIntentZ } from '@nutai/core-schema'

describe('Correction Intent Parser', () => {
  it('builds the correct prompt', () => {
    const { system, user } = buildCorrectionPrompt('make it 2 rotis not 3', [
      {
        id: '1',
        displayName: 'Roti',
        grams: 150,
        nutrientSnapshot: { kcal: 450, protein_g: 15, fat_g: 6, carbs_g: 75, fiber_g: null, sugar_g: null, sodium_mg: null },
        origin: 'estimate' as any,
        sourceFoodId: null, gramPathway: "discrete_count", bandHalfPct: 5, isEstimate: true, assumptions: []
      }
    ])
    expect(system).toContain('You are a nutrition logging correction assistant')
    expect(user).toContain('make it 2 rotis not 3')
    expect(system).toContain('Roti')
  })

  it('validates quantity correction', () => {
    const intent = {
      operations: [
        {
          type: 'update_quantity',
          id: '1',
          grams: 100,
          qualitative_size: '2 items'
        }
      ],
      clarification_needed: null
    }
    const parsed = CorrectionIntentZ.parse(intent)
    expect(parsed.operations[0].type).toBe('update_quantity')
  })

  it('validates ingredient add', () => {
    const intent = {
      operations: [
        {
          type: 'add_item',
          name: 'Butter',
          canonical_food_key: 'butter',
          grams: 14,
          qualitative_size: '1 tbsp'
        }
      ],
      clarification_needed: null
    }
    const parsed = CorrectionIntentZ.parse(intent)
    expect(parsed.operations[0].type).toBe('add_item')
  })
})
