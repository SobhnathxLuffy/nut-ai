import { z } from 'zod'

export const CorrectionOperationZ = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update_quantity'),
    id: z.string(),
    grams: z.number().nullable(),
    qualitative_size: z.string().nullable()
  }),
  z.object({
    type: z.literal('remove_item'),
    id: z.string()
  }),
  z.object({
    type: z.literal('add_item'),
    name: z.string(),
    canonical_food_key: z.string(),
    grams: z.number().nullable(),
    qualitative_size: z.string().nullable()
  }),
  z.object({
    type: z.literal('replace_item'),
    id: z.string(),
    name: z.string(),
    canonical_food_key: z.string()
  })
])

export type CorrectionOperation = z.infer<typeof CorrectionOperationZ>

export const CorrectionIntentZ = z.object({
  operations: z.array(CorrectionOperationZ),
  clarification_needed: z.string().nullable().describe('If the request is too ambiguous, ask a short clarifying question.')
})

export type CorrectionIntent = z.infer<typeof CorrectionIntentZ>

/**
 * The JSON-repair pass for the correction parser (T-IMPL-A fix 7): a degraded
 * model answer that is ALMOST a CorrectionIntent is repaired into one instead
 * of dying as "not in a shape we could read". Repairs, each mapped to a real
 * failure of cheap text models on this path:
 *  - the operations array delivered bare, or wrapped one level deep
 *    (`{intent:{...}}` / `{response:{...}}`-style envelopes);
 *  - numeric grams as strings ("200", "200 g") — the single most common drift;
 *  - `clarification_needed` absent (older prompts) → null;
 *  - unknown operation types dropped (the app never invents semantics).
 * Anything that still does not parse returns null — the caller keeps its
 * honest failure path. Returns the Zod-PARSED intent, never a cast.
 */
export function repairCorrectionIntent(raw: unknown): CorrectionIntent | null {
  let candidate: any = raw
  if (candidate == null || typeof candidate !== 'object') return null
  if (Array.isArray(candidate)) candidate = { operations: candidate }
  for (const key of ['intent', 'response', 'result', 'correction']) {
    const inner = (candidate as Record<string, unknown>)[key]
    const record = inner as Record<string, unknown>
    if (inner != null && typeof inner === 'object' && Array.isArray(record['operations'])) {
      candidate = inner
      break
    }
  }
  if (!Array.isArray(candidate.operations)) return null

  const operations: unknown[] = []
  for (const op of candidate.operations) {
    if (op == null || typeof op !== 'object') continue
    const fixed: any = { ...op }
    if (typeof fixed.grams === 'string') {
      const n = Number(fixed.grams.replace(/[^\d.]/g, ''))
      fixed.grams = Number.isFinite(n) && fixed.grams.trim() !== '' ? n : null
    }
    if (CorrectionOperationZ.safeParse(fixed).success) operations.push(fixed)
  }
  const clarification =
    typeof candidate.clarification_needed === 'string' && candidate.clarification_needed.trim()
      ? candidate.clarification_needed.trim()
      : null
  const parsed = CorrectionIntentZ.safeParse({ operations, clarification_needed: clarification })
  return parsed.success ? parsed.data : null
}
