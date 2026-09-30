import { describe, expect, it } from 'vitest'
import type { Item } from '@nutai/core-schema'
import {
  countAnswerMultiplier,
  inferStructuralUncertainty,
  isCountAmbiguous,
  isWholeDishItem,
  MAX_QUESTIONS,
  QUESTION_BANK,
  recordAnswer,
  REMEMBER_AFTER_ANSWERS,
  selectMealQuestions,
  selectQuestions,
  shouldApplySilently,
  wholeDishSizeMultiplier,
} from './index.js'

function item(over: Partial<Item> = {}): Item {
  return {
    name: 'Banana',
    brand: null,
    canonical_food_key: 'banana, raw',
    food_form: 'discrete',
    qualitative_size: 'count:1',
    weight_basis: 'as_served',
    model_gram_estimate: 118,
    identification_confidence: 0.95,
    portion_confidence: 0.9,
    uncertainty_reason: 'none',
    visible_reference_objects: [{ type: 'dinner_plate', bbox: [0, 0, 0.5, 0.5], confidence: 0.8 }],
    container: null,
    cooking_method_cues: ['none_visible'],
    is_beverage: false,
    beverage_category: null,
    legible_label_text: null,
    stated_assumptions: [],
    clarifying_questions: [],
    fallback_macros_at_estimate: {
      calories_kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4, fiber_g: 3.1, sodium_mg: 1,
    },
    ...over,
  }
}

const stirFry = item({
  name: 'Chicken stir-fry',
  canonical_food_key: 'chicken stir fry with vegetables',
  food_form: 'piled',
  qualitative_size: 'medium',
  uncertainty_reason: 'oil_or_fat_not_visually_determinable',
  portion_confidence: 0.4,
  cooking_method_cues: ['sauce_coating'],
})

describe('the asymmetry that keeps this from becoming a chore', () => {
  it('surfaces at most one highlighted question for a plain banana', () => {
    const qs = selectQuestions({ item: item() })
    const highlighted = qs.filter((q) => q.state === 'highlighted')
    // Rank 1 ("did you eat all of it") is the only one that should fire, and it is
    // one tap on a chip that is already the right answer.
    expect(highlighted.length).toBeLessThanOrEqual(1)
    expect(highlighted.every((q) => q.question.id === 'portion_eaten')).toBe(true)
  })

  it('does not ask about oil on a plain grilled chicken breast', () => {
    const qs = selectQuestions({
      item: item({
        canonical_food_key: 'chicken breast, grilled',
        food_form: 'flat',
        qualitative_size: 'medium',
        cooking_method_cues: ['grill_marks'],
      }),
    })
    expect(qs.some((q) => q.question.id === 'cooking_oil')).toBe(false)
  })

  it('does ask about oil on a stir-fry', () => {
    const qs = selectQuestions({ item: stirFry })
    const oil = qs.find((q) => q.question.id === 'cooking_oil')
    expect(oil).toBeDefined()
    expect(oil?.state).toBe('highlighted')
  })
})

describe('the two-question cap', () => {
  it('never highlights more than MAX_QUESTIONS for one item', () => {
    const qs = selectQuestions({
      item: item({
        canonical_food_key: 'chicken stir fry salad bowl with sauce',
        uncertainty_reason: 'oil_or_fat_not_visually_determinable',
        portion_confidence: 0.1,
      }),
      multiServingPackage: true,
      gramDisagreement: { low: 140, high: 220 },
    })
    expect(qs.filter((q) => q.state === 'highlighted').length).toBeLessThanOrEqual(MAX_QUESTIONS)
  })

  it('never highlights more than MAX_QUESTIONS across a whole meal', () => {
    const qs = selectMealQuestions([
      { item: stirFry },
      { item: { ...stirFry, name: 'Fried rice', canonical_food_key: 'fried rice' } },
      { item: { ...stirFry, name: 'Curry', canonical_food_key: 'chicken curry' } },
    ])
    expect(qs.filter((q) => q.state === 'highlighted').length).toBeLessThanOrEqual(MAX_QUESTIONS)
  })

  it('demotes rather than drops, so every default stays disclosed', () => {
    const qs = selectMealQuestions([
      { item: stirFry },
      { item: { ...stirFry, canonical_food_key: 'fried rice' } },
      { item: { ...stirFry, canonical_food_key: 'chicken curry' } },
    ])
    const demoted = qs.filter((q) => q.state === 'pre_answered')
    expect(demoted.length).toBeGreaterThan(0)
    // Every pre-answered chip carries both its applied default and its disclosure.
    for (const q of demoted) {
      expect(q.appliedDefault).not.toBeNull()
      expect(q.disclosure.length).toBeGreaterThan(0)
    }
  })
})

