import type { CorrectionIntent } from '@nutai/core-schema'
import type { IngredientRow } from '@nutai/core-schema'

/**
 * P2-30 (e): the ONE operation describer.
 *
 * result.tsx (Fix Result confirmation) and assistant.tsx (AIP-004 proposal
 * card) carried two near-identical switches that were drifting — one knew
 * about the model's qualitative size, the other didn't. Every correction
 * operation renders through here.
 */
export type CorrectionOperation = CorrectionIntent['operations'][number]

export function describeCorrectionOperation(
  op: CorrectionOperation,
  nameOf: (id: string) => string,
): string {
  switch (op.type) {
    case 'update_quantity':
      return op.grams != null
        ? `Set “${nameOf(op.id)}” to ${Math.round(op.grams)} g`
        : `Adjust “${nameOf(op.id)}”${op.qualitative_size ? ` (${op.qualitative_size})` : ''}`
    case 'remove_item':
      return `Remove “${nameOf(op.id)}”`
    case 'add_item':
      return `Add “${op.name}”${op.grams != null ? ` (~${Math.round(op.grams)} g)` : ''}`
    case 'replace_item':
      return `Swap “${nameOf(op.id)}” for “${op.name}”`
  }
}

/** Name resolver over a draft's rows — unknown ids degrade to 'that item'. */
export function rowsNameOf(rows: IngredientRow[]): (id: string) => string {
  return (id: string) => rows.find((r) => r.id === id)?.displayName ?? 'that item'
}

// ---------------------------------------------------------------------------
// Fuzzy name→row resolution (T-IMPL-A fix 8): the correction prompt asked the
// model to echo exact timestamp ids; a mismatched id used to die as "no longer
// in the list". Both correction paths now degrade to NAME matching over the
// same context rows before reporting a skip.
// ---------------------------------------------------------------------------

interface NameBearingRow {
  /** The row id the write layer understands (`m<meal>i<item>` or a draft row id). */
  id: string
  displayName: string
}

/** Lowercase + collapse whitespace + strip punctuation, so "Rice (white)" matches "rice white". */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve one correction operation's id-or-name to a row.
 *
 * Precedence: exact id → exact (normalized) name → the row whose name contains
 * the query or vice versa (longest containing name wins — "rice" matches
 * "brown rice" over "rice cakes" only when it is the only/longest hit) →
 * word-overlap. Null = genuinely unresolvable; the caller reports a skip with
 * the row's name, never a raw id.
 */
export function matchCorrectionRow<T extends NameBearingRow>(
  idOrName: string,
  rows: ReadonlyArray<T>,
): T | null {
  const query = normalizeName(idOrName)
  if (!query) return null
  const normalized = rows.map((r) => ({ row: r, name: normalizeName(r.displayName) }))
  return (
    normalized.find((r) => r.row.id === idOrName)?.row ??
    normalized.find((r) => r.name === query)?.row ??
    // Containment, longest name first so a specific name beats a generic one.
    normalized
      .filter((r) => r.name.includes(query) || query.includes(r.name))
      .sort((a, b) => b.name.length - a.name.length)[0]?.row ??
    // Word overlap: every word of the shorter side appears in the other.
    normalized.find((r) => {
      const words = query.split(' ').filter((w) => w.length > 2)
      return words.length > 0 && words.every((w) => r.name.includes(w))
    })?.row ??
    null
  )
}
