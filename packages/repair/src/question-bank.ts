import type { Item, UncertaintyReason } from '@nutai/core-schema'

/**
 * The ranked question bank.
 *
 * SPEC-accuracy-engine.md §8.4. Ordered by (a) swing magnitude, (b) how invisible
 * the ambiguity is in a photo, and (c) how cheaply and CERTAINLY asking resolves
 * it.
 *
 * Ranks 1-2 top the list because they are multiplicative AND fully resolvable with
 * certainty — they are factual questions, not perceptual ones. Rank 3 is third
 * because hidden oil is the single most over-determined complaint in the entire
 * research corpus: five independent sources converging near-verbatim.
 *
 * Ranks 12-14 extend ranks 1-2's multiplicative class with the scene-aware scan
 * contract (schema 1.1): whole-dish size, thali scope and countable-portion
 * questions. Their rank numbers are bank documentation only — selection order is
 * the `multiplicative` flag plus expected value, never this integer.
 *
 * THE BANK-WIDE RULE: every silent default is disclosed inline on the result card,
 * never hidden. That satisfies "ask when unsure" and "minimize the cost of poor
 * guesses" simultaneously, by making every guess auditable and one-tap correctable
 * even when we chose not to interrupt for it.
 *
 * Swing magnitudes are standard USDA-consistent nutrition science (fat 9 kcal/g,
 * carb 4, protein 4, alcohol 7). The exact per-100 g values used to APPLY an answer
 * must come from the actual bundled FDC rows at runtime, never from the
 * illustrative figures here.
 */

export interface QuestionOption {
  label: string
  /** Opaque value handed back to the applier. */
  value: string
}

export interface BankQuestion {
  rank: number
  id: string
  text: string
  /** Midpoint expected calorie swing when the assumption is wrong. */
  expectedSwingKcal: number
  /** True for ranks 1-2, whose swing is multiplicative rather than additive. */
  multiplicative: boolean
  options: QuestionOption[]
  /** Applied silently when the question does not clear the threshold. */
  silentDefault: string
  /** Shown inline on the card. ALWAYS rendered, never hidden. */
  defaultDisclosure: string
  /** Uncertainty reasons that make this question applicable. */
  reasons: UncertaintyReason[]
}

