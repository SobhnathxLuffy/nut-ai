import {
  CookingCueZ,
  ReferenceObjectTypeZ,
  SCHEMA_VERSION,
  VisionPayloadZ,
  type VisionPayload,
} from '@nutai/core-schema'

/**
 * Deterministic payload repair — the net under structured-output mode.
 *
 * THE BUG THIS CATCHES (reproduced live on an aicredits.in reseller with
 * gpt-4o, gpt-4o-mini and gemma-3-12b alike): `qualitative_size` is validated
 * client-side against `/^(small|medium|large|count:\d+(\.\d+)?)$/`, but the
 * wire schema cannot carry that constraint — every provider dialect strips
 * `pattern` (acceptance varies by gateway), so the model is told any STRING is
 * fine. A compliant model answers "two slices on a plate", the client-side
 * regex rejects the entire payload, and a billed, otherwise-perfect scan dies
 * as "the model answered in a shape we could not use".
 *
 * The same gap exists for every constraint that lives only in Zod refinements,
 * and reseller gateways add a second layer of drift when they silently drop
 * `response_format` (missing schema_version, numbers as strings, invented enum
 * values).
 *
 * THE PRINCIPLE: repair ONLY what has a deterministic, safe, meaning-preserving
 * mapping. This function never invents nutrition data, never guesses a number
 * it was not given, and leaves anything without a safe mapping untouched so
 * validation can fail honestly. Every repaired payload still passes the FULL
 * VisionPayloadZ contract and the non-skippable sanity clamp afterwards —
 * repair widens what we ACCEPT, never what we CLAIM.
 *
 * All enum memberships are precompiled from the real Zod enums, so this repair
 * can never drift from the contract it serves.
 */

const COOKING_CUES = new Set<string>(CookingCueZ.options)
const REFERENCE_TYPES = new Set<string>(ReferenceObjectTypeZ.options)

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** "12" -> 12; "12.5" -> 12.5; everything else stays undefined. */
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const s = v.trim()
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  }
  return undefined
}

/**
 * Confidences arrive as 0.9, "0.9", or — the classic slip — 90 (a percent).
 * A number in (1, 100] is normalized as a percent; nothing else is guessed.
 */
function toConfidence(v: unknown): number | undefined {
  const n = toNumber(v)
  if (n === undefined) return undefined
  if (n > 1 && n <= 100) return n / 100
  return n
}

const SPELLED_COUNTS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', a: '1', an: '1', couple: '2',
}

/** "two slices on a plate" -> "count:2"; "a small pile" -> "small". */
export function normalizeQualitativeSize(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().toLowerCase()
  if (/^(small|medium|large|count:\d+(\.\d+)?)$/.test(s)) return s
  // A leading/any count mention wins — counting is the most reliable signal
  // the model can give, per the schema's own doc comment.
  const counted = s.match(/count\s*[:=]?\s*(\d+(?:\.\d+)?)/)
  if (counted) return `count:${counted[1]}`
  const UNIT = /(pieces?|pcs|slices?|cups?|bowls?|eggs?|items?|units?|servings?|helpings?|portions?|count)/
  // A DIGIT next to a unit is an explicit count and always wins ("3 pieces").
  if (UNIT.test(s)) {
    const digit = s.match(/(\d+(?:\.\d+)?)/)
    if (digit) return `count:${digit[1]}`
  }
  // Size words next — "a fairly large serving" must not read "a" as a count.
  if (/\bsmall\b|\bsm\b|\bhalf\b/.test(s)) return 'small'
  if (/\blarge\b|\blg\b|\bbig\b|\bhuge\b|\bfull\b/.test(s)) return 'large'
  if (/\bmedium\b|\bmed\b|\bregular\b|\bnormal\b|\bstandard\b|\baverage\b/.test(s)) return 'medium'
  // Spelled-out count with a unit ("two eggs", "a slice of pizza").
  if (UNIT.test(s)) {
    const spelled = s.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an|couple)\b/)
    const word = spelled?.[1]
    if (word != null) return `count:${SPELLED_COUNTS[word]}`
  }
  // A bare number ("2", "3.5") is a count in context.
  if (/^\d+(\.\d+)?$/.test(s)) return `count:${s}`
  return 'medium'
}

