import { z } from 'zod'

/**
 * VisionPayload — the ONLY thing an inference model is allowed to return.
 *
 * SPEC-accuracy-engine.md §3.1–3.2. One canonical schema, three emitted provider
 * shapes, one client-side validator that runs for all of them.
 *
 * The governing rule (PLAN.md D16) is visible in the shape of this type:
 *
 *   The model is a perception device. It never owns a number the user sees.
 *
 * It reports what it can actually see — identity, form, relative size, reference
 * objects, cooking cues, legible text, and what it could NOT determine. Grams are
 * computed downstream by @nutai/gram-engine. Nutrition comes from a database row
 * via @nutai/resolver. Totals are arithmetic in @nutai/totals. Confidence comes
 * from measured per-category error in @nutai/confidence.
 *
 * Two deliberate omissions carry most of the weight:
 *
 * 1. There is NO `meal_totals` field. Not "present but ignored" — absent. A field
 *    we always discard is paid output tokens plus a standing temptation to render
 *    it. Its absence is what makes a macro-reconciliation mismatch unreachable
 *    rather than merely guarded against.
 *
 * 2. The mass field is `model_gram_estimate`, not `estimated_grams`. It sits at
 *    rank 5 of 6 in the reconciliation ladder. A field named `estimated_grams`
 *    invites a developer to display it; this one does not.
 */

/**
 * 1.1.0 (scene-aware scan contract): adds the optional scene block, per-item
 * `visibility` and per-item `model_gram_range`. The bump is SAFE for stored data:
 * the only migration version that ever gates stored-data imports is
 * USER_SCHEMA_VERSION in @nutai/db-adapter (a number, unrelated). A payload's
 * schema_version string is inert scan-time metadata on LoggedMeal for eval
 * attribution — nothing branches on its value — and @nutai/pipeline's repair
 * layer re-stamps old '1.0.0' answers before validation, which keeps accepting
 * them because every field this version adds is OPTIONAL.
 */
export const SCHEMA_VERSION = '1.1.0' as const

/** Physical form. Selects which volume heuristic the gram engine applies. */
export const FoodFormZ = z.enum(['discrete', 'flat', 'piled', 'liquid', 'wrapped', 'spread'])
export type FoodForm = z.infer<typeof FoodFormZ>

/** Which state the gram estimate refers to. Drives yield-factor correction. */
export const WeightBasisZ = z.enum(['cooked', 'raw', 'as_served'])
export type WeightBasis = z.infer<typeof WeightBasisZ>

/**
 * The dominant reason an item is uncertain. This is the join key between the
 * model's uncertainty and the app's clarifying-question bank — which is why it is
 * a closed enum and not free text. A new reason requires a new question.
 */
export const UncertaintyReasonZ = z.enum([
  'oil_or_fat_not_visually_determinable',
  'sauce_type_ambiguous',
  'milk_type_ambiguous',
  'meat_fat_percent_ambiguous',
  'cooked_vs_raw_ambiguous',
  'container_size_no_reference',
  'serving_count_ambiguous',
  'portion_depth_not_visible',
  'identity_ambiguous',
  'partially_occluded',
  'abv_unknown',
  'shake_recipe_unknown',
  'none',
])
export type UncertaintyReason = z.infer<typeof UncertaintyReasonZ>

/** Scale anchors. Downstream code weights each type by its known size variance. */
export const ReferenceObjectTypeZ = z.enum([
  'credit_card',
  'drink_can_12oz',
  'dinner_plate',
  'salad_plate',
  'soup_plate',
  'bread_plate',
  'dessert_plate',
  'cereal_bowl',
  'mug',
  'drinking_glass',
  'fork',
  'spoon',
  'tablespoon',
  'chopsticks',
  'hand',
  'smartphone',
  'coin',
  'none',
])
export type ReferenceObjectType = z.infer<typeof ReferenceObjectTypeZ>

export const ContainerTypeZ = z.enum([
  'cereal_bowl',
  'soup_plate',
  'mug',
  'drinking_glass',
  'wine_glass',
  'pint_glass',
  'takeout_container',
  'other',
])
export type ContainerType = z.infer<typeof ContainerTypeZ>

/** Visual EVIDENCE only, never inference. Selects yields, triggers oil correction. */
export const CookingCueZ = z.enum([
  'grill_marks',
  'char',
  'visible_oil_sheen',
  'visible_oil_pooling',
  'batter_or_breading',
  'deep_fried_color',
  'steamed_no_browning',
  'boiled',
  'raw',
  'melted_cheese',
  'sauce_coating',
  'dry_surface',
  'none_visible',
])
export type CookingCue = z.infer<typeof CookingCueZ>