describe('every silent default is disclosed, never hidden', () => {
  it('gives every question in the bank a default and a disclosure string', () => {
    for (const q of QUESTION_BANK) {
      expect(q.silentDefault, `${q.id} has no default`).toBeTruthy()
      expect(q.defaultDisclosure, `${q.id} has no disclosure`).toBeTruthy()
    }
  })

  it('discloses the multi-serving assumption rather than quietly logging one', () => {
    const qs = selectQuestions({ item: item(), multiServingPackage: true })
    const serving = qs.find((q) => q.question.id === 'servings_consumed')
    expect(serving).toBeDefined()
    expect(serving?.question.defaultDisclosure).toMatch(/tap to change/i)
  })

  it('assumes regular soda, not diet — the higher-risk direction', () => {
    const q = QUESTION_BANK.find((x) => x.id === 'regular_or_diet')!
    // Silently assuming zero-calorie undercounts, and undercounting is the failure
    // a user cannot detect for themselves.
    expect(q.silentDefault).toBe('regular')
  })

  it('assumes the LOWER estimate for a shake, because the builder is one tap away', () => {
    const q = QUESTION_BANK.find((x) => x.id === 'shake_recipe')!
    expect(q.silentDefault).toBe('water')
  })
})

describe('ranks 1-2 are near-unconditional because they resolve with certainty', () => {
  it('asks the portion question even when the model is highly confident', () => {
    const qs = selectQuestions({ item: item({ portion_confidence: 0.99 }) })
    const portion = qs.find((q) => q.question.id === 'portion_eaten')
    expect(portion?.state).toBe('highlighted')
  })

  it('orders multiplicative questions ahead of additive ones', () => {
    const qs = selectQuestions({ item: stirFry, multiServingPackage: true })
    const firstAdditiveIndex = qs.findIndex((q) => !q.question.multiplicative)
    const lastMultiplicativeIndex = qs.map((q) => q.question.multiplicative).lastIndexOf(true)
    expect(lastMultiplicativeIndex).toBeLessThan(firstAdditiveIndex)
  })
})

describe('structural uncertainty is a floor, not a replacement', () => {
  it('flags oil on a stir-fry even when the model said nothing', () => {
    const s = inferStructuralUncertainty(
      item({ canonical_food_key: 'beef stir fry', uncertainty_reason: 'none' }),
    )
    expect(s.reasons).toContain('oil_or_fat_not_visually_determinable')
    expect(s.questionIds).toContain('cooking_oil')
  })

  it('produces specific, correctable assumptions rather than vague ones', () => {
    const s = inferStructuralUncertainty(item({ canonical_food_key: 'chicken stir fry' }))
    // "Assumed ~1 tbsp cooking oil" is correctable. "Results may vary" is not.
    expect(s.assumptions.join(' ')).toMatch(/tbsp/)
    expect(s.assumptions.join(' ')).not.toMatch(/may vary/i)
  })

  it('flags unknown ABV for a poured drink', () => {
    const s = inferStructuralUncertainty(
      item({ is_beverage: true, beverage_category: 'alcoholic_poured_or_mixed', canonical_food_key: 'beer' }),
    )
    expect(s.reasons).toContain('abv_unknown')
    expect(s.assumptions.join(' ')).toMatch(/could easily be double/)
  })

  it('notes a missing scale reference for non-discrete food', () => {
    const s = inferStructuralUncertainty(
      item({ food_form: 'piled', visible_reference_objects: [] }),
    )
    expect(s.reasons).toContain('container_size_no_reference')
  })

  it('does not flag oil when oil is plainly visible — it is no longer an assumption', () => {
    const s = inferStructuralUncertainty(
      item({ canonical_food_key: 'chicken stir fry', cooking_method_cues: ['visible_oil_pooling'] }),
    )
    expect(s.reasons).not.toContain('oil_or_fat_not_visually_determinable')
  })
})