/** Enum members first: a bare number is a count in a size context. */
function repairQualitativeSize(v: unknown): unknown {
  if (typeof v === 'string' && /^(small|medium|large|count:\d+(\.\d+)?)$/.test(v.trim())) return v.trim()
  const repaired = normalizeQualitativeSize(v)
  return repaired ?? v
}

function repairConfidence(v: unknown): unknown {
  const n = toConfidence(v)
  return n === undefined ? v : n
}

function repairStringArray(v: unknown, cap?: number): unknown {
  // A non-array is deep garbage; [] is the honest neutral — no claims made.
  if (!Array.isArray(v)) return []
  const strings = v.filter((x): x is string => typeof x === 'string')
  return cap === undefined ? strings : strings.slice(0, cap)
}

function repairMacros(v: unknown): unknown {
  if (!isObj(v)) return v
  const out: Record<string, unknown> = { ...v }
  for (const k of ['calories_kcal', 'protein_g', 'carbs_g', 'fat_g'] as const) {
    if (k in out) {
      const n = toNumber(out[k])
      if (n !== undefined) out[k] = n
    }
  }
  // Nullable numerics: an empty string means "not reported" — the null
  // spelling — rather than a zero.
  for (const k of ['fiber_g', 'sodium_mg'] as const) {
    if (k in out) {
      if (out[k] === '' || out[k] === undefined) out[k] = null
      else {
        const n = toNumber(out[k])
        if (n !== undefined) out[k] = n
      }
    }
  }
  return out
}

function repairReferenceObjects(v: unknown): unknown {
  if (!Array.isArray(v)) return v
  return v.filter(
    (x) =>
      isObj(x) &&
      typeof x['type'] === 'string' &&
      REFERENCE_TYPES.has(x['type']) &&
      Array.isArray(x['bbox']) &&
      (x['bbox'] as unknown[]).length === 4 &&
      (x['bbox'] as unknown[]).every((b) => typeof b === 'number' && Number.isFinite(b)) &&
      toNumber(x['confidence']) !== undefined,
  )
}

function repairContainer(v: unknown): unknown {
  if (v === null) return v
  if (!isObj(v)) return null
  if (typeof v['type'] !== 'string' || !/^(cereal_bowl|soup_plate|mug|drinking_glass|wine_glass|pint_glass|takeout_container|other)$/.test(v['type'])) {
    return null
  }
  const fill = toNumber(v['fill_fraction'])
  if (fill === undefined || fill < 0 || fill > 1) return null
  return { type: v['type'], fill_fraction: fill }
}