export const BeverageCategoryZ = z.enum([
  'alcoholic_packaged',
  'alcoholic_poured_or_mixed',
  'blended_shake_or_smoothie',
  'coffee_tea',
  'soda_juice_other',
  'milk_or_dairy_drink',
])
export type BeverageCategory = z.infer<typeof BeverageCategoryZ>

/**
 * The SCENE-level visibility of one item — how the model actually came to
 * include it. Three honest levels, because "I see rice" and "every thali
 * structurally has rice, though no bowl here is labelled" are different claims
 * that deserve different numbers downstream.
 *
 *   visible  — clearly seen in the photo.
 *   likely   — strongly implied by what is seen (sauce under toppings, a
 *              chutney's stain beside its bowl).
 *   inferred — structurally certain but hidden (oil in the gravy, butter on
 *              toast under the eggs).
 *
 * Optional so older payloads still validate; downstream code treats absence as
 * 'visible' — the historical default before this field existed.
 */
export const VisibilityZ = z.enum(['visible', 'likely', 'inferred'])
export type Visibility = z.infer<typeof VisibilityZ>

/**
 * The model's honest mass RANGE for an item, when the photo supports one, and
 * null when it cannot responsibly bound it. Sits ALONGSIDE
 * model_gram_estimate — never instead of it: the estimate stays the single
 * best point estimate the reconciliation ladder consumes, while the range is
 * honesty made structural. A whole unscaled pizza shot from above is exactly
 * the case this exists for; a fake-precise "500 g" with no range is the
 * failure mode this field makes impossible to hide.
 */
export const GramRangeZ = z
  .object({
    min_g: z.number().positive(),
    max_g: z.number().positive(),
  })
  .nullable()
export type GramRange = z.infer<typeof GramRangeZ>

/**
 * `small` | `medium` | `large` | `count:N`.
 *
 * Size words are relative to a normal single serving OF THIS SPECIFIC FOOD — a
 * "large" egg and a "large" pizza share no scale. `count:N` short-circuits volume
 * estimation entirely and is strongly preferred whenever the food is countable,
 * because counting is the one thing vision models do reliably.
 */
export const QualitativeSizeZ = z
  .string()
  .regex(
    /^(small|medium|large|count:\d+(\.\d+)?)$/,
    "qualitative_size must be 'small', 'medium', 'large', or 'count:N'",
  )

export const MacrosZ = z.object({
  calories_kcal: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  fiber_g: z.number().nullable(),
  sodium_mg: z.number().nullable(),
})
export type Macros = z.infer<typeof MacrosZ>

export const ReferenceObjectZ = z.object({
  type: ReferenceObjectTypeZ,
  /** [x, y, w, h], normalized 0–1 against the FIRST image. */
  bbox: z.array(z.number()).length(4),
  confidence: z.number().min(0).max(1),
})
export type ReferenceObject = z.infer<typeof ReferenceObjectZ>

export const ContainerZ = z.object({
  type: ContainerTypeZ,
  /**
   * 0–1, empty to rim. "How full is this" is answerable from a photo; absolute
   * container volume is not. The gram engine supplies the volume from priors.
   */
  fill_fraction: z.number().min(0).max(1),
})
export type Container = z.infer<typeof ContainerZ>

