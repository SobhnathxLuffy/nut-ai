export type VerificationStatus = "DRAFT_CURATED" | "CURATED" | "VERIFIED";
export type PriorityBatch = "A" | "B" | "C";
export interface IngredientSlot {
  label: string;
  role: "dominant" | "secondary" | "fat_variable" | "high_energy" | "minor" | "process";
  required: boolean;
  amountPrior: { kind: "broad_mass_fraction_engineering_prior"; range: [number, number]; verified: false; };
  nutritionMapping: { preferredSources: Array<"IFCT" | "USDA_FDC">; canonicalFoodId: string | null; mappingStatus: "pending_exact_id" | "mapped" | "AUTO_MAPPED" | "MANUAL_OVERRIDE" | "AMBIGUOUS" | "UNRESOLVED" | "unresolved"; mappedName?: string; mappingMethod?: string; reviewNote?: string; };
}
export interface IndianDishDefinition {
  schemaVersion: string; id: string; canonicalName: string; aliases: string[]; searchTerms: string[];
  coverageRegions: string[]; category: string; family: string; priorityBatch: PriorityBatch;
  parentDishId: string | null; isCompositeMeal: boolean;
  recipeTemplate: { templateStatus: VerificationStatus; ingredientSlots: IngredientSlot[]; numericRatiosVerified: boolean; requiresHumanRecipeCalibration: boolean; calculationMode: "ingredient_sum_then_cooked_yield_then_serving_fraction"; };
  portionModel: { strategies: string[]; standardPortionGrams: number | null; standardPortionStatus: "unverified" | "verified"; householdOverrideEligible: boolean; };
  uncertaintyModel: { highImpactUnknowns: string[]; allowIDontKnow: boolean; questionPolicy: string; };
  provenance: { recordStatus: VerificationStatus; nutritionEmbedded: boolean; sourceVerificationRequired: boolean; notes: string; };
}
