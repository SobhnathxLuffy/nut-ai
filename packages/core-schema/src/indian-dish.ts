import { z } from 'zod'

export const ProvenanceSchema = z.object({
  recordStatus: z.enum(['DRAFT_CURATED', 'CURATED', 'VERIFIED']),
  nutritionEmbedded: z.boolean(),
  sourceVerificationRequired: z.boolean(),
  notes: z.string().optional()
})

export const AmountPriorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('broad_mass_fraction_engineering_prior'),
    range: z.tuple([z.number(), z.number()]),
    verified: z.boolean()
  })
])

export const IngredientSlotSchema = z.object({
  label: z.string(),
  role: z.enum(['dominant', 'process', 'minor', 'fat_variable', 'flavor', 'core', 'inclusion', 'binding', 'liquid']),
  required: z.boolean(),
  amountPrior: AmountPriorSchema.optional(),
  nutritionMapping: z.object({
    preferredSources: z.array(z.string()),
    canonicalFoodId: z.string().nullable(),
    mappingStatus: z.enum(['pending_exact_id', 'mapped', 'unresolved'])
  })
})

export const RecipeTemplateSchema = z.object({
  templateStatus: z.enum(['DRAFT_CURATED', 'CURATED', 'VERIFIED']),
  ingredientSlots: z.array(IngredientSlotSchema),
  numericRatiosVerified: z.boolean().optional(),
  requiresHumanRecipeCalibration: z.boolean().optional(),
  calculationMode: z.string().optional()
})

export const PortionModelSchema = z.object({
  strategies: z.array(z.string()),
  standardPortionGrams: z.number().nullable(),
  standardPortionStatus: z.string(),
  householdOverrideEligible: z.boolean().optional()
})

export const DishUncertaintySchema = z.object({
  highImpactUnknowns: z.array(z.string()),
  allowIDontKnow: z.boolean().optional(),
  questionPolicy: z.string().optional()
})

export const HouseholdOverrideSchema = z.object({
  eligible: z.boolean(),
  suggestAfterConfirmedLogs: z.number().optional(),
  preferMeasuredOverrideAfterSamples: z.number().optional(),
  versionOnMaterialChange: z.boolean().optional()
})

export const DishResolverConfigSchema = z.object({
  priorityAfter: z.array(z.string()).optional(),
  priorityBefore: z.array(z.string()).optional(),
  unknownFallback: z.string().optional()
})

export const DishVerificationConfigSchema = z.object({
  required: z.array(z.string()).optional()
})

export const DishDefinitionSchema = z.object({
  schemaVersion: z.string(),
  id: z.string(),
  canonicalName: z.string(),
  aliases: z.array(z.string()).optional(),
  searchTerms: z.array(z.string()).optional(),
  coverageRegions: z.array(z.string()).optional(),
  category: z.string(),
  family: z.string(),
  priorityBatch: z.string(),
  parentDishId: z.string().nullable().optional(),
  isCompositeMeal: z.boolean().optional(),
  cooking: z.object({
    methods: z.array(z.string()),
    yieldModel: z.object({
      measurementPriority: z.array(z.string()),
      verifiedNumericYield: z.number().nullable(),
      status: z.string().optional()
    })
  }),
  recipeTemplate: RecipeTemplateSchema,
  portionModel: PortionModelSchema,
  uncertaintyModel: DishUncertaintySchema.optional(),
  resolver: DishResolverConfigSchema.optional(),
  householdPromotion: HouseholdOverrideSchema.optional(),
  provenance: ProvenanceSchema.optional(),
  verification: DishVerificationConfigSchema.optional()
})

export type DishDefinition = z.infer<typeof DishDefinitionSchema>
export type RecipeTemplate = z.infer<typeof RecipeTemplateSchema>
export type IngredientSlot = z.infer<typeof IngredientSlotSchema>
export type PortionModel = z.infer<typeof PortionModelSchema>
export type DishUncertainty = z.infer<typeof DishUncertaintySchema>
export type Provenance = z.infer<typeof ProvenanceSchema>
export type HouseholdOverride = z.infer<typeof HouseholdOverrideSchema>