export const ItemZ = z.object({
  /** Human-readable, shown to the user directly. */
  name: z.string().min(1),
  /** Exact brand string only if legible in the photo. Never guessed. */
  brand: z.string().nullable(),
  /**
   * Generic lowercase comma-separated USDA-style search string, e.g.
   * 'chicken breast, grilled'. This is a query for @nutai/resolver, never a
   * database row and never decorative language.
   */
  canonical_food_key: z.string().min(1),
  food_form: FoodFormZ,
  qualitative_size: QualitativeSizeZ,
  weight_basis: WeightBasisZ,
  /**
   * The model's own best-guess mass. LOWEST-TRUST signal in the pipeline —
   * rank 5 of 6 in the reconciliation ladder. Used only when no deterministic
   * gram path exists.
   *
   * DELIBERATELY UNBOUNDED HERE, unlike the confidence fields below.
   *
   * A range check on this field belongs to @nutai/clamp, not to validation. If
   * Zod rejected an out-of-range mass, one absurd number on one item of a
   * five-item meal would fail the WHOLE payload and the user would get nothing
   * back from a scan they paid for. The clamp instead nulls the offending value
   * and lets the reconciliation ladder fall through to its other tiers — a
   * demotion, not a failure. Graceful degradation is the entire reason the clamp
   * exists, and it cannot do its job if validation rejects the input first.
   *
   * Structural violations still fail the payload. Value-range violations do not.
   */
  model_gram_estimate: z.number().finite().nullable(),
  /**
   * The model's honest min→max mass when the photo supports a range; null when
   * it cannot responsibly bound one. See GramRangeZ. The estimate above stays
   * the number the ladder consumes — this field is the HONESTY AROUND it, and
   * a model that cannot bound the mass should say so here instead of
   * pretending portion_confidence is high.
   */
  model_gram_range: GramRangeZ.optional(),
  /**
   * How the item earned its place in the output — seen, implied, or structurally
   * certain but hidden. Absent means 'visible' (the pre-1.1 default). Hidden
   * fat must be 'inferred' AND carry its own stated_assumptions entry.
   */
  visibility: VisibilityZ.optional(),
  identification_confidence: z.number().min(0).max(1),
  /**
   * Probability the mass estimate is within ~20% of truth. Reported SEPARATELY
   * from identification_confidence because they are different quantities and
   * conflating them is why "I know it's a burrito" gets read as "I know it's
   * 340 g". Both are modifiers only — see @nutai/confidence.
   */
  portion_confidence: z.number().min(0).max(1),
  uncertainty_reason: UncertaintyReasonZ,
  visible_reference_objects: z.array(ReferenceObjectZ),
  /** Set for anything in a bowl, cup, glass or mug. Null for plated food. */
  container: ContainerZ.nullable(),
  cooking_method_cues: z.array(CookingCueZ),
  is_beverage: z.boolean(),
  beverage_category: BeverageCategoryZ.nullable(),
  /** Verbatim transcription of any legible nutrition panel. Never interpreted here. */
  legible_label_text: z.string().nullable(),
  /**
   * Specific, single-variable, correctable assumptions. Every entry becomes a
   * one-tap correction chip, so a vague entry is worthless — "assumed olive oil"
   * is useful, "assumed standard preparation" is not.
   */
  stated_assumptions: z.array(z.string()),
  /** At most 2. Empty when nothing is genuinely ambiguous. */
  clarifying_questions: z.array(z.string()).max(2),
  /**
   * Macros AT model_gram_estimate — not per 100 g. The miss path only: used when
   * database resolution finds no acceptable match, in which case the item is
   * shown to the user explicitly tagged as an AI estimate.
   */
  fallback_macros_at_estimate: MacrosZ,
})
export type Item = z.infer<typeof ItemZ>

export const MealOverallZ = z.object({
  identification_confidence: z.number().min(0).max(1),
  /**
   * Generally no higher than the lowest per-item portion_confidence in a
   * multi-item meal, since errors compound rather than average.
   */
  portion_confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string()),
  /** Deduplicated from item-level questions, most-estimate-changing first. */
  clarifying_questions: z.array(z.string()),
})
export type MealOverall = z.infer<typeof MealOverallZ>

/**
 * The whole-frame meal identity — what a person would answer if asked "what is
 * this?" while looking at the photo, not at one bowl of it.
 *
 * WHY THIS EXISTS: before 1.1, the only meal-level identity a result screen
 * could render was `items[0].name`, which titled an eight-bowl Indian thali
 * "Chapati" and a Supreme pizza "Pizza dough". The scene is a DIFFERENT claim
 * from any item, so it gets its own field, its own confidence, and one
 * non-negotiable rule: for a multi-component scene the display_name names the
 * SCENE ('Indian mixed thali'), never one component.
 *
 * Optional in Zod so pre-1.1 payloads keep validating; the OpenAI strict wire
 * dialect marks every property required, which is fine because the 1.2 prompt
 * makes the model always emit it.
 */
export const SceneZ = z.object({
  /** The whole-frame class. Drives downstream question selection, not just UI. */
  meal_type: z.enum([
    'single_food',
    'single_dish',
    'composite_dish',
    'mixed_plate',
    'indian_thali',
    'buffet',
    'packaged_food',
    'nutrition_label',
    'barcode',
    'receipt',
    'unknown',
  ]),
  /**
   * The SCENE-level meal identity, e.g. 'Indian mixed thali' or 'Supreme
   * pizza'. NEVER one component's name for a multi-component scene.
   */
  display_name: z.string().min(1),
  /** Probability the scene call itself is right. Separate from item confidences. */
  confidence: z.number().min(0).max(1),
})
export type Scene = z.infer<typeof SceneZ>

export const VisionPayloadZ = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  is_food: z.boolean(),
  /** Short, polite, specific. Null when is_food is true. */
  refusal_reason: z.string().nullable(),
  /**
   * One entry per distinct food or drink component across ALL photos. The same
   * physical item seen from two angles is one entry, not two. For multi-bowl
   * scenes: one entry per distinct bowl, katori, dish or pile — a thali with
   * eight bowls has at least eight entries.
   */
  items: z.array(ItemZ),
  /** Whole-frame meal identity. Optional so pre-1.1 payloads still validate. */
  scene: SceneZ.optional(),
  meal_overall: MealOverallZ,
})
export type VisionPayload = z.infer<typeof VisionPayloadZ>