export const QUESTION_BANK: readonly BankQuestion[] = [
  {
    rank: 1,
    id: 'portion_eaten',
    text: 'Did you eat all of this, or some of it?',
    expectedSwingKcal: 300,
    multiplicative: true,
    options: [
      { label: 'All of it', value: '1.0' },
      { label: 'About half', value: '0.5' },
      { label: 'A little', value: '0.25' },
    ],
    silentDefault: '1.0',
    defaultDisclosure: 'Assuming you ate all of it',
    reasons: ['none'],
  },
  {
    rank: 2,
    id: 'servings_consumed',
    text: 'This looks like a multi-serving package — how much did you have?',
    expectedSwingKcal: 400,
    multiplicative: true,
    options: [
      { label: 'Whole package', value: 'all' },
      { label: '1 serving', value: '1' },
    ],
    // Never silently default to one serving without saying so — a 20 oz soda is
    // 2.5 servings, and quietly logging one is a 150% undercount.
    silentDefault: '1',
    defaultDisclosure: 'Assuming 1 serving — tap to change',
    reasons: ['serving_count_ambiguous'],
  },
  {
    rank: 3,
    id: 'cooking_oil',
    text: 'Was this cooked with oil or butter?',
    // ~120 kcal per tbsp of any cooking oil; home stir-fries commonly use 1-4.
    expectedSwingKcal: 240,
    multiplicative: false,
    options: [
      { label: 'None visible', value: 'none' },
      { label: 'A little (~1 tsp–1 tbsp)', value: 'little' },
      { label: 'A lot (2+ tbsp)', value: 'lots' },
    ],
    silentDefault: 'little',
    defaultDisclosure: 'Assumed ~1 tbsp oil — typical for this dish',
    reasons: ['oil_or_fat_not_visually_determinable'],
  },
  {
    rank: 4,
    id: 'sauce_type',
    text: 'What kind of dressing or sauce, and how much?',
    expectedSwingKcal: 200,
    multiplicative: false,
    options: [
      { label: 'Light', value: 'light' },
      { label: 'Medium', value: 'medium' },
      { label: 'Heavy', value: 'heavy' },
    ],
    silentDefault: 'medium',
    defaultDisclosure: 'Assumed a medium amount of the most common sauce',
    reasons: ['sauce_type_ambiguous'],
  },
  {
    rank: 5,
    id: 'milk_type',
    text: 'What kind of milk?',
    // whole ~149 / skim ~83 / oat ~120 / unsweetened almond ~30-40 per cup.
    expectedSwingKcal: 110,
    multiplicative: false,
    options: [
      { label: 'Whole', value: 'whole' },
      { label: '2%', value: '2pct' },
      { label: 'Skim', value: 'skim' },
      { label: 'Oat', value: 'oat' },
      { label: 'Almond', value: 'almond' },
      { label: 'Soy', value: 'soy' },
    ],
    silentDefault: 'whole',
    defaultDisclosure: 'Assumed whole milk',
    reasons: ['milk_type_ambiguous'],
  },
  {
    rank: 6,
    id: 'regular_or_diet',
    text: 'Regular or diet?',
    // Regular 12 oz ~140-150 vs diet ~0-5. The visual is identical.
    expectedSwingKcal: 145,
    multiplicative: false,
    options: [
      { label: 'Regular', value: 'regular' },
      { label: 'Diet / zero', value: 'diet' },
    ],
    // Deliberately the HIGHER-risk direction: silently assuming zero-calorie
    // undercounts, and undercounting is the failure users cannot detect.
    silentDefault: 'regular',
    defaultDisclosure: 'Assumed regular, not diet',
    reasons: ['identity_ambiguous'],
  },
  {
    rank: 7,
    id: 'meat_fat_pct',
    text: 'Lean or regular, and what cut?',
    // 85/15 ground beef 4 oz cooked ~287 vs 93/7 ~193.
    expectedSwingKcal: 95,
    multiplicative: false,
    options: [
      { label: '80/20', value: '80_20' },
      { label: '85/15', value: '85_15' },
      { label: '90/10', value: '90_10' },
      { label: '93/7', value: '93_7' },
    ],
    silentDefault: '85_15',
    defaultDisclosure: 'Assumed 85/15, the most commonly sold',
    reasons: ['meat_fat_percent_ambiguous'],
  },
  {
    rank: 8,
    id: 'raw_or_cooked',
    text: 'Is that weight before or after cooking?',
    // Chicken breast ~120 kcal/100g raw vs ~165 cooked. Same chicken, water loss.
    expectedSwingKcal: 80,
    multiplicative: false,
    options: [
      { label: 'Raw weight', value: 'raw' },
      { label: 'Cooked weight', value: 'cooked' },
    ],
    silentDefault: 'cooked',
    defaultDisclosure: 'Assumed cooked weight',
    reasons: ['cooked_vs_raw_ambiguous'],
  },
  {
    rank: 9,
    id: 'gram_disagreement',
    text: 'Does this look more like {low} g or {high} g?',
    expectedSwingKcal: 250,
    multiplicative: false,
    options: [],
    silentDefault: 'higher_weighted',
    defaultDisclosure: 'Used the more reliable of two estimates',
    reasons: ['portion_depth_not_visible', 'container_size_no_reference'],
  },
  {
    rank: 10,
    id: 'alcohol_abv',
    text: 'What is this, and roughly what ABV — or what brand and size?',
    // A 12 oz "beer" spans 4.2%-10% ABV: ~2.4x the alcohol.
    expectedSwingKcal: 200,
    multiplicative: false,
    options: [
      { label: 'Light beer', value: 'light_beer' },
      { label: 'Regular beer', value: 'regular_beer' },
      { label: 'Craft (~7–10%)', value: 'craft_beer' },
      { label: 'Wine', value: 'wine' },
      { label: 'Cocktail', value: 'cocktail' },
      { label: 'Spirit, neat', value: 'spirit' },
    ],
    silentDefault: 'regular_beer',
    defaultDisclosure: 'Assumed 5% ABV at a standard pour — could easily be double',
    reasons: ['abv_unknown'],
  },
  {
    rank: 11,
    id: 'shake_recipe',
    text: 'What’s blended in — milk, water, or an alternative, and any add-ins?',
    expectedSwingKcal: 300,
    multiplicative: false,
    options: [
      { label: 'Water', value: 'water' },
      { label: 'Milk', value: 'milk' },
      { label: 'Milk alternative', value: 'alt_milk' },
    ],
    // The LOWER estimate deliberately: over-assuming add-ins is more annoying to
    // correct than under-assuming, and the exact builder is one tap away.
    silentDefault: 'water',
    defaultDisclosure: 'Assumed a water base with no add-ins',
    reasons: ['shake_recipe_unknown'],
  },
  {
    // Co-rank-1 with portion_eaten: it IS the meal-portion question for multi-bowl
    // scenes, with copy that matches how a thali eater actually reasons. The two
    // never fire for the same scan — a thali-like scene suppresses portion_eaten
    // (see selectQuestions), so the meal gets one portion chip, not two.
    rank: 12,
    id: 'thali_scope',
    text: 'Did you eat the whole platter?',
    // A mixed platter runs ~800-1,200 kcal; whole vs half is the same class of
    // swing as portion_eaten on a large meal, rounded generously.
    expectedSwingKcal: 400,
    multiplicative: true,
    options: [
      { label: 'Whole', value: '1.0' },
      { label: 'About ¾', value: '0.75' },
      { label: 'About ½', value: '0.5' },
      { label: 'About ¼', value: '0.25' },
      // Applied as 0.5 with a visible disclosure: the user is heading into
      // per-item edits, so the assumption is the middle value — never zero,
      // because "I'll select items" still means SOME of it was eaten.
      { label: "I'll select items", value: 'select_items' },
    ],
    silentDefault: '1.0',
    defaultDisclosure: 'Assuming you ate the whole platter',
    reasons: ['none'],
  },
  {
    rank: 13,
    id: 'whole_dish_size',
    // {name} is filled with the item's name at render time (same mechanism as
    // gram_disagreement's {low}/{high}), so a pizza reads "How large was the
    // pizza?" per the scene contract's worked example.
    text: 'How large was the {name}?',
    // A whole unscaled pizza spans ~250 g (10") to ~700 g+ (16"); at ~2.7
    // kcal/g of cheese-dough-fats, the ends differ by well over 1,000 kcal —
    // but a CENTRAL misread (12" guessed as 14") lands near this swing.
    expectedSwingKcal: 300,
    multiplicative: true,
    options: [
      { label: '10"', value: '10in' },
      { label: '12"', value: '12in' },
      { label: '14"', value: '14in' },
      { label: '16"', value: '16in' },
      { label: 'I know the weight', value: 'know_weight' },
    ],
    // The neutral default keeps the model's estimate untouched (multiplier 1.0,
    // the 10" baseline) — we never silently RESCALE a dish, we only disclose.
    silentDefault: '10in',
    defaultDisclosure: 'Assumed the estimate fits a 10" base — tap to rescale',
    reasons: ['container_size_no_reference'],
  },
  {
    rank: 14,
    id: 'count_question',
    // {name} filled at render time. Fires only when the model counted (count:N)
    // but its own portion_confidence says the count is shaky.
    text: 'How many {name}s did you eat?',
    // Typical fried/baked snack unit ~100-150 kcal; being off by one is this
    // swing. Counting is the model's most reliable skill, so this only fires
    // when the model itself flagged low portion confidence.
    expectedSwingKcal: 120,
    multiplicative: true,
    options: [
      { label: '1', value: '1' },
      { label: '2', value: '2' },
      { label: '3', value: '3' },
      { label: '4+', value: '4plus' },
    ],
    silentDefault: 'as_counted',
    defaultDisclosure: 'Used the counted amount',
    reasons: ['serving_count_ambiguous'],
  },
  {
    // Rank 15 (schema v1.3): the MEAL-level hidden-cooking-fat question. The
    // rank-3 cooking_oil chip asks whether fat was involved at all; this one
    // rescales an assumption that ALREADY exists — the absorbed-oil row the
    // gram engine (or the model's own preparation disclosure) put on the meal.
    // That is why it is multiplicative: 'moderate' is the estimate as landed,
    // and the other answers REPLACE the level rather than add grams to it.
    rank: 15,
    id: 'added_fat',
    text: 'How much oil/ghee was likely used in cooking this meal?',
    // Home cooking fat is the single most over-determined complaint in the
    // research corpus; one level of the ladder (light ↔ heavy) is worth well
    // over 200 kcal on a real meal. Rounded down from cooking_oil's 240
    // because the assumption this rescales already exists — the swing is the
    // RESCALING error, not the whole hidden fat.
    expectedSwingKcal: 180,
    multiplicative: true,
    options: [
      { label: 'None', value: 'none' },
      { label: 'Light', value: 'light' },
      { label: 'Moderate', value: 'moderate' },
      { label: 'Heavy', value: 'heavy' },
    ],
    // The neutral default keeps the landed assumption untouched (multiplier
    // 1.0) — we never silently RESCALE a disclosed amount, we only disclose.
    silentDefault: 'moderate',
    defaultDisclosure: 'Assumed a moderate amount of cooking fat — tap to rescale',
    // Explicit-trigger question like thali_scope: applicability is decided by
    // the meal's hidden-fat signal (see selectQuestions), not by reason match.
    reasons: ['none'],
  },
]

