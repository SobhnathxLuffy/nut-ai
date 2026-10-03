/**
 * Curated-dish ingredient breakdown — the app-side bridge between the corpus
 * recipe templates and what the user sees and edits.
 *
 * WHY THIS EXISTS: the corpus stores ingredient amounts as verified MASS
 * FRACTIONS of the raw batch ("ghee is 1-4% of the raw dough"), never as
 * grams. The dish composer used to read a nonexistent `amountPrior.grams`
 * field and fall back to a flat 50 g for EVERY slot — "50 g ghee" for a roti.
 * The honest per-serving grams come from the same arithmetic the
 * deterministic engine (packages/indian-dishes/src/totals.ts) performs:
 *
 *   raw batch for one serving = standardPortionGrams / verifiedNumericYield
 *   slot grams                = (mid(range) / SUM(mids)) x raw batch
 *
 * SUM(mids) may drift from 1.0 (water-rich families); the ratio keeps the
 * slot shares exact, so composer arithmetic equals search-row arithmetic.
 *
 * ZERO React Native imports — unit-testable under bare Node.
 */

export interface SlotLike {
  label: string
  role?: string
  required?: boolean
  amountPrior?: { range?: [number, number]; grams?: number; verified?: boolean } | null
  nutritionMapping?: { canonicalFoodId?: string | null; mappingStatus?: string } | null
}

export interface DishIngredientLine {
  label: string
  /** Human-readable slot name ("Tadka fat (optional)"), never snake_case. */
  display: string
  /** Grams per standard serving, derived from the verified fraction prior. */
  grams: number
  role: string
  foodId: string | null
  /** True when this slot is represented by the Cooking Fat / Oil selector instead of a row. */
  foldedIntoFat: boolean
}

/** COOKING_FAT_OPTIONS foodIds the fat selector can represent (see unknown-dish.ts). */
export const FAT_OPTION_BY_FOOD: Record<string, string> = {
  'ifct:T013': 'ghee-14g',
  'ifct:T006': 'mustard-oil-14g',
  'ifct:T012': 'sunflower-oil-14g',
  'ifct:T005': 'groundnut-oil-14g',
  'usda:173430': 'butter-14g',
  'usda:173410': 'butter-14g',
}

const HUMAN_LABELS: Record<string, string> = {
  added_fat: 'Cooking fat / oil',
  added_fat_optional: 'Cooking fat (optional)',
  added_fat_or_frying_oil: 'Frying oil',
  animal_protein: 'Meat / protein',
  aromatics: 'Onion / aromatics',
  aromatics_or_gravy: 'Onion-tomato base',
  base_milk_grain_nut_or_flour: 'Milk / grain / nut base',
  binding_or_batter: 'Besan binder',
  boiled_vegetables: 'Boiled vegetables',
  butter_or_ghee: 'Butter / ghee',
  cashew_optional: 'Cashew (optional)',
  chutney_optional: 'Chutney (optional)',
  cauliflower_filling: 'Cauliflower (stuffing)',
  chicken: 'Chicken',
  chilli: 'Chilli',
  condiments_optional: 'Condiments (optional)',
  cooked_chicken: 'Cooked chicken',
  cooking_oil: 'Cooking oil',
  cream_cashew_optional: 'Cream / cashew (optional)',
  cream_optional: 'Cream (optional)',
  crunch_topping_optional: 'Crunch topping (sev, optional)',
  curd_spices: 'Curd + spices',
  dairy_or_coconut_optional: 'Curd / coconut (optional)',
  dosa_batter: 'Dosa batter',
  egg: 'Egg',
  fenugreek_optional: 'Fenugreek (optional)',
  filling_or_topping: 'Filling / topping',
  flavour_base: 'Flavour base',
  flavouring: 'Spices / flavouring',
  fat_optional: 'Fat (ghee / oil, optional)',
  ghee_finishing_optional: 'Ghee finish (optional)',
  grain_flour: 'Grain flour',
  grain_or_semolina: 'Grain / semolina',
  gravy_base_optional: 'Gravy base (optional)',
  gravy_or_vegetable_base: 'Gravy / vegetable base',
  herbs: 'Herbs',
  methi_leaves: 'Fenugreek leaves (methi)',
  mix_ins_optional: 'Mix-ins (optional)',
  mutton: 'Mutton',
  mustard_oil_optional: 'Mustard oil (optional)',
  onion: 'Onion',
  onion_chilli_herbs: 'Onion, chilli, herbs',
  oil_or_ghee: 'Oil / ghee',
  paneer: 'Paneer',
  paneer_filling: 'Paneer (stuffing)',
  paratha_or_flatbread: 'Flatbread',
  potato_eggplant_tomato_mix: 'Potato + eggplant + tomato',
  potato_filling: 'Potato filling',
  primary_component: 'Main component',
  primary_vegetable: 'Main vegetable',
  pulse_optional: 'Dal (optional)',
  pulse_or_legume: 'Dal (pulse)',
  radish_filling: 'Radish (stuffing)',
  rice: 'Rice',
  rice_or_grain: 'Rice / grain',
  rice_or_idli_rava: 'Idli rava (rice)',
  roasted_bengal_gram_sattu: 'Roasted gram (sattu)',
  salt: 'Salt',
  sattu_filling: 'Roasted gram flour (sattu stuffing)',
  sauce_or_chutney_optional: 'Sauce / chutney (optional)',
  secondary_components: 'Side components',
  secondary_vegetable: 'Second vegetable',
  starch_or_wrapper: 'Dough / outer layer',
  sugar_optional: 'Sugar (optional)',
  sugar_or_jaggery: 'Sugar / jaggery',
  tadka_fat_optional: 'Tadka fat (optional)',
  tomato_onion_gravy: 'Tomato-onion gravy',
  urad_dal: 'Urad dal',
  water: 'Water',
  water_or_milk: 'Water or milk',
  whole_wheat_flour: 'Whole wheat flour',
  wrapper_cooking_oil: 'Oil (for wrapper)',
}

