import type {
  HighImpactQuestion,
  IngredientRow,
  Item,
  PortionContext,
  QualitativeAmount,
  UncertaintyFactor,
  VisionPayload,
} from '@nutai/core-schema'

export type { HighImpactQuestion, PortionContext, QualitativeAmount, UncertaintyFactor }

/**
 * The stored-domain preparation shape (camelCase `intrinsicFat` /
 * `addedCookingFat`), derived from its single declaration on IngredientRow —
 * ONE shape, owned by domain.ts, mirrored here by reference.
 *
 * WHY the derivation and not the `Preparation` export from @nutai/core-schema:
 * that export is the WIRE shape (PreparationZ — snake_case `intrinsic_fat` /
 * `added_cooking_fat`, the block as the model emits it). Rows carry the
 * camelCase mirror, and conflating the two is exactly how a `.addedCookingFat`
 * read against a wire item comes back `undefined` forever. Wire on the way
 * in, domain on the way out; this mapper is the seam between them.
 */
export type RowPreparation = NonNullable<IngredientRow['preparation']>

/**
 * Contract v1.3.0 mapping — the meal-level honesty blocks
 * (portion_context / major_uncertainties / highest_impact_question / summary)
 * and the per-item quality fields (qualitative_amount / preparation), carried
 * from the Zod-validated payload onto ScanResult / IngredientRow.
 *
 * The wire names are snake_case; the types here are the camelCase shapes
 * declared by @nutai/core-schema's stored-domain mirror (PortionContext,
 * UncertaintyFactor, HighImpactQuestion) plus the preparation mirror derived
 * from IngredientRow — ONE declaration of each shape, shared by the schema
 * owner, this mapper, and the UI.
 *
 * THE MAPPERS STAY DEFENSIVE even though Zod has already validated the
 * payload: each one is total (never throws), re-checks what it consumes, and
 * normalizes anything unreadable to the field's documented neutral — null /
 * [] / '' / 'unknown'. An honesty block that cannot be trusted is a block
 * that says nothing, never one that says something wrong, and never one that
 * takes a paid scan down with it.
 */

/** Contract cap on the uncertainty list, mirrored from the Zod schema. */
export const MAX_UNCERTAINTY_FACTORS = 5

const PORTION_CONFIDENCE_LEVELS: ReadonlySet<string> = new Set([
  'high', 'medium', 'low', 'unknown',
])
const CALORIE_IMPACTS: ReadonlySet<string> = new Set(['low', 'medium', 'high'])
const INTRINSIC_FAT_LEVELS: ReadonlySet<string> = new Set(['low', 'moderate', 'high', 'unknown'])
const ADDED_FAT_LEVELS: ReadonlySet<string> = new Set([
  'none', 'light', 'moderate', 'heavy', 'unknown',
])
const QUALITATIVE_AMOUNT_LEVELS: ReadonlySet<string> = new Set([
  'tiny', 'light', 'moderate', 'heavy', 'unknown',
])

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** `portion_context` → PortionContext, or null when the payload carried none. */
export function portionContextFrom(payload: VisionPayload): PortionContext | null {
  const pc = payload.portion_context
  if (!isObj(pc)) return null
  return {
    wholeMealVisible: pc.whole_meal_visible === true,
    scaleReferenceAvailable: pc.scale_reference_available === true,
    // The contract's "no reference" spelling is the empty string, not null.
    scaleReferenceDescription: typeof pc.scale_reference_description === 'string'
      ? pc.scale_reference_description
      : '',
    absolutePortionConfidence:
      typeof pc.absolute_portion_confidence === 'string' &&
      PORTION_CONFIDENCE_LEVELS.has(pc.absolute_portion_confidence)
        ? pc.absolute_portion_confidence as PortionContext['absolutePortionConfidence']
        : 'unknown',
  }
}

/** `major_uncertainties` → validated list, capped at the contract maximum. */
export function uncertaintyFactorsFrom(payload: VisionPayload): UncertaintyFactor[] {
  const list = payload.major_uncertainties
  if (!Array.isArray(list)) return []
  const out: UncertaintyFactor[] = []
  for (const entry of list) {
    if (!isObj(entry)) continue
    const factor = typeof entry.factor === 'string' && entry.factor.trim() ? entry.factor : null
    const impact =
      typeof entry.impact_on_total_calories === 'string' &&
      CALORIE_IMPACTS.has(entry.impact_on_total_calories)
        ? (entry.impact_on_total_calories as UncertaintyFactor['impactOnTotalCalories'])
        : null
    // An entry without a readable factor or impact is prose noise; drop it
    // rather than guess whether it moves the total by a little or a lot.
    if (factor == null || impact == null) continue
    out.push({ factor, impactOnTotalCalories: impact })
    if (out.length >= MAX_UNCERTAINTY_FACTORS) break
  }
  return out
}

/**
 * `highest_impact_question` → HighImpactQuestion, or null when absent, null,
 * or the wire's no-question sentinel.
 */
