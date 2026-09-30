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
