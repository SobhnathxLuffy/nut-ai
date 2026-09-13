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