describe('answer memory is a frequency table, not machine learning', () => {
  it('goes silent on the 4th scan after three identical answers', () => {
    let m = recordAnswer(null, 'latte', 'milk_type', 'oat')
    expect(shouldApplySilently(m)).toBe(false)
    m = recordAnswer(m, 'latte', 'milk_type', 'oat')
    expect(shouldApplySilently(m)).toBe(false)
    m = recordAnswer(m, 'latte', 'milk_type', 'oat')
    expect(m.answerCount).toBe(REMEMBER_AFTER_ANSWERS)
    expect(shouldApplySilently(m)).toBe(true)
  })

  it('resets the count when the user changes their answer', () => {
    let m = recordAnswer(null, 'latte', 'milk_type', 'whole')
    m = recordAnswer(m, 'latte', 'milk_type', 'whole')
    m = recordAnswer(m, 'latte', 'milk_type', 'whole')
    expect(shouldApplySilently(m)).toBe(true)
    // Switching to oat is a changed habit; three old answers must not outvote it.
    m = recordAnswer(m, 'latte', 'milk_type', 'oat')
    expect(m.value).toBe('oat')
    expect(m.answerCount).toBe(1)
    expect(shouldApplySilently(m)).toBe(false)
  })

  it('stops asking a question the user has already settled', () => {
    const remembered = new Map([['cooking_oil', 'little']])
    const qs = selectQuestions({ item: stirFry, rememberedAnswers: remembered })
    expect(qs.some((q) => q.question.id === 'cooking_oil')).toBe(false)
  })
})