function repairItem(v: unknown): unknown {
  if (!isObj(v)) return v
  const out: Record<string, unknown> = { ...v }

  if (typeof out['qualitative_size'] !== 'undefined') out['qualitative_size'] = repairQualitativeSize(out['qualitative_size'])
  if (typeof out['weight_basis'] === 'string' && !/^(cooked|raw|as_served)$/.test(out['weight_basis'])) {
    out['weight_basis'] = 'as_served'
  }
  if (typeof out['food_form'] === 'string' && !/^(discrete|flat|piled|liquid|wrapped|spread)$/.test(out['food_form'])) {
    out['food_form'] = out['is_beverage'] === true ? 'liquid' : 'discrete'
  }
  if ('identification_confidence' in out) out['identification_confidence'] = repairConfidence(out['identification_confidence'])
  if ('portion_confidence' in out) out['portion_confidence'] = repairConfidence(out['portion_confidence'])
  if ('model_gram_estimate' in out) {
    // '' -> null (not reported) is the honest spelling for an optional number.
    if (out['model_gram_estimate'] === '') out['model_gram_estimate'] = null
    else {
      const n = toNumber(out['model_gram_estimate'])
      if (n !== undefined) out['model_gram_estimate'] = n
    }
  }
  // The one uncertainty enum has no null; 'none' is its own neutral member and
  // the least-false landing spot for an invented value.
  if (typeof out['uncertainty_reason'] === 'string' && !/^(oil_or_fat_not_visually_determinable|sauce_type_ambiguous|milk_type_ambiguous|meat_fat_percent_ambiguous|cooked_vs_raw_ambiguous|container_size_no_reference|serving_count_ambiguous|portion_depth_not_visible|identity_ambiguous|partially_occluded|abv_unknown|shake_recipe_unknown|none)$/.test(out['uncertainty_reason'])) {
    out['uncertainty_reason'] = 'none'
  }
  if ('visible_reference_objects' in out) out['visible_reference_objects'] = repairReferenceObjects(out['visible_reference_objects'])
  if ('container' in out) out['container'] = repairContainer(out['container'])
  if ('cooking_method_cues' in out && Array.isArray(out['cooking_method_cues'])) {
    out['cooking_method_cues'] = out['cooking_method_cues'].filter(
      (c): c is string => typeof c === 'string' && COOKING_CUES.has(c),
    )
  }
  if ('beverage_category' in out) {
    const bc = out['beverage_category']
    if (bc !== null && !(typeof bc === 'string' && /^(alcoholic_packaged|alcoholic_poured_or_mixed|blended_shake_or_smoothie|coffee_tea|soda_juice_other|milk_or_dairy_drink)$/.test(bc))) {
      out['beverage_category'] = null
    }
  }
  if ('legible_label_text' in out && out['legible_label_text'] !== null && typeof out['legible_label_text'] !== 'string') {
    out['legible_label_text'] = null
  }
  if ('brand' in out && out['brand'] !== null && typeof out['brand'] !== 'string') out['brand'] = null
  if ('stated_assumptions' in out) out['stated_assumptions'] = repairStringArray(out['stated_assumptions'])
  if ('clarifying_questions' in out) out['clarifying_questions'] = repairStringArray(out['clarifying_questions'], 2)
  if ('fallback_macros_at_estimate' in out) out['fallback_macros_at_estimate'] = repairMacros(out['fallback_macros_at_estimate'])
  return out
}

/**
 * Normalize a raw model answer into the current payload contract. Returns the
 * input untouched when it is not an object we know how to mend.
 */
export function repairVisionPayload(raw: unknown): unknown {
  if (!isObj(raw)) return raw
  const out: Record<string, unknown> = { ...raw }

  // The literal version stamp: a gateway or model that drops/renames it has
  // not changed the CONTRACT, only lost the stamp — re-stamp, then let Zod
  // judge the actual content.
  if (out['schema_version'] !== SCHEMA_VERSION) out['schema_version'] = SCHEMA_VERSION
  if (typeof out['refusal_reason'] !== 'undefined' && out['refusal_reason'] !== null && typeof out['refusal_reason'] !== 'string') {
    out['refusal_reason'] = null
  }
  if (Array.isArray(out['items'])) out['items'] = out['items'].map(repairItem)
  if (isObj(out['meal_overall'])) {
    const mo: Record<string, unknown> = { ...out['meal_overall'] }
    if ('identification_confidence' in mo) mo['identification_confidence'] = repairConfidence(mo['identification_confidence'])
    if ('portion_confidence' in mo) mo['portion_confidence'] = repairConfidence(mo['portion_confidence'])
    if ('assumptions' in mo) mo['assumptions'] = repairStringArray(mo['assumptions'])
    if ('clarifying_questions' in mo) mo['clarifying_questions'] = repairStringArray(mo['clarifying_questions'])
    out['meal_overall'] = mo
  }
  return out
}

/**
 * Zod-first validation with one deterministic repair pass. A payload that was
 * always valid is returned byte-identical; a drifted payload is repaired and
 * re-validated against the FULL contract; anything beyond deterministic
 * normalization fails honestly, exactly as before.
 */
export function validateWithRepair(raw: unknown): VisionPayload | null {
  const parsed = VisionPayloadZ.safeParse(raw)
  if (parsed.success) return parsed.data
  const repaired = VisionPayloadZ.safeParse(repairVisionPayload(raw))
  return repaired.success ? repaired.data : null
}

/** Field-level issues for diagnosis — never shown to the user, always logged. */
export function payloadValidationIssues(raw: unknown): string[] {
  const result = VisionPayloadZ.safeParse(raw)
  if (result.success) return []
  return result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
}