/**
 * Scene types where the meal is MANY dishes at once. The result screen titles
 * these from the scene's own display_name ("Indian mixed thali"), never from
 * items[0], and the repair layer asks the scene-level scope question instead of
 * the per-item portion question.
 */
export const MULTI_COMPONENT_SCENE_TYPES: ReadonlySet<string> = new Set([
  'mixed_plate',
  'indian_thali',
  'buffet',
  'composite_dish',
])

/**
 * The narrower set that triggers thali_scope: communal platters where "did you
 * eat the whole platter?" is the natural portion question. composite_dish (a
 * burger, a wrap) is multi-component for the TITLE but keeps the ordinary
 * portion_eaten question, because a composite is one hand-held portion.
 */
export const THALI_LIKE_SCENE_TYPES: ReadonlySet<string> = new Set([
  'indian_thali',
  'mixed_plate',
  'buffet',
])

export function isThaliLikeScene(mealType: string | null | undefined): boolean {
  return mealType != null && THALI_LIKE_SCENE_TYPES.has(mealType)
}

/** Whole dishes whose size the camera cannot see: diameter, not depth. */
export const WHOLE_DISH_ITEM = /\b(pizza|cake|pie|tart|quiche|watermelon)\b/i

const COUNT_SIZE = /^count:(\d+(?:\.\d+)?)$/