export function highImpactQuestionFrom(payload: VisionPayload): HighImpactQuestion | null {
  const hiq = payload.highest_impact_question
  if (!isObj(hiq)) return null
  if (typeof hiq.question !== 'string' || !hiq.question.trim()) return null
  // The prompt's instructed no-question spelling for the strict wire —
  // {"question":"none","options":[]} — survives validation intact ("none" is
  // exactly 4 characters, clearing the wire's min(4)), because the OpenAI
  // strict dialect strips the null branch and the model needs SOMEWHERE honest
  // to go. Here is that somewhere: the sentinel is the prompt's spelling of
  // "there is no question", not a question, and the domain type already says
  // null means exactly that. Letting it ride through would put a card that
  // literally says "none" in front of the user.
  if (hiq.question.trim().toLowerCase() === 'none') return null
  const options = Array.isArray(hiq.options)
    ? hiq.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
    : []
  return { question: hiq.question, options }
}

/** `summary` → the known/unknown prose pair, each side independently nullable. */
export function summaryFrom(payload: VisionPayload): { knownSummary: string | null; unknownSummary: string | null } {
  const summary = payload.summary
  if (!isObj(summary)) return { knownSummary: null, unknownSummary: null }
  return {
    knownSummary: typeof summary.what_is_known === 'string' ? summary.what_is_known : null,
    unknownSummary: typeof summary.what_is_not_known === 'string' ? summary.what_is_not_known : null,
  }
}

export interface RowQuality {
  /** Absent on the payload → null: the row carries no amount claim. */
  qualitativeAmount: QualitativeAmount | null
  /** Absent on the payload → null: "no preparation data", never a guess. */
  preparation: RowPreparation | null
}

/** Per-item quality fields, off the validated item at the same index. */
export function rowQualityFrom(item: Item): RowQuality {
  const out: RowQuality = {
    // Same defensive rule as preparation's enums below: a value outside the
    // closed enum set is no claim — null, never an invented level. The wire
    // type promises QualitativeAmount, but fixtures and schema drift can put
    // garbage where the type promises an enum, and this mapper is the last
    // gate before the value lands on a row the user sees.
    qualitativeAmount:
      item.qualitative_amount != null && QUALITATIVE_AMOUNT_LEVELS.has(item.qualitative_amount)
        ? item.qualitative_amount
        : null,
    preparation: null,
  }
  // Read through the item's TYPED wire preparation (snake_case — see the
  // RowPreparation note above for why the camelCase name would silently read
  // undefined), then re-validate every field below: the runtime checks are
  // what makes garbage fixtures and schema skew degrade to the documented
  // neutral instead of landing a fabricated claim on a row.
  const prep = item.preparation
  if (prep != null) {
    out.preparation = {
      method: typeof prep.method === 'string' ? prep.method : '',
      intrinsicFat: INTRINSIC_FAT_LEVELS.has(prep.intrinsic_fat)
        ? prep.intrinsic_fat
        : 'unknown',
      addedCookingFat: ADDED_FAT_LEVELS.has(prep.added_cooking_fat)
        ? prep.added_cooking_fat
        : 'unknown',
      confidence: typeof prep.confidence === 'number' && Number.isFinite(prep.confidence)
        ? Math.min(1, Math.max(0, prep.confidence))
        : 0,
    }
  }
  return out
}

/**
 * The strongest disclosed added-cooking-fat level across a meal's items, for
 * the repair layer's added_fat trigger. Order is by fat impact — heavy >
 * moderate > light > unknown — so a meal with one 'light' and one 'heavy'
 * dish asks about the heavy one, deterministically. 'none' never wins: a
 * meal where every row discloses 'none' has no hidden fat to ask about.
 */
const FAT_LEVEL_STRENGTH: Readonly<Record<string, number>> = {
  heavy: 4,
  moderate: 3,
  light: 2,
  unknown: 1,
}

export function strongestDisclosedFatLevel(items: readonly Item[]): 'none' | 'unknown' | 'light' | 'moderate' | 'heavy' {
  let best: 'none' | 'unknown' | 'light' | 'moderate' | 'heavy' = 'none'
  let bestStrength = 0
  for (const item of items) {
    // `items` are WIRE items: their preparation block is the snake_case
    // PreparationZ shape (`added_cooking_fat`), NOT the camelCase mirror that
    // lives on IngredientRow. Reading the camelCase name here would compile
    // against nothing and silently evaluate to undefined for every item —
    // dead-ending the added_fat trigger at 'none' no matter what the model
    // disclosed. Re-validated against the same closed level set as
    // rowQualityFrom: an unnamed value is no disclosure.
    const level = item.preparation?.added_cooking_fat
    if (level == null || !ADDED_FAT_LEVELS.has(level)) continue
    const strength = FAT_LEVEL_STRENGTH[level] ?? 0
    if (strength > bestStrength) {
      best = level
      bestStrength = strength
    }
  }
  return best
}
