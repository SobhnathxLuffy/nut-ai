/**
 * Ingredient expansion for assistant meal proposals.
 *
 * "log 2 rotis" used to arrive as {"name": "Roti", "grams": 80} — one row of
 * 80 g, nutritionally identical but wrong in every way a user reads it. The
 * prompt now asks the model for unit_count + PER-UNIT grams; this pure helper
 * turns whatever arrives into per-row data:
 *
 *   {grams: 40, unit_count: 2}  ->  2 rows x 40 g
 *   {grams: 240, unit_count: 2} ->  2 rows x 120 g  (model sent the TOTAL —
 *                                   anything above 350 g per "unit" is read as
 *                                   a total and divided back out)
 *   {grams: 150}                ->  1 row x 150 g
 *
 * Counts above 8 collapse back to one total-weight row so "12 biscuits" never
 * floods the review screen.
 */

export interface ExpandedProposalIngredient {
  name: string
  /** Grams for ONE row (one unit, or the collapsed total). */
  perUnitGrams: number
  /** How many identical rows to create (1..8). */
  rows: number
  unitCount: number
  /** Card-ready line, e.g. "Roti — 2 × 40 g". */
  display: string
}

const MAX_ROWS = 8
/** No common counted piece (roti, idli, dosa, slice, egg, biscuit) weighs
 * 150 g — a "per-unit" value above this is almost certainly the meal TOTAL
 * arriving without division, so it is divided back out. */
const PER_UNIT_AMBIGUITY_CEILING_G = 150
const DEFAULT_GRAMS = 100

export function expandProposalIngredients(raw: unknown): ExpandedProposalIngredient[] {
  const list = Array.isArray(raw) ? raw : []
  const out: ExpandedProposalIngredient[] = []

  for (const item of list) {
    const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Food'
    const grams = Number(obj.grams)
    const total = Number.isFinite(grams) && grams > 0 ? grams : DEFAULT_GRAMS

    const rawCount = Number(obj.unit_count)
    let unitCount = Number.isFinite(rawCount) ? Math.floor(rawCount) : 1
    unitCount = Math.max(1, Math.min(12, unitCount))

    let perUnit = total
    if (unitCount > 1 && total > PER_UNIT_AMBIGUITY_CEILING_G) {
      perUnit = Math.round((total / unitCount) * 10) / 10
    }

    let rows = unitCount
    let rowGrams = perUnit
    if (unitCount > MAX_ROWS) {
      rows = 1
      rowGrams = Math.round(perUnit * unitCount * 10) / 10
    }

    const display =
      unitCount > 1
        ? `${name} — ${unitCount} × ${Math.round(perUnit)} g`
        : `${name} — ${Math.round(rowGrams)} g`

    out.push({ name, perUnitGrams: rowGrams, rows, unitCount, display })
  }

  return out
}