/**
 * The whole_dish_size trigger: a named whole dish whose mass hinges on an
 * unseen diameter, with no printed label to override the guess. Flat forms
 * (pizza, quiche) and counted wholes (one cake) both qualify; a legible label
 * means Tier-0 arithmetic already owns the number and no question is asked.
 */
export function isWholeDishItem(item: Item): boolean {
  if (item.legible_label_text != null) return false
  if (!WHOLE_DISH_ITEM.test(item.name)) return false
  return item.food_form === 'flat' || COUNT_SIZE.test(item.qualitative_size)
}

/**
 * The count_question trigger: the model counted (count:N) but its own
 * portion_confidence says the count is shaky. Counting is reliable; when the
 * model does not trust its own count, nobody should.
 */
export function isCountAmbiguous(item: Item): boolean {
  return COUNT_SIZE.test(item.qualitative_size) && item.portion_confidence < 0.6
}

/**
 * Area scaling for whole_dish_size answers, with the 10" option as the 1.0
 * baseline the model's estimate is presumed to describe. Pie area is πr², so a
 * 12" pizza holds (12/10)² = 1.44× a 10" pizza's mass — NOT 1.2×. These are
 * multipliers on the item's estimated grams; the per-gram nutrition stays
 * whatever the resolved database row says (deterministic code owns numbers).
 */
export const WHOLE_DISH_SIZE_MULTIPLIERS: Readonly<Record<string, number>> = {
  '10in': 1.0,
  '12in': 1.44,
  '14in': 1.96,
  '16in': 2.56,
}

/**
 * The grams multiplier for a whole_dish_size answer. 'know_weight' (the user
 * will type grams) and any unknown value map to null — never to a guessed 1.0,
 * because "unknown how to apply" and "keep the estimate" are different answers.
 */
export function wholeDishSizeMultiplier(optionValue: string): number | null {
  return WHOLE_DISH_SIZE_MULTIPLIERS[optionValue] ?? null
}

/**
 * The grams multiplier for a count_question answer: the user ate M of the N
 * units the estimate assumed, so grams scale by M/N. '4plus' is passed as 4 —
 * the minimum the user asserted, never an invented midpoint. Returns null when
 * the item's size is not a count (nothing to scale against).
 */
export function countAnswerMultiplier(qualitativeSize: string, answerCount: number): number | null {
  const n = COUNT_SIZE.exec(qualitativeSize)
  if (n == null || answerCount <= 0) return null
  return answerCount / Number(n[1])
}

/**
 * The added_fat answer table (schema v1.3), applied to the meal's hidden-fat /
 * absorbed-oil assumption grams. The 1.0 reference is the MODERATE level: the
 * amount the scan's assumption already represents.
 *
 *   none     0.0  the user says no cooking fat — the assumption's grams go to
 *                 zero (the row stays, at 0 g, so a later answer can restore
 *                 it; a removed row could not)
 *   light    0.6  a Light answer trims the landed assumption to ~60%
 *   moderate 1.0  keeps the estimate as landed
 *   heavy    1.6  heavy home cooking (the classic unrestricted tadka/frying)
 *
 * The SAME table scales the pipeline's disclosed-fat synthesis
 * (packages/pipeline): a 'heavy' preparation disclosure lands a row at base ×
 * 1.6, so a user confirming 'heavy' on that row is a no-op, not a compounding
 * 2.56×. One table, two consumers, one definition of a "level".
 */