/** Human-readable slot name; snake_case codes never reach the UI. */
export function humanizeSlotLabel(label: string): string {
  const known = HUMAN_LABELS[label]
  if (known) return known
  const pretty = label.replace(/_/g, ' ').trim()
  return pretty.charAt(0).toUpperCase() + pretty.slice(1)
}

const mid = (range: [number, number]) => (range[0] + range[1]) / 2

/**
 * Fat slots whose mapped food the Cooking Fat / Oil selector can represent.
 * A slot maps to an optionId by its FOOD ID — two butter rows share one
 * option because they are nutritionally identical (717 kcal, 81 g fat).
 */
export function fatOptionIdForSlot(slot: SlotLike): string | null {
  const foodId = slot.nutritionMapping?.canonicalFoodId
  if (!foodId) return null
  return FAT_OPTION_BY_FOOD[foodId] ?? null
}

export interface SlotGramsInput {
  /** mid(range) / SUM(mids) — the slot's normalized share of the raw batch. */
  share: number
  standardPortionGrams: number
  verifiedNumericYield: number
}

/**
 * Per-serving grams for one slot — engine-identical (see totals.ts:
 * mid x 100 x portion / (SUM(mids) x 100 x yield)).
 */
export function slotServingGrams({ share, standardPortionGrams, verifiedNumericYield }: SlotGramsInput): number {
  if (!(standardPortionGrams > 0) || !(verifiedNumericYield > 0)) return 0
  return share * (standardPortionGrams / verifiedNumericYield)
}

export interface DishIngredientBreakdown {
  lines: DishIngredientLine[]
  /** The fat slot folded into the Cooking Fat / Oil selector, if any. */
  fatFold: { optionId: string; grams: number; label: string } | null
  standardPortionGrams: number | null
  verifiedNumericYield: number | null
}

export interface DishRowLike {
  recipe_template_json: string | null
  yield_model_json: string | null
  portion_model_json: string | null
  /** Corpus rows carry the uncertainty model column; household rows do not. */
  uncertainty_model_json?: string | null
}

/**
 * Build the full per-serving ingredient breakdown for a dish row.
 * `withFatFold` marks selector-representable fat slots so the composer can
 * skip rendering them as ingredient rows (the Cooking Fat / Oil chips replace
 * them — the previous double representation).
 */
export function dishIngredientBreakdown(row: DishRowLike, withFatFold = false): DishIngredientBreakdown {
  let template: { ingredientSlots?: SlotLike[] } = {}
  let yieldModel: { verifiedNumericYield?: number } = {}
  let portionModel: { standardPortionGrams?: number } = {}
  try { template = JSON.parse(row.recipe_template_json || '{}') } catch { /* unparseable → empty */ }
  try { yieldModel = JSON.parse(row.yield_model_json || '{}') } catch { /* ignore */ }
  try { portionModel = JSON.parse(row.portion_model_json || '{}') } catch { /* ignore */ }

  const slots = Array.isArray(template.ingredientSlots) ? template.ingredientSlots : []
  const yieldM = typeof yieldModel.verifiedNumericYield === 'number' && yieldModel.verifiedNumericYield > 0
    ? yieldModel.verifiedNumericYield
    : null
  const portion = typeof portionModel.standardPortionGrams === 'number' && portionModel.standardPortionGrams > 0
    ? portionModel.standardPortionGrams
    : null

  const mids = slots.map((slot) => {
    const range = slot.amountPrior?.range
    return Array.isArray(range) && range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])
      ? mid(range as [number, number])
      : null
  })
  const midSum = mids.reduce<number>((sum, value) => sum + (value ?? 0), 0)

  let fatFold: DishIngredientBreakdown['fatFold'] = null
  const lines: DishIngredientLine[] = []
  slots.forEach((slot, index) => {
    const share = mids[index] != null && midSum > 0 ? mids[index]! / midSum : 0
    const grams = slot.amountPrior?.grams != null && slot.amountPrior.grams > 0
      ? slot.amountPrior.grams // household-measured grams win over fractions
      : slotServingGrams({ share, standardPortionGrams: portion ?? 0, verifiedNumericYield: yieldM ?? 0 })
    const foldable = withFatFold && slot.role === 'fat_variable' && fatOptionIdForSlot(slot) !== null
    const optionId = foldable ? fatOptionIdForSlot(slot) : null
    if (foldable && optionId && grams > 0 && fatFold === null) {
      fatFold = { optionId, grams, label: humanizeSlotLabel(slot.label) }
    }
    lines.push({
      label: slot.label,
      display: humanizeSlotLabel(slot.label),
      grams: Math.round(grams * 10) / 10,
      role: slot.role ?? 'secondary',
      foodId: slot.nutritionMapping?.canonicalFoodId ?? null,
      foldedIntoFat: Boolean(foldable && fatFold !== null && fatFold.optionId === optionId),
    })
  })

  return { lines, fatFold, standardPortionGrams: portion, verifiedNumericYield: yieldM }
}