describe('the gram-disagreement question', () => {
  it('renders both real numbers rather than a placeholder', () => {
    const qs = selectQuestions({ item: stirFry, gramDisagreement: { low: 140, high: 220 } })
    const q = qs.find((x) => x.question.id === 'gram_disagreement')
    expect(q?.text).toContain('140')
    expect(q?.text).toContain('220')
    expect(q?.text).not.toContain('{')
  })

  it('does not appear when the signals agreed', () => {
    const qs = selectQuestions({ item: stirFry })
    expect(qs.some((q) => q.question.id === 'gram_disagreement')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Scene-aware triggers (schema 1.1 / prompt v1.2)
// ---------------------------------------------------------------------------

const pizza = item({
  name: 'Pizza Margherita',
  canonical_food_key: 'pizza, cheese, baked',
  food_form: 'flat',
  qualitative_size: 'medium',
  model_gram_estimate: 450,
  portion_confidence: 0.3,
})

describe('whole_dish_size — a whole unscaled pizza is not automatically 500 g', () => {
  it('fires for a flat whole dish with no label to override the guess', () => {
    const qs = selectQuestions({ item: pizza })
    const size = qs.find((q) => q.question.id === 'whole_dish_size')
    expect(size).toBeDefined()
    expect(size?.state).toBe('highlighted')
  })

  it('renders the dish name so the copy reads naturally', () => {
    const qs = selectQuestions({ item: pizza })
    const size = qs.find((q) => q.question.id === 'whole_dish_size')
    expect(size?.text).toBe('How large was the pizza margherita?')
    expect(size?.text).not.toContain('{')
  })

  it('does not fire when a legible label already owns the number', () => {
    const labeled = isWholeDishItem(item({ ...pizza, legible_label_text: 'Per serving 300 g' }))
    expect(labeled).toBe(false)
  })

  it('does not fire for foods whose size is not diameter-bound', () => {
    expect(isWholeDishItem(item())).toBe(false)
  })

  it('maps diameter answers through AREA scaling, never linear scaling', () => {
    // πr²: a 12" pizza holds (12/10)² = 1.44× a 10" pizza, not 1.2×.
    expect(wholeDishSizeMultiplier('10in')).toBe(1.0)
    expect(wholeDishSizeMultiplier('12in')).toBeCloseTo(1.44, 5)
    expect(wholeDishSizeMultiplier('14in')).toBeCloseTo(1.96, 5)
    expect(wholeDishSizeMultiplier('16in')).toBeCloseTo(2.56, 5)
  })

  it('refuses to invent a multiplier for "I know the weight" — the user will type grams', () => {
    expect(wholeDishSizeMultiplier('know_weight')).toBeNull()
  })
})

describe('thali_scope — the meal-portion question in a thali eater\u2019s own vocabulary', () => {
  const dal = item({
    name: 'Dal',
    canonical_food_key: 'dal, cooked',
    food_form: 'liquid',
    qualitative_size: 'medium',
  })

  it('replaces portion_eaten when the scene is a thali', () => {
    const qs = selectQuestions({ item: dal, scene: { mealType: 'indian_thali' } })
    expect(qs.some((q) => q.question.id === 'portion_eaten')).toBe(false)
    const scope = qs.find((q) => q.question.id === 'thali_scope')
    expect(scope).toBeDefined()
    expect(scope?.state).toBe('highlighted')
    expect(scope?.question.options.map((o) => o.label)).toEqual([
      'Whole', 'About ¾', 'About ½', 'About ¼', "I'll select items",
    ])
  })

  it('triggers for mixed_plate and buffet too', () => {
    for (const mealType of ['mixed_plate', 'buffet']) {
      const qs = selectQuestions({ item: dal, scene: { mealType } })
      expect(qs.some((q) => q.question.id === 'thali_scope')).toBe(true)
      expect(qs.some((q) => q.question.id === 'portion_eaten')).toBe(false)
    }
  })

  it('keeps the ordinary portion question for composite dishes — one hand-held portion', () => {
    const qs = selectQuestions({ item: dal, scene: { mealType: 'composite_dish' } })
    expect(qs.some((q) => q.question.id === 'thali_scope')).toBe(false)
    expect(qs.some((q) => q.question.id === 'portion_eaten')).toBe(true)
  })

  it('asks nothing scene-specific when there is no scene', () => {
    const qs = selectQuestions({ item: dal })
    expect(qs.some((q) => q.question.id === 'thali_scope')).toBe(false)
    expect(qs.some((q) => q.question.id === 'portion_eaten')).toBe(true)
  })

  it('fires ONCE per meal no matter how many bowls carry the scene', () => {
    const qs = selectMealQuestions([
      { item: dal, scene: { mealType: 'indian_thali' } },
      { item: { ...dal, name: 'Rice', canonical_food_key: 'rice, white, cooked' }, scene: { mealType: 'indian_thali' } },
      { item: { ...dal, name: 'Paneer', canonical_food_key: 'paneer, curry' }, scene: { mealType: 'indian_thali' } },
    ])
    expect(qs.filter((q) => q.question.id === 'thali_scope')).toHaveLength(1)
    // And the meal-level cap still holds with the scene question in play.
    expect(qs.filter((q) => q.state === 'highlighted').length).toBeLessThanOrEqual(MAX_QUESTIONS)
  })
})

describe('count_question — when the model\u2019s own count is not trustworthy', () => {
  const samosas = item({
    name: 'Samosas',
    canonical_food_key: 'samosa, fried',
    food_form: 'discrete',
    qualitative_size: 'count:3',
    portion_confidence: 0.4,
  })

  it('fires for a shaky count and renders the item name', () => {
    const qs = selectQuestions({ item: samosas })
    const count = qs.find((q) => q.question.id === 'count_question')
    expect(count).toBeDefined()
    expect(count?.state).toBe('highlighted')
    expect(count?.text).toBe('How many Samosas did you eat?')
  })

  it('stays silent when the model trusts its count', () => {
    expect(isCountAmbiguous(item({ ...samosas, portion_confidence: 0.9 }))).toBe(false)
    expect(selectQuestions({ item: { ...samosas, portion_confidence: 0.9 } }).some((q) => q.question.id === 'count_question')).toBe(false)
  })

  it('maps answers to M/N grams multipliers against the counted baseline', () => {
    // The estimate assumed 3; the user ate 2 -> 2/3 of the grams.
    expect(countAnswerMultiplier('count:3', 2)).toBeCloseTo(2 / 3, 5)
    // The estimate assumed 2; the user ate 4 -> double.
    expect(countAnswerMultiplier('count:2', 4)).toBe(2)
    // 4+ maps to 4 — the minimum the user asserted, never an invented midpoint.
    expect(countAnswerMultiplier('count:4', 4)).toBe(1)
    // A non-count item has no baseline to scale against.
    expect(countAnswerMultiplier('medium', 2)).toBeNull()
  })
})