export const ADDED_FAT_MULTIPLIERS: Readonly<Record<string, number>> = {
  none: 0.0,
  light: 0.6,
  moderate: 1.0,
  heavy: 1.6,
}

/**
 * The grams multiplier for an added_fat answer. Any value outside the table
 * maps to null — never to a guessed 1.0, because "unknown how to apply" and
 * "keep the estimate" are different answers. ('none' is a real multiplier: 0.)
 */
export function addedFatMultiplier(optionValue: string): number | null {
  const m = ADDED_FAT_MULTIPLIERS[optionValue]
  return typeof m === 'number' ? m : null
}

/**
 * The meal-level hidden-fat signal the pipeline computes for the added_fat
 * trigger: the strongest disclosed `preparation.added_cooking_fat` level
 * across the meal's items ('none' when nothing was disclosed) plus whether a
 * hidden-fat row (absorbed-oil assumption) exists at all.
 */
export interface AddedFatSignal {
  level: 'none' | 'unknown' | 'light' | 'moderate' | 'heavy'
  hasHiddenFatRow: boolean
}

/**
 * The added_fat trigger: a DISCLOSED uncertain level (the model said fat was
 * used but could not pin it — anything except a clean 'none') OR an existing
 * hidden-fat row to rescale. A meal where every row discloses 'none' and no
 * absorbed-oil row exists has no hidden fat to ask about.
 */
export function isAddedFatTriggered(signal: AddedFatSignal | null | undefined): boolean {
  if (signal == null) return false
  if (signal.hasHiddenFatRow) return true
  return signal.level === 'unknown' || signal.level === 'light' || signal.level === 'moderate' || signal.level === 'heavy'
}

export function questionByReason(reason: UncertaintyReason): BankQuestion | null {
  return QUESTION_BANK.find((q) => q.reasons.includes(reason)) ?? null
}

/** Categories whose oil use is high-variance regardless of model confidence. */
export const HIGH_OIL_VARIANCE = /\b(stir.?fry|saute|sautee|fried rice|curry|scrambled|omelet|hash|roast)\b/

/** Categories where sauce type is ambiguous by construction. */
export const SAUCE_AMBIGUOUS = /\b(salad|pasta|noodle|wings|bowl|burrito|sandwich|wrap)\b/

export interface StructuralUncertainty {
  reasons: UncertaintyReason[]
  assumptions: string[]
  questionIds: string[]
}

/**
 * Derive uncertainty from the FOOD CATEGORY alone, with no model self-report.
 *
 * SPEC-accuracy-engine.md §7.3. This module is what makes Path B possible at all —
 * an on-device classifier cannot emit stated_assumptions, clarifying_questions or
 * uncertainty_reason, so on Path B this is the SOLE source of those fields.
 *
 * On Path A it is a FLOOR, applied as a UNION and never a replacement: if the model
 * failed to flag oil on a stir-fry, we flag it anyway. The model not mentioning
 * something is not evidence that it is not there.
 */
export function inferStructuralUncertainty(item: Item): StructuralUncertainty {
  const out: StructuralUncertainty = { reasons: [], assumptions: [], questionIds: [] }
  const key = item.canonical_food_key.toLowerCase()

  if (HIGH_OIL_VARIANCE.test(key) && !item.cooking_method_cues.includes('visible_oil_pooling')) {
    out.reasons.push('oil_or_fat_not_visually_determinable')
    out.assumptions.push('Assumed ~1 tbsp cooking oil — typical for this dish, not visible once cooked.')
    out.questionIds.push('cooking_oil')
  }

  if (SAUCE_AMBIGUOUS.test(key)) {
    out.reasons.push('sauce_type_ambiguous')
    out.assumptions.push('Assumed a medium amount of the most common sauce for this dish.')
    out.questionIds.push('sauce_type')
  }

  if (item.beverage_category === 'alcoholic_poured_or_mixed') {
    out.reasons.push('abv_unknown')
    out.assumptions.push('Assumed 5% ABV at a standard pour — this could easily be double.')
    out.questionIds.push('alcohol_abv')
  }

  if (item.beverage_category === 'blended_shake_or_smoothie') {
    out.reasons.push('shake_recipe_unknown')
    out.assumptions.push('Assumed a water base with no add-ins.')
    out.questionIds.push('shake_recipe')
  }

  if (item.visible_reference_objects.length === 0 && item.food_form !== 'discrete') {
    out.reasons.push('container_size_no_reference')
  }

  return out
}
